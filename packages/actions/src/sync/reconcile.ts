/**
 * @wfx/actions — reconciliation, reporting only (WFX-022, Lane B).
 *
 * `reconcile(outbox, connector, userId)` compares the LOCAL belief (the
 * outbox) against the connector's REMOTE library state, wherever the
 * connector exposes it (`readLibrary`-style state; capability
 * `libraryRead`), and REPORTS drift as typed `ReconciliationDrift` entries.
 *
 * THE LAW: reconciliation never auto-mutates. It reads the outbox and the
 * connector, produces a report, and touches nothing — resolution is caller
 * policy. Every drift entry carries a `resolution` SUGGESTION from the
 * closed set "re-enqueue" | "accept-remote" | "manual":
 *
 * - `delivered-local-absent-remote` — the outbox says delivered, the
 *   connector's library does not contain the target. Suggestion:
 *   "re-enqueue" when the verb is library-evidenced ("save" — library
 *   membership directly evidences it), "manual" otherwise (a like/follow/
 *   comment/download/transform absence in a library-shaped read proves
 *   nothing about the action's remote state).
 * - `absent-local-present-remote` — the record settled locally without
 *   delivery (failed / unsupported / conflict), yet the connector's library
 *   already contains the target (e.g. the action landed remotely right
 *   before a local failure was recorded). Suggestion: "accept-remote" for
 *   library-evidenced verbs, "manual" otherwise.
 *
 * Pending/in-flight records are never drift candidates — they are still
 * being worked; flagging them would be noise, not truth.
 *
 * Remote-read honesty: the typed `readLibraryResult` surface (every
 * BaseConnector exposes it) is PREFERRED — its typed errors become typed
 * `connector-failed` reports instead of fake empty libraries. A connector
 * exposing only the frozen plain `readLibrary` is still readable (surface
 * marker "plain" in the report), because a plain connector's `[]` is its
 * own contract's answer, not a degraded error. A connector that declares
 * `libraryRead` but exposes NEITHER surface answers a typed `unsupported`
 * report — no fabricated comparisons.
 */

import type { ConnectorContext, LibraryEntry, SourceConnector, UserAction } from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";
import type { ConnectorError, ConnectorResult } from "@wfx/connectors";
import { invalidInput, transport } from "@wfx/connectors";

import { ActionSyncError, SYNC_ACTION_VERBS } from "./outbox";
import type { ActionOutboxStore } from "./outbox";

// ---------------------------------------------------------------------------
// Drift vocabulary
// ---------------------------------------------------------------------------

/** The closed resolution-suggestion vocabulary (caller policy, never auto-applied). */
export type ReconciliationResolution = "re-enqueue" | "accept-remote" | "manual";

/** Drift: the outbox says delivered, the connector library does not. */
export interface DeliveredLocalAbsentRemoteDrift {
  readonly kind: "delivered-local-absent-remote";
  readonly recordId: string;
  readonly idempotencyKey: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly action: UserAction["type"];
  readonly externalRef: string;
  readonly resolution: "re-enqueue" | "manual";
  readonly detail: string;
}

/** Drift: the record settled without delivery, the connector library has it. */
export interface AbsentLocalPresentRemoteDrift {
  readonly kind: "absent-local-present-remote";
  readonly recordId: string;
  readonly idempotencyKey: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly action: UserAction["type"];
  readonly externalRef: string;
  readonly resolution: "accept-remote" | "manual";
  readonly detail: string;
}

/** One typed drift entry: local/remote disagreement plus a resolution suggestion. */
export type ReconciliationDrift =
  | DeliveredLocalAbsentRemoteDrift
  | AbsentLocalPresentRemoteDrift;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** The success shape: what was compared, what drifted, from which evidence. */
export interface ReconciliationSuccess {
  ok: true;
  readonly userId: string;
  readonly connectorId: string;
  /** Local records considered (userId + connectorId + verb filter). */
  readonly compared: number;
  /** Drift entries — REPORTING ONLY; the outbox is untouched. */
  readonly drift: readonly ReconciliationDrift[];
  /** The external refs observed in the connector's library (sorted). */
  readonly remoteRefs: readonly string[];
  /** Which library-read surface produced the remote evidence. */
  readonly surface: "typed" | "plain";
  /** The verb filter in effect. */
  readonly verbs: readonly UserAction["type"][];
}

/**
 * The typed failure shapes (never a fake empty report):
 * - `unsupported`      — the connector does not declare `libraryRead`, or
 *                        declares it but exposes no read surface at all.
 * - `connector-failed` — the read itself failed; the SDK error is kept.
 */
