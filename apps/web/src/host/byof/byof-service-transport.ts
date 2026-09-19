/**
 * @wfx/app-web — the BYOF service-mode transport (R20-H): the HTTP seam.
 *
 * The transport `byof-host.ts`'s service mode binds to the Experience
 * API's feed-import routes (`/feeds/**`, apps/api — the R20-H lane). This
 * closes the escalated gap the fixtures host's module doc named: the web
 * adapter's BYOF UX was complete, the service-side feed routes were the
 * missing piece — they now exist, and this transport consumes them.
 *
 * THE SEAM LAW (one client surface, two transports): this module
 * implements the SAME operation surface the fixtures runtime exposes
 * (panelView / feedView / startPreview / confirm / sync / disconnect /
 * deleteRecords / discardPreview) with the SAME typed value shapes, so
 * the `/api/byof` route and the view loaders answer IDENTICAL bodies in
 * both boot modes — the client components are untouched. The view
 * derivations are the SHARED pure functions (`byof-view.ts`) — nothing
 * here re-implements a law.
 *
 * TRANSPORT TABLE (the feed-import routes this module maps onto):
 *
 * | transport call    | HTTP                                    | Body            |
 * |-------------------|-----------------------------------------|-----------------|
 * | `panelView`       | `GET {base}/feeds/sources` + `GET {base}/feeds/imports` + `GET {base}/feeds/records?mode=byof` + `GET {base}/feeds/preview/:id` | — |
 * | `feedView`        | `GET {base}/feeds/imports` + `GET {base}/feeds/records?mode=byof|following` | — |
 * | `startPreview`    | `POST {base}/feeds/preview`             | `{ connectorId }` |
 * | `confirm`         | `POST {base}/feeds/preview/:id/confirm` | —               |
 * | `discardPreview`  | `POST {base}/feeds/preview/:id/discard` | —               |
 * | `sync`            | `POST {base}/feeds/imports/:id/sync`    | —               |
 * | `disconnect`      | `POST {base}/feeds/imports/:id/disconnect` | —            |
 * | `deleteRecords`   | `POST {base}/feeds/imports/:id/delete-records` | —        |
 *
 * Identity rides as request headers — `x-wfx-user-id`, `x-wfx-session-id`,
 * `x-wfx-locale`, `x-wfx-region` (the frozen transport law: identity never
 * in URLs) — the SAME binding the R07 ServerPort stamps.
 *
 * TYPED FAILURE MAPPING (deterministic):
 * - the service's typed failure body (`{ error, detail, importId?,
 *   syncState? }` — the R20-H route channel) is folded VERBATIM onto
 *   `ByofFailure` (kind: unknown-connector → unsupported; the rest
 *   identity), with `importId`/`syncState` riding along;
 * - fetch rejection (offline, DNS, timeout, abort) → `transport`;
 * - 5xx without a typed body → `unavailable` (the service answered but
 *   cannot serve right now);
 * - 2xx with a non-JSON or wrong-shaped body → `transport` (a malformed
 *   answer is garbage named, never a fabricated view).
 *
 * View loaders: ANY failed GET composes the honest typed
 * `unavailable` view (state + detail) — never a partially-fetched panel
 * (that would be a fabricated surface), never a silent empty one.
 *
 * Determinism: no clock reads, no randomness; the fetch implementation
 * and timeout are injectable seams (tests stub `fetch` and run offline).
 */

import type { RuntimeContext } from "@wfx/client-runtime";
import type { FeedRelationship, FeedSyncState } from "@wfx/domain";
import { isRecord } from "@wfx/domain";
import type { PersistedFeedImport, PersistedFeedRecord } from "@wfx/persistence";

import {
  byofImportViewOf,
  byofPreviewViewOf,
  byofRecordGroupsOf,
  type ByofFailure,
  type ByofFailureKind,
  type ByofFeedView,
  type ByofImportFeedView,
  type ByofPanelView,
  type ByofPreviewView,
  type ByofRecordView,
  type ByofResult,
  type ByofSourceOptionView,
  type ByofSyncReportView,
} from "./byof-view";

