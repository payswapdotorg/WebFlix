/**
 * @wfx/client-runtime — the source-state store (R03, source management).
 *
 * The runtime's model of the user's CONNECTED SOURCES: the
 * settings/sources surface's data. The layering law decides who owns what:
 *
 * - The runtime OWNS the observed state model — refresh from the
 *   `ServerPort.readSources()` read, observe post-flow transitions, expose
 *   the typed read model + subscription.
 * - The ADAPTER owns the flows — the OAuth/device/local handshake is a
 *   platform transport concern (browser redirects, provider consent pages,
 *   credential collection). When its flow completes, the adapter reports
 *   the resulting `SourceInfo` via `observe()`. The runtime NEVER runs the
 *   handshake and never guesses a transition: an observation is validated
 *   structurally and REPLACES the stored view for that connector (the
 *   server's /sources read remains the convergence point — the next
 *   `refresh()` reconciles everything).
 *
 * Honesty laws (the module's contract):
 * - A failing `readSources()` is an ERROR model — never a fake empty list;
 *   the last observed states stay visible (the model degrades in-band,
 *   exactly like the search read models).
 * - `refresh()` on an anonymous session answers whatever the server said —
 *   for the anonymous user that is the HONEST EMPTY list (no connected
 *   sources, never a fabricated one).
 * - `observe()` accepts only structurally valid `SourceInfo` — garbage
 *   throws the typed `RuntimeError` (caller misuse, the channel law).
 * - Determinism: no clock, no randomness, no fetching. Ordering is the
 *   connectorId sort (stable views for adapters that diff).
 */

import { isRecord, previewValue } from "@wfx/domain";
import type { Capability } from "@wfx/domain";
import type { Unsubscribe } from "@wfx/platform-contracts";

import { RuntimeError, serverFailureKind } from "./errors";
import { errorSection, readySection, type ModelSectionStatus } from "./models";
import {
  isSourceAuthMode,
  isSourceAuthState,
  type ServerPort,
  type SourceInfo,
} from "./server-port";

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/**
 * The sources read model (what the settings/sources surface renders): a
 * typed section status + the observed source truths. `status.state ===
 * "error"` keeps the LAST observed sources visible alongside the failure —
 * degradation is in-model, never a fake empty list.
 */
export interface SourcesModel {
  readonly status: ModelSectionStatus;
  /** The observed sources, sorted by connectorId (empty before the first refresh). */
  readonly sources: readonly SourceInfo[];
}

// ---------------------------------------------------------------------------
// Structural validation (defensive — observations may come from adapters)
// ---------------------------------------------------------------------------

const CAPABILITY_KEYS: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoInstantOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && ISO_INSTANT.test(value);
}

/**
 * Validate a claimed `SourceInfo` STRUCTURALLY. Throws the typed
 * `RuntimeError` (`invalid-input`) — the channel law for caller misuse.
 * Structural only: semantic truth (whether a source really is signed in)
 * belongs to the server; the runtime never fabricates it.
 */
export function assertValidSourceInfo(source: SourceInfo): void {
  if (!isRecord(source)) {
    throw new RuntimeError(
      "invalid-input",
      `source: expected a SourceInfo object, got ${previewValue(source)}`,
    );
  }
  const problems: string[] = [];
  if (typeof source.connectorId !== "string" || source.connectorId.length === 0) {
    problems.push(`source.connectorId: expected a non-empty string, got ${previewValue(source.connectorId)}`);
  }
  if (typeof source.displayName !== "string" || source.displayName.trim().length === 0) {
    problems.push(`source.displayName: expected a non-empty string, got ${previewValue(source.displayName)}`);
  }
  if (typeof source.version !== "string" || source.version.length === 0) {
    problems.push(`source.version: expected a non-empty string, got ${previewValue(source.version)}`);
  }
  if (!isSourceAuthMode(source.authMode)) {
    problems.push(
      `source.authMode: expected one of none | oauth | device | local, got ${previewValue(source.authMode)}`,
    );
  }
  if (!isRecord(source.capabilities)) {
    problems.push("source.capabilities: expected a capability truth record");
  } else {
    for (const key of CAPABILITY_KEYS) {
      if (typeof source.capabilities[key] !== "boolean") {
        problems.push(`source.capabilities.${key}: expected an explicit boolean (capability truth is never guessed)`);
      }
    }
  }
  if (!isSourceAuthState(source.authState)) {
    problems.push(
      `source.authState: expected one of signedOut | authorizing | signedIn | expired | failed, got ${previewValue(source.authState)}`,
    );
  }
  if (typeof source.requiresAuthorization !== "boolean") {
    problems.push(`source.requiresAuthorization: expected a boolean, got ${previewValue(source.requiresAuthorization)}`);
  }
  if (typeof source.connected !== "boolean") {
    problems.push(`source.connected: expected a boolean, got ${previewValue(source.connected)}`);
  }
  if (source.accountId !== null && (typeof source.accountId !== "string" || source.accountId.length === 0)) {
    problems.push(`source.accountId: expected a non-empty string or null, got ${previewValue(source.accountId)}`);
  }
  if (!isIsoInstantOrNull(source.authorizedAt)) {
    problems.push(`source.authorizedAt: expected an ISO instant or null, got ${previewValue(source.authorizedAt)}`);
  }
  if (!isIsoInstantOrNull(source.lastStateChange)) {
    problems.push(`source.lastStateChange: expected an ISO instant or null, got ${previewValue(source.lastStateChange)}`);
  }
  if (!isIsoInstantOrNull(source.expiresAt)) {
    problems.push(`source.expiresAt: expected an ISO instant or null, got ${previewValue(source.expiresAt)}`);
  }
  if (!Array.isArray(source.availabilityNotes)) {
    problems.push(`source.availabilityNotes: expected an array of strings, got ${previewValue(source.availabilityNotes)}`);
  } else {
    for (const note of source.availabilityNotes) {
      if (typeof note !== "string" || note.length === 0) {
        problems.push("source.availabilityNotes: expected non-empty strings");
        break;
      }
    }
  }
  if (typeof source.lastChecked !== "string" || !ISO_INSTANT.test(source.lastChecked)) {
    problems.push(`source.lastChecked: expected an ISO instant, got ${previewValue(source.lastChecked)}`);
  }
  if (problems.length > 0) {
    throw new RuntimeError("invalid-input", problems.join("; "));
  }
}