export type ReconciliationReport =
  | ReconciliationSuccess
  | { ok: false; reason: "unsupported"; capability: "libraryRead"; detail: string }
  | { ok: false; reason: "connector-failed"; connectorId: string; error: ConnectorError };

/** Options for {@link reconcile}. */
export interface ReconcileOptions {
  /**
   * Locale for the rebuilt `ConnectorContext` (default `"en"` — documented,
   * deterministic).
   */
  readonly locale?: string;
  /** Optional region for the context. */
  readonly region?: string;
  /**
   * Which action verbs to compare. Default: `["save"]` — the only verb
   * whose remote state a `readLibrary`-shaped read directly evidences.
   * Widen explicitly when a connector's library reflects other verbs;
   * non-evidenced verbs drift with a "manual" suggestion.
   */
  readonly verbs?: readonly UserAction["type"][];
}

/**
 * Verbs whose remote library membership DIRECTLY evidences the action
 * (drift on these suggests re-enqueue / accept-remote). Every other verb
 * drifts with "manual" — absence in a library proves nothing about a like,
 * follow, comment, download, or transform.
 */
export const RECONCILE_LIBRARY_EVIDENCED_VERBS: readonly UserAction["type"][] = ["save"];

/** The default verb filter (see {@link ReconcileOptions.verbs}). */
export const DEFAULT_RECONCILE_VERBS: readonly UserAction["type"][] = ["save"];

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The typed library-read seam (satisfied by every BaseConnector). */
interface TypedLibraryReader {
  readLibraryResult(ctx: ConnectorContext): Promise<ConnectorResult<LibraryEntry[]>>;
}

function hasTypedLibraryRead(connector: SourceConnector): connector is SourceConnector & TypedLibraryReader {
  return typeof (connector as Partial<TypedLibraryReader>).readLibraryResult === "function";
}

/** Field-level validation of claimed library entries; returns problems. */
function libraryEntryProblems(entry: unknown): string[] {
  if (!isRecord(entry)) return ["expected a LibraryEntry object"];
  const problems: string[] = [];
  if (typeof entry.connectorId !== "string" || entry.connectorId.trim().length === 0) {
    problems.push(`connectorId: expected a non-empty string, got ${previewValue(entry.connectorId)}`);
  }
  if (typeof entry.externalRef !== "string" || entry.externalRef.trim().length === 0) {
    problems.push(`externalRef: expected a non-empty string, got ${previewValue(entry.externalRef)}`);
  }
  if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
    problems.push(`title: expected a non-empty string, got ${previewValue(entry.title)}`);
  }
  return problems;
}