// ---------------------------------------------------------------------------
// Options + the transport interface (the fixtures runtime's surface)
// ---------------------------------------------------------------------------

/** Options for {@link createByofServiceTransport}. */
export interface ByofServiceTransportOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /** The identity context every request is stamped with (headers, never URLs). */
  readonly context: RuntimeContext;
  /** The fetch implementation (default: the global `fetch`; tests inject a stub). */
  readonly fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds (default 10 000; `0` disables). */
  readonly timeoutMs?: number;
}

/** The service-mode BYOF transport (the fixtures runtime's operation surface). */
export interface ByofServiceTransport {
  /** The settings panel view (sources + import trail + staged preview). */
  panelView(previewImportId?: string): Promise<ByofPanelView>;
  /** The Library feed region view (the imported feed's durable truth). */
  feedView(): Promise<ByofFeedView>;
  /** Stage a preview capture from an importable source (the connect/import step). */
  startPreview(input: { connectorId: string }): Promise<ByofResult<{ importId: string }>>;
  /** Confirm a staged preview (the promote step — never re-fetches). */
  confirm(importId: string): Promise<ByofResult<{ importId: string; itemCount: number }>>;
  /** Incrementally sync one confirmed import (the honest reconciliation). */
  sync(importId: string): Promise<ByofResult<ByofSyncReportView>>;
  /** Disconnect one import — NON-destructive (records + provenance retained). */
  disconnect(importId: string): Promise<ByofResult<{ importId: string }>>;
  /** DELETE one import's records — the EXPLICIT destructive path only. */
  deleteRecords(importId: string): Promise<ByofResult<{ removed: number }>>;
  /** Discard a staged preview (presentation lifecycle — no records exist). */
  discardPreview(importId: string): Promise<ByofResult<{ importId: string }>>;
}

// ---------------------------------------------------------------------------
// The raw HTTP channel (typed failure mapping — see module doc)
// ---------------------------------------------------------------------------

/** One raw request outcome (transport-level, before payload validation). */
type RawOutcome =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: ByofFailure };

/** The service's typed failure kinds (the R20-H route channel vocabulary). */
const SERVICE_FAILURE_KINDS: ReadonlySet<string> = new Set([
  "invalid-input",
  "unauthorized",
  "not-found",
  "unknown-connector",
  "unsupported",
  "transport",
  "provider",
]);

/** Map one service failure kind onto the adapter's grammar. */
function byofKindOf(serviceKind: string): ByofFailureKind {
  return serviceKind === "unknown-connector" ? "unsupported" : (serviceKind as ByofFailureKind);
}

/** Fold the service's answer (status + parsed body) onto one typed failure. */
function failureOfAnswer(status: number, parsed: unknown, method: string, url: string): ByofFailure {
  const detail = `${method} ${url} answered HTTP ${status}`;
  if (isRecord(parsed)) {
    const kind = parsed.error;
    if (typeof kind === "string" && SERVICE_FAILURE_KINDS.has(kind)) {
      const bodyDetail = typeof parsed.detail === "string" ? parsed.detail : detail;
      return {
        kind: byofKindOf(kind),
        detail: bodyDetail,
        ...(typeof parsed.importId === "string" ? { importId: parsed.importId } : {}),
        ...(typeof parsed.syncState === "string" ? { syncState: parsed.syncState as FeedSyncState } : {}),
      };
    }
  }
  // No typed body — the deterministic status-based mapping.
  let fallback: ByofFailureKind;
  if (status === 401 || status === 403) fallback = "unauthorized";
  else if (status === 404 || status === 410) fallback = "not-found";
  else if (status === 409) fallback = "unsupported";
  else if (status >= 500) fallback = "unavailable";
  else fallback = "invalid-input";
  return { kind: fallback, detail };
}

// ---------------------------------------------------------------------------
// Payload validation (2xx with a wrong shape is garbage, named)
// ---------------------------------------------------------------------------