/** Structural check that NEVER throws (for filtering server answers). */
export function isUsableSourceInfo(value: unknown): value is SourceInfo {
  if (!isRecord(value)) return false;
  try {
    assertValidSourceInfo(value as unknown as SourceInfo);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Listener for observed source-state changes. */
export type SourceStateListener = (sources: readonly SourceInfo[]) => void;

/** The stable view order: by connectorId (adapters diff safely). */
function byConnectorId(a: SourceInfo, b: SourceInfo): number {
  return a.connectorId < b.connectorId ? -1 : a.connectorId > b.connectorId ? 1 : 0;
}

/**
 * The source-state operations the runtime exposes (the settings/sources
 * surface consumes them through `runtime.sources`).
 */
export interface SourceStateOperations {
  /** The currently observed sources (sorted by connectorId; empty before any refresh/observe). */
  list(): readonly SourceInfo[];
  /**
   * Refresh the observed state from the server (`readSources()`). Answers
   * the typed `SourcesModel`; a failure is an ERROR model (the last
   * observed sources stay visible — never a fake empty list).
   */
  refresh(): Promise<SourcesModel>;
  /**
   * Observe one post-flow state (the adapter reports after its
   * connect/disconnect UX completes). Validates structurally, replaces the
   * stored view for that connector, and notifies subscribers. The next
   * `refresh()` reconciles with the server's truth.
   */
  observe(source: SourceInfo): void;
  /** Subscribe to observed-state changes (list snapshots, oldest event first). */
  subscribe(listener: SourceStateListener): Unsubscribe;
}

/**
 * Create the source-state store over one server port. Pure bookkeeping: no
 * clock, no ids, no fetching beyond the port's own read. Created by
 * `createRuntime`; usable standalone in tests.
 *
 * A port that has not implemented the R03 `readSources` read yet (the
 * frozen R07/R08 adapters until the lead wires them — see server-port.ts's
 * ratification note) answers the honest `unavailable` ERROR model, never a
 * fake empty list.
 */
export function createSourceStateStore(server: ServerPort): SourceStateOperations {
  let observed: readonly SourceInfo[] = [];
  const listeners = new Set<SourceStateListener>();

  function emit(): void {
    const snapshot = [...observed];
    for (const listener of listeners) listener(snapshot);
  }

  function upsert(source: SourceInfo): void {
    const next = observed.filter((existing) => existing.connectorId !== source.connectorId);
    next.push(source);
    next.sort(byConnectorId);
    observed = next;
  }

  return {
    list: () => [...observed],

    async refresh(): Promise<SourcesModel> {
      if (typeof server.readSources !== "function") {
        return {
          status: errorSection(
            "unavailable",
            "the adapter transport has not implemented the source read yet (ServerPort.readSources — the R03 extension; the settings/sources surface needs it)",
          ),
          sources: [...observed],
        };
      }
      const result = await server.readSources();
      if (!result.ok) {
        // In-model degradation: the last observed states stay visible; the
        // failure is an ERROR section — never a fake empty list.
        return {
          status: errorSection(serverFailureKind(result.failure), result.failure.detail),
          sources: [...observed],
        };
      }
      const usable: SourceInfo[] = [];
      for (const source of result.value) {
        if (isUsableSourceInfo(source)) {
          usable.push(source);
        }
        // Malformed rows are skipped (documented; a broken row is never a
        // source card) — the server's own guard is the primary belt.
      }
      usable.sort(byConnectorId);
      observed = usable;
      emit();
      return { status: readySection(), sources: [...observed] };
    },

    observe(source: SourceInfo): void {
      assertValidSourceInfo(source);
      upsert(source);
      emit();
    },

    subscribe(listener: SourceStateListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