/** Validate a claimed library array; returns a typed error or the entries. */
function validateLibraryEntries(
  connectorId: string,
  claimed: unknown,
): { ok: true; entries: LibraryEntry[] } | { ok: false; error: ConnectorError } {
  if (!Array.isArray(claimed)) {
    return {
      ok: false,
      error: invalidInput(
        `connector '${connectorId}' returned a non-array library: ${previewValue(claimed)}`,
      ),
    };
  }
  for (let index = 0; index < claimed.length; index += 1) {
    const problems = libraryEntryProblems(claimed[index]);
    if (problems.length > 0) {
      return {
        ok: false,
        error: invalidInput(
          `connector '${connectorId}' returned a malformed library entry at index ${index}: ${problems.join("; ")}`,
        ),
      };
    }
  }
  return { ok: true, entries: claimed as LibraryEntry[] };
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

/**
 * Compare local outbox belief against the connector's remote library and
 * REPORT the drift. PURE with respect to the outbox: no record is created,
 * mutated, or re-enqueued — resolution is caller policy. Reads the remote
 * state through the typed `readLibraryResult` surface when the connector
 * exposes it (typed failures stay typed), otherwise through the frozen
 * plain `readLibrary` (surface marker "plain").
 */
export async function reconcile(
  outbox: ActionOutboxStore,
  connector: SourceConnector,
  userId: string,
  options: ReconcileOptions = {},
): Promise<ReconciliationReport> {
  if (!isRecord(outbox)) {
    throw new ActionSyncError("outbox: expected an ActionOutboxStore instance");
  }
  if (!isRecord(connector)) {
    throw new ActionSyncError("connector: expected a SourceConnector instance");
  }
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new ActionSyncError(
      `userId: expected a non-empty string, got ${previewValue(userId)}`,
    );
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ActionSyncError("options: expected a ReconcileOptions object");
  }
  if (options.locale !== undefined && (typeof options.locale !== "string" || options.locale.trim().length === 0)) {
    throw new ActionSyncError(
      `options.locale: expected a non-empty string when present, got ${previewValue(options.locale)}`,
    );
  }
  if (options.region !== undefined && typeof options.region !== "string") {
    throw new ActionSyncError(
      `options.region: expected a string when present, got ${previewValue(options.region)}`,
    );
  }
  const verbs: readonly UserAction["type"][] = options.verbs ?? DEFAULT_RECONCILE_VERBS;
  if (
    !Array.isArray(verbs) ||
    verbs.some(
      (verb) =>
        typeof verb !== "string" || !SYNC_ACTION_VERBS.includes(verb as UserAction["type"]),
    )
  ) {
    throw new ActionSyncError(
      `options.verbs: expected an array of action verbs (${SYNC_ACTION_VERBS.join(" | ")})`,
    );
  }

  const connectorId = connector.descriptor().id;
  if (!connector.descriptor().capabilities.includes("libraryRead")) {
    return {
      ok: false,
      reason: "unsupported",
      capability: "libraryRead",
      detail: `connector '${connectorId}' does not declare 'libraryRead'; there is no remote state to reconcile against`,
    };
  }

  const ctx: ConnectorContext =
    options.region === undefined
      ? { userId, locale: options.locale ?? "en" }
      : { userId, locale: options.locale ?? "en", region: options.region };

  // --- read the remote library (typed surface preferred) ---------------------
  let entries: LibraryEntry[];
  let surface: "typed" | "plain";
  if (hasTypedLibraryRead(connector)) {
    const result = await connector.readLibraryResult(ctx);
    if (!result.ok) {
      return { ok: false, reason: "connector-failed", connectorId, error: result.error };
    }
    const validated = validateLibraryEntries(connectorId, result.value);
    if (!validated.ok) {
      return { ok: false, reason: "connector-failed", connectorId, error: validated.error };
    }
    entries = validated.entries;
    surface = "typed";
  } else if (typeof connector.readLibrary === "function") {
    let claimed: unknown;
    try {
      claimed = await connector.readLibrary(ctx);
    } catch (thrown) {
      return {
        ok: false,
        reason: "connector-failed",
        connectorId,
        error: transport(
          connectorId,
          `readLibrary threw: ${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : previewValue(thrown)}`,
        ),
      };
    }
    const validated = validateLibraryEntries(connectorId, claimed);
    if (!validated.ok) {
      return { ok: false, reason: "connector-failed", connectorId, error: validated.error };
    }
    entries = validated.entries;
    surface = "plain";
  } else {
    return {
      ok: false,
      reason: "unsupported",
      capability: "libraryRead",
      detail: `connector '${connectorId}' declares 'libraryRead' but exposes neither readLibraryResult nor readLibrary`,
    };
  }

  // --- compare (READ ONLY — the outbox is never touched here) ----------------
  const remoteRefs = new Set(
    entries.filter((entry) => entry.connectorId === connectorId).map((entry) => entry.externalRef),
  );
  const verbFilter = new Set<string>(verbs);
  const evidenced = new Set<string>(RECONCILE_LIBRARY_EVIDENCED_VERBS);
  const drift: ReconciliationDrift[] = [];
  let compared = 0;

  for (const record of await outbox.all()) {
    if (record.userId !== userId || record.connectorId !== connectorId) continue;
    if (!verbFilter.has(record.action.type)) continue;
    compared += 1;

    const presentRemotely = remoteRefs.has(record.action.externalRef);
    const isLibraryEvidenced = evidenced.has(record.action.type);

    if (record.status === "delivered" && !presentRemotely) {
      drift.push({
        kind: "delivered-local-absent-remote",
        recordId: record.id,
        idempotencyKey: record.idempotencyKey,
        userId: record.userId,
        connectorId: record.connectorId,
        action: record.action.type,
        externalRef: record.action.externalRef,
        resolution: isLibraryEvidenced ? "re-enqueue" : "manual",
        detail: `marked delivered at ${record.deliveredAt ?? record.nextAttemptAt} but '${record.action.externalRef}' is absent from the connector library`,
      });
    } else if (
      (record.status === "failed" ||
        record.status === "unsupported" ||
        record.status === "conflict") &&
      presentRemotely
    ) {
      drift.push({
        kind: "absent-local-present-remote",
        recordId: record.id,
        idempotencyKey: record.idempotencyKey,
        userId: record.userId,
        connectorId: record.connectorId,
        action: record.action.type,
        externalRef: record.action.externalRef,
        resolution: isLibraryEvidenced ? "accept-remote" : "manual",
        detail: `local status is '${record.status}' but '${record.action.externalRef}' is present in the connector library`,
      });
    }
  }

  return {
    ok: true,
    userId,
    connectorId,
    compared,
    drift,
    remoteRefs: [...remoteRefs].sort(),
    surface,
    verbs: [...verbs],
  };
}