/** Whether the value is a plausible `PersistedFeedImport` row. */
function isImportRow(value: unknown): value is PersistedFeedImport {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.connectorId === "string" &&
    typeof value.method === "string" &&
    typeof value.status === "string" &&
    typeof value.syncState === "string" &&
    typeof value.continuousSync === "boolean" &&
    typeof value.itemCount === "number" &&
    typeof value.startedAt === "string"
  );
}

/** Whether the value is a plausible `PersistedFeedRecord` row. */
function isRecordRow(value: unknown): value is PersistedFeedRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.profileId === "string" &&
    typeof value.importId === "string" &&
    typeof value.externalRef === "string" &&
    isRecord(value.provenance) &&
    typeof (value.provenance as Record<string, unknown>).relationship === "string" &&
    typeof (value.provenance as Record<string, unknown>).sourceOrder === "number" &&
    typeof (value.provenance as Record<string, unknown>).capturedAt === "string"
  );
}

/** Whether the value is a plausible feed source option row. */
function isSourceOption(value: unknown): value is ByofSourceOptionView {
  return (
    isRecord(value) &&
    typeof value.connectorId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.connected === "boolean" &&
    typeof value.continuousSync === "boolean" &&
    Array.isArray(value.importable) &&
    Array.isArray(value.unavailable)
  );
}

/** The staged preview answer the service serves (with display columns). */
interface StagedPreviewAnswer {
  readonly importId: string;
  readonly connectorId: string;
  readonly itemCount: number;
  readonly relationshipCounts: Readonly<Record<string, number>>;
  readonly freshness: FeedSyncState;
  readonly continuousSync: boolean;
  readonly items: readonly {
    readonly externalRef: string;
    readonly relationship: FeedRelationship;
    readonly sourceOrder: number;
    readonly capturedAt: string;
    readonly title?: string;
    readonly entertainmentItemId: string;
    readonly sourceRef?: string;
  }[];
}

/** Whether the value is a plausible staged-preview answer. */
function isStagedPreview(value: unknown): value is StagedPreviewAnswer {
  return (
    isRecord(value) &&
    typeof value.importId === "string" &&
    typeof value.connectorId === "string" &&
    typeof value.itemCount === "number" &&
    isRecord(value.relationshipCounts) &&
    typeof value.freshness === "string" &&
    typeof value.continuousSync === "boolean" &&
    Array.isArray(value.items)
  );
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/** Create the BYOF service transport over the feed-import HTTP routes. */
export function createByofServiceTransport(options: ByofServiceTransportOptions): ByofServiceTransport {
  const base = options.apiBase;
  const context = options.context;
  // The fetch seam resolves PER CALL when not injected (the standard
  // testability pattern — a stubbed global fetch is honored even for
  // transports constructed before the stub installed).
  const fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;

  function endpoint(path: string): string {
    const url = new URL(`${base.pathname === "/" ? "" : base.pathname}${path}`, base);
    return url.toString();
  }

  function headers(): Record<string, string> {
    // Identity rides as headers — NEVER in URLs (the frozen transport law).
    const requestHeaders: Record<string, string> = {
      accept: "application/json",
      "x-wfx-user-id": context.userId,
      "x-wfx-session-id": context.sessionId,
      "x-wfx-locale": context.locale,
    };
    if (context.region !== undefined) requestHeaders["x-wfx-region"] = context.region;
    return requestHeaders;
  }

  async function request(
    method: "GET" | "POST",
    url: string,
    body?: string,
  ): Promise<RawOutcome> {
    const requestHeaders = headers();
    let signal: AbortSignal | undefined;
    if (timeoutMs > 0) signal = AbortSignal.timeout(timeoutMs);
    if (body !== undefined) requestHeaders["content-type"] = "application/json";
    const init: RequestInit = { method, headers: requestHeaders };
    if (body !== undefined) init.body = body;
    if (signal !== undefined) init.signal = signal;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (thrown) {
      // Offline / DNS / timeout / abort — the typed transport truth.
      return {
        ok: false,
        failure: {
          kind: "transport",
          detail: `the WebFlix service could not be reached (${thrown instanceof Error ? thrown.message : String(thrown)})`,
        },
      };
    }
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, failure: failureOfAnswer(response.status, parsed, method, url) };
    }
    if (parsed === null || typeof parsed !== "object") {
      return {
        ok: false,
        failure: {
          kind: "transport",
          detail: `${method} ${url} answered a non-JSON body (a malformed answer is never a fabricated view)`,
        },
      };
    }
    return { ok: true, body: parsed };
  }

  // -- typed row readers -----------------------------------------------------

  async function getRows<T>(
    path: string,
    key: string,
    guard: (value: unknown) => value is T,
  ): Promise<{ readonly rows: readonly T[] } | { readonly failure: ByofFailure }> {
    const outcome = await request("GET", endpoint(path));
    if (!outcome.ok) return { failure: outcome.failure };
    const list = (outcome.body as Record<string, unknown>)[key];
    if (!Array.isArray(list) || !list.every((row) => guard(row))) {
      return {
        failure: {
          kind: "transport",
          detail: `GET ${endpoint(path)} answered a malformed ${key} payload (never a fabricated view)`,
        },
      };
    }
    return { rows: list as readonly T[] };
  }

  async function getStagedPreview(
    importId: string,
  ): Promise<{ readonly preview: StagedPreviewAnswer } | { readonly failure: ByofFailure } | { readonly absent: true }> {
    const outcome = await request("GET", endpoint(`/feeds/preview/${encodeURIComponent(importId)}`));
    if (!outcome.ok) {
      // The honest 404 is the caller's null-preview state, not an error.
      if (outcome.failure.kind === "not-found") return { absent: true };
      return { failure: outcome.failure };
    }
    const preview = (outcome.body as Record<string, unknown>).preview;
    if (!isStagedPreview(preview)) {
      return {
        failure: {
          kind: "transport",
          detail: `GET ${endpoint(`/feeds/preview/${encodeURIComponent(importId)}`)} answered a malformed preview payload`,
        },
      };
    }
    return { preview };
  }

  /** The display-name map from the sources read (the descriptors' own). */
  function displayNamesOf(sources: readonly ByofSourceOptionView[]): Map<string, string> {
    return new Map(sources.map((source) => [source.connectorId, source.displayName]));
  }

  // -- the views -------------------------------------------------------------

  async function panelView(previewImportId?: string): Promise<ByofPanelView> {
    // ANY failed GET composes the honest unavailable view — never a
    // partially-fetched panel (a fabricated surface), never a silent empty.
    const sourcesRead = await getRows<ByofSourceOptionView>("/feeds/sources", "sources", isSourceOption);
    if ("failure" in sourcesRead) return unavailablePanel(sourcesRead.failure);
    const importsRead = await getRows<PersistedFeedImport>("/feeds/imports", "imports", isImportRow);
    if ("failure" in importsRead) return unavailablePanel(importsRead.failure);
    const recordsRead = await getRows<PersistedFeedRecord>("/feeds/records?mode=byof", "records", isRecordRow);
    if ("failure" in recordsRead) return unavailablePanel(recordsRead.failure);

    const displayNames = displayNamesOf(sourcesRead.rows);
    const previewOutcome =
      previewImportId !== undefined && previewImportId.length > 0
        ? await previewView(previewImportId, displayNames)
        : await newestStagedPreview(importsRead.rows, displayNames);
    // A preview read that TRANSPORT-failed folds the whole panel into the
    // honest unavailable state — a partially-fetched panel (sources
    // without the preview the URL addressed) is a fabricated surface.
    if (previewOutcome !== null && "failure" in previewOutcome) {
      return unavailablePanel(previewOutcome.failure);
    }
    const preview = previewOutcome;
    return {
      state: "ready",
      sources: [...sourcesRead.rows],
      imports: importsRead.rows.map((row) =>
        byofImportViewOf(
          row,
          recordsRead.rows.filter((record) => record.importId === row.id),
          displayNames.get(row.connectorId) ?? row.connectorId,
        ),
      ),
      preview,
    };
  }

  async function feedView(): Promise<ByofFeedView> {
    const importsRead = await getRows<PersistedFeedImport>("/feeds/imports", "imports", isImportRow);
    if ("failure" in importsRead) return unavailableFeed(importsRead.failure);
    const recordsRead = await getRows<PersistedFeedRecord>("/feeds/records?mode=byof", "records", isRecordRow);
    if ("failure" in recordsRead) return unavailableFeed(recordsRead.failure);
    const followingRead = await getRows<PersistedFeedRecord>("/feeds/records?mode=following", "records", isRecordRow);
    if ("failure" in followingRead) return unavailableFeed(followingRead.failure);

    // The display names resolve SOFTLY through the sources read: a
    // source-list failure never hides the imported feed itself — the
    // connector id is the honest plain fallback name (never fabricated).
    const displayNames = new Map<string, string>();
    const sourcesRead = await getRows<ByofSourceOptionView>("/feeds/sources", "sources", isSourceOption);
    if ("rows" in sourcesRead) {
      for (const source of sourcesRead.rows) displayNames.set(source.connectorId, source.displayName);
    }

    const relationshipCounts: Record<string, number> = {};
    for (const record of recordsRead.rows) {
      const key = record.provenance.relationship;
      relationshipCounts[key] = (relationshipCounts[key] ?? 0) + 1;
    }
    // The feed region renders imports that still own records — the
    // records-driven rule: a confirmed import keeps rendering through
    // EVERY durable state (live, stale, reauthorization-required, and the
    // user-disconnect fold — the records are RETAINED). An import whose
    // records the user explicitly deleted stops rendering (its rows
    // remain as the store's audit trail).
    const feedImports: ByofImportFeedView[] = [];
    for (const row of importsRead.rows) {
      const own = recordsRead.rows.filter((record) => record.importId === row.id);
      if (own.length === 0) continue;
      feedImports.push({
        import: byofImportViewOf(row, own, displayNames.get(row.connectorId) ?? row.connectorId),
        groups: byofRecordGroupsOf(own),
      });
    }
    return {
      state: "ready",
      imports: feedImports,
      followingCount: followingRead.rows.length,
      relationshipCounts,
    };
  }

  /** The newest staged preview's view (the panel's default preview). */
  async function newestStagedPreview(
    imports: readonly PersistedFeedImport[],
    displayNames: ReadonlyMap<string, string>,
  ): Promise<ByofPreviewView | null | { readonly failure: ByofFailure }> {
    const staged = imports.find((row) => row.status === "preview");
    return staged === undefined ? null : previewView(staged.id, displayNames);
  }

  /** The staged preview's view (only for a preview-status import). */
  async function previewView(
    importId: string,
    displayNames: ReadonlyMap<string, string>,
  ): Promise<ByofPreviewView | null | { readonly failure: ByofFailure }> {
    const read = await getStagedPreview(importId);
    if ("failure" in read) return { failure: read.failure };
    if ("absent" in read) return null;
    const preview = read.preview;
    const sample: ByofRecordView[] = preview.items.map((item) => ({
      externalRef: item.externalRef,
      title: item.title ?? item.externalRef,
      sourceOrder: item.sourceOrder,
      entertainmentItemId: item.entertainmentItemId,
      capturedAt: item.capturedAt,
      relationship: item.relationship,
      ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
    }));
    return byofPreviewViewOf({
      importId: preview.importId,
      connectorId: preview.connectorId,
      itemCount: preview.itemCount,
      relationshipCounts: preview.relationshipCounts,
      freshness: preview.freshness,
      continuousSync: preview.continuousSync,
      displayName: displayNames.get(preview.connectorId) ?? preview.connectorId,
      sample,
    });
  }

  // -- the actions -----------------------------------------------------------

  async function startPreview(input: { connectorId: string }): Promise<ByofResult<{ importId: string }>> {
    const outcome = await request(
      "POST",
      endpoint("/feeds/preview"),
      JSON.stringify({ connectorId: input.connectorId }),
    );
    return actionOutcome(outcome, (body) => {
      const preview = (body as Record<string, unknown>).preview;
      if (!isStagedPreview(preview)) return null;
      return { importId: preview.importId };
    });
  }

  async function confirm(importId: string): Promise<ByofResult<{ importId: string; itemCount: number }>> {
    const outcome = await request(
      "POST",
      endpoint(`/feeds/preview/${encodeURIComponent(importId)}/confirm`),
      JSON.stringify({}),
    );
    return actionOutcome(outcome, (body) => {
      const row = (body as Record<string, unknown>).import;
      if (!isImportRow(row)) return null;
      return { importId: row.id, itemCount: row.itemCount };
    });
  }

  async function sync(importId: string): Promise<ByofResult<ByofSyncReportView>> {
    const outcome = await request(
      "POST",
      endpoint(`/feeds/imports/${encodeURIComponent(importId)}/sync`),
      JSON.stringify({}),
    );
    return actionOutcome(outcome, (body) => {
      const report = (body as Record<string, unknown>).report as Record<string, unknown> | undefined;
      const row = (body as Record<string, unknown>).import;
      if (
        report === undefined ||
        !isImportRow(row) ||
        typeof report.added !== "number" ||
        typeof report.updated !== "number" ||
        typeof report.removed !== "number" ||
        typeof report.kept !== "number"
      ) {
        return null;
      }
      return {
        importId,
        added: report.added,
        updated: report.updated,
        removed: report.removed,
        kept: report.kept,
        syncState: row.syncState as FeedSyncState,
      };
    });
  }

  async function disconnect(importId: string): Promise<ByofResult<{ importId: string }>> {
    const outcome = await request(
      "POST",
      endpoint(`/feeds/imports/${encodeURIComponent(importId)}/disconnect`),
      JSON.stringify({}),
    );
    return actionOutcome(outcome, () => ({ importId }));
  }

  async function deleteRecords(importId: string): Promise<ByofResult<{ removed: number }>> {
    const outcome = await request(
      "POST",
      endpoint(`/feeds/imports/${encodeURIComponent(importId)}/delete-records`),
      JSON.stringify({}),
    );
    return actionOutcome(outcome, (body) => {
      const removed = (body as Record<string, unknown>).removed;
      return typeof removed === "number" ? { removed } : null;
    });
  }

  async function discardPreview(importId: string): Promise<ByofResult<{ importId: string }>> {
    const outcome = await request(
      "POST",
      endpoint(`/feeds/preview/${encodeURIComponent(importId)}/discard`),
      JSON.stringify({}),
    );
    return actionOutcome(outcome, (body) => {
      const id = (body as Record<string, unknown>).importId;
      return typeof id === "string" ? { importId: id } : null;
    });
  }

  /** Fold one action's raw outcome: typed failure, or the validated value. */
  function actionOutcome<T>(
    outcome: RawOutcome,
    readValue: (body: unknown) => T | null,
  ): ByofResult<T> {
    if (!outcome.ok) return { ok: false, failure: outcome.failure };
    const value = readValue(outcome.body);
    if (value === null) {
      return {
        ok: false,
        failure: {
          kind: "transport",
          detail: "the service answered a malformed success body (never a fabricated result)",
        },
      };
    }
    return { ok: true, value };
  }

  return {
    panelView,
    feedView,
    startPreview,
    confirm,
    sync,
    disconnect,
    deleteRecords,
    discardPreview,
  };
}

/** The honest unavailable panel view for a failed read. */
function unavailablePanel(failure: ByofFailure): ByofPanelView {
  return {
    state: "unavailable",
    detail: `${failure.detail} (the BYOF panel could not be read from the WebFlix service)`,
    sources: [],
    imports: [],
    preview: null,
  };
}

/** The honest unavailable feed view for a failed read. */
function unavailableFeed(failure: ByofFailure): ByofFeedView {
  return {
    state: "unavailable",
    detail: `${failure.detail} (your imported feed could not be read from the WebFlix service)`,
    imports: [],
    followingCount: 0,
    relationshipCounts: {},
  };
}
