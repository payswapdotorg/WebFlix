/**
 * @wfx/app-api — the app-level fan-out connector (WFX-055A).
 *
 * The frozen architecture expects the service lane to compose MULTIPLE
 * content sources behind the single `Ports.connector` seam (the WFX-012
 * registry patterns). No frozen composite connector exists, so this module
 * builds the THIN app-level fan-out INSIDE apps/api (frozen packages are
 * never edited — the drift rule):
 *
 * - **webflix-catalog** (PRIMARY, always wired): the 052
 *   `PostgresCatalogConnector` over the Neon Entertainment Graph — search,
 *   metadata, resolve, like/save actions, and the user library, all real
 *   SQL against the seeded catalog.
 * - **youtube** (SECONDARY, wired only when the operator provisioned
 *   `YOUTUBE_*`): the WFX-054 `YouTubeConnector` over the real Data API
 *   v3. Without credentials it is simply not wired; with an API key but no
 *   OAuth tokens its user-scoped calls degrade typed (`unauthorized` → the
 *   fan-out just gets no contribution from it) — never an outage, never a
 *   fabricated result.
 *
 * CONNECTOR IDENTITY — why answers carry `wfx-experience-service`:
 *
 * The frozen web client (`apps/web/src/host/remote-ports.ts`) presents its
 * remote connector as `wfx-experience-service` — "it names the SERVICE, not
 * any concrete provider" — and the frozen web use-cases validate that an
 * action's `connectorId` equals the PORT's descriptor id. For the end-to-end
 * action path to work, the service must therefore present ONE connector
 * identity, and it must be the same id: every `SearchResult`, `SourceItem`,
 * `PlaybackRealization`, and `LibraryEntry` this fan-out returns is
 * rewritten to `EXPERIENCE_SERVICE_CONNECTOR_ID`. Source attribution is NOT
 * lost — it lives in the service's diagnostics (`lastDegradations`), the
 * routing decisions below, and the `source_realizations` graph; the client
 * simply has no per-source surface in the frozen contract.
 *
 * Routing semantics (deterministic, documented, test-pinned):
 *
 * - `search` — fans out to ALL wired sources (concurrently; results are
 *   collected by SOURCE ORDER, not completion order), rewrites ids, and
 *   dedupes by `externalRef` (first-wins in probe order). A source that
 *   THROWS contributes nothing and is recorded in `lastDegradations` — one
 *   source's outage never takes down the merge.
 * - `metadata` / `resolve` — SEQUENTIAL probe in wiring order (primary
 *   first): the first source with an answer wins. The frozen `externalRef`
 *   is opaque per source (raw YouTube video ids both here), so there is no
 *   id/ref prefix to route by — probe order is the frozen convention.
 * - `executeAction` — routes by `action.connectorId`: an exact match on a
 *   wired source's own id goes to that source; the service id probes in
 *   wiring order (the action's id is rewritten to each probed source —
 *   the SDK law that an action is bound to its own connector); any other
 *   id is an honest failed receipt naming the wired sources.
 * - `readLibrary` — fans out to all sources, merges, dedupes by
 *   `externalRef` (first-wins), rewrites ids.
 * - `writeLibrary` — the frozen `LibraryCommand` carries no connector id,
 *   so it probes in wiring order: the first source that answers a
 *   non-`failed` receipt wins; if every source fails, one honest failed
 *   receipt carries every source's detail.
 *
 * Capability truth: the descriptor's capabilities are the UNION of what is
 * actually wired, in the canonical frozen order — a capability nobody
 * provides is never declared, and a capability any source provides is
 * always declared. The `auth` of the service binding is `none`: the service
 * requires no auth from ITS clients (the YouTube OAuth dance is per-source,
 * behind this seam).
 *
 * Degradation honesty: a source that throws contributes its typed empty
 * answer (reads) or a failed receipt (writes) and the failure is recorded
 * per source in `lastDegradations()` — diagnosable, never silent, never
 * fabricated.
 *
 * R03 — AUTH-STATE-AWARE QUERYING: with an `authGate` wired, every
 * per-source call FIRST honors the source's CURRENT per-user authorization
 * state: a signedOut/expired/authorizing/failed source is SKIPPED with an
 * honest per-source note in `lastSourceSkips()` (a signedOut source is
 * never an error and never silently queried; an expired source surfaces
 * `expired` — the J28 journey seed). A gate failure degrades to ungated
 * operation (each source's own typed degradation still covers it). Without
 * a gate the fan-out behaves EXACTLY as before (the gate is additive).
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  ConnectorDescriptor,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { isRecord } from "@wfx/domain";
import { describeThrown, isUsableReceipt, type Clock, type ConnectorPort } from "@wfx/experience";

/**
 * The connector id this service presents — the SAME id the frozen web
 * client binds to (`REMOTE_CONNECTOR_ID` in apps/web/src/host/remote-ports.ts).
 * Names the SERVICE, never a concrete provider.
 */
export const EXPERIENCE_SERVICE_CONNECTOR_ID = "wfx-experience-service";

/**
 * The canonical capability order for the union descriptor (the frozen
 * `Capability` vocabulary, in the same order the web client's provisional
 * remote descriptor uses). Union members not in a wired source's descriptor
 * are not declared.
 */
const CANONICAL_CAPABILITY_ORDER: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

/** The closed `UserAction.type` vocabulary (runtime mirror of the frozen union). */
const USER_ACTION_TYPES: readonly string[] = [
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

/** Options for {@link createFanOutConnector}. */
export interface FanOutConnectorOptions {
  /**
   * The wired sources in PROBE ORDER: `sources[0]` is the primary (the
   * webflix-catalog connector); any later source is a secondary probed
   * only when the earlier ones could not answer.
   */
  readonly sources: readonly ConnectorPort[];
  /** The clock — stamps fan-out-level (routing) failure receipts. */
  readonly clock: Clock;
  /** The descriptor version (default: the service version). */
  readonly version?: string;
  /**
   * R03 — the per-USER source auth gate: resolves each wired source's
   * CURRENT authorization state for the request's user (the source-
   * management service's `authGateFor`). A source the gate marks unusable
   * is SKIPPED with an honest per-source note (`lastSourceSkips`) — a
   * signedOut source is never queried, an expired source surfaces
   * `expired` (the J28 journey seed), and a source absent from the gate's
   * map is queried ungated (its own typed degradation covers it).
   */
  readonly authGate?: FanOutAuthGate;
}

/** One wired source's CURRENT auth state as the fan-out sees it (R03). */
export interface FanOutSourceAuthState {
  readonly connectorId: string;
  readonly session: "signedOut" | "authorizing" | "signedIn" | "expired" | "failed";
  /** Usable for authenticated operations (auth:none sources: always). */
  readonly usable: boolean;
  /** Optional honest detail (e.g. the expiry instant). */
  readonly detail?: string;
}

/** The per-user auth-state resolver (R03) — see FanOutConnectorOptions. */
export type FanOutAuthGate = (
  ctx: ConnectorContext,
) => Promise<ReadonlyMap<string, FanOutSourceAuthState>>;

/**
 * The fan-out connector: a `ConnectorPort` whose optional library methods
 * are ALWAYS present (the fan-out implements them over its sources), plus
 * the honest diagnostics surface. Re-declared as required here so route
 * handlers can call them without undefined checks — the object built by
 * {@link createFanOutConnector} always provides both.
 */
export interface FanOutConnector extends ConnectorPort {
  /** The wired source ids, in probe order (diagnostics + routing docs). */
  readonly sourceIds: readonly string[];
  /**
   * Per-source degradation diary: source id → the last failure that source
   * contributed to a fan-out call (thrown errors AND failed receipts).
   * Never used to answer — only to diagnose. Empty map = everything healthy.
   */
  lastDegradations(): ReadonlyMap<string, string>;
  /**
   * R03 — the per-source SKIP diary: source id → the last honest auth-state
   * note that skipped the source from a fan-out call (signed out / expired
   * / authorizing / failed). Skips are HONEST STATES, not failures — they
   * live apart from `lastDegradations`; a signedOut source skipped with a
   * note is never an error and never silently queried.
   */
  lastSourceSkips(): ReadonlyMap<string, string>;
  /** The merged library read (always implemented — see the class doc). */
  readLibrary(ctx: ConnectorContext): Promise<LibraryEntry[]>;
  /** The probed library write (always implemented — see the class doc). */
  writeLibrary(ctx: ConnectorContext, command: LibraryCommand): Promise<ActionReceipt>;
  /**
   * R02: the PROFILE-SCOPED library read — the WebFlix-owned service
   * library for one effective profile (cross-device saves). Sources that
   * implement {@link ProfileScopedSource} contribute; provider-scoped
   * libraries (per OAuth account) do not — their profile binding is R03's
   * authorization lane, honestly out of scope here.
   */
  readLibraryForProfile(profileId: string): Promise<LibraryEntry[]>;
  /** R02: the PROFILE-SCOPED library write (probe order, first non-failed wins). */
  writeLibraryForProfile(
    ctx: ConnectorContext,
    profileId: string,
    command: LibraryCommand,
  ): Promise<ActionReceipt>;
  /**
   * R02: `executeAction` with an EXPLICIT profile key — the action routes
   * exactly like `executeAction` (by connectorId, capability-gated), but
   * profile-aware sources attribute saves/events to the given profile;
   * sources without profile support take their normal ctx path.
   */
  executeActionForProfile(
    ctx: ConnectorContext,
    profileId: string,
    action: UserAction,
  ): Promise<ActionReceipt>;
}

/**
 * R02: the structural seam a source implements to participate in
 * profile-scoped operations (the 052 `PostgresCatalogConnector` does; a
 * provider connector whose library is OAuth-account-scoped honestly does
 * not — its writes ride the normal ctx path).
 */
export interface ProfileScopedSource {
  executeActionForProfile(
    ctx: ConnectorContext,
    profileId: string,
    action: UserAction,
  ): Promise<ActionReceipt>;
  readLibraryForProfile(profileId: string): Promise<LibraryEntry[]>;
  writeLibraryForProfile(
    ctx: ConnectorContext,
    profileId: string,
    command: LibraryCommand,
  ): Promise<ActionReceipt>;
}

/** One wired source (the connector plus its cached descriptor). */
interface WiredSource {
  readonly connector: ConnectorPort;
  readonly id: string;
  readonly capabilities: readonly Capability[];
}

/** Stamp an ISO instant from the injected clock (never a hidden wall clock). */
function isoNow(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

/** Rewrite a search hit / source item / library entry to the service binding id. */
function rewriteReferring<T extends { connectorId: string }>(value: T): T {
  return { ...value, connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID };
}

/** Rewrite a playback realization to the service binding id. */
function rewriteRealization(realization: PlaybackRealization): PlaybackRealization {
  return { ...realization, connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID };
}

/**
 * Build the fan-out connector over the wired sources. The `sources` array
 * MUST be non-empty (the primary catalog connector is always wired by the
 * boot composition; an empty fan-out is a programmer error, thrown loudly).
 */
export function createFanOutConnector(options: FanOutConnectorOptions): FanOutConnector {
  if (options.sources.length === 0) {
    throw new Error(
      "createFanOutConnector: at least one source is required (the primary webflix-catalog connector)",
    );
  }

  const clock = options.clock;
  const sources: WiredSource[] = options.sources.map((connector) => {
    const descriptor = connector.descriptor();
    return { connector, id: descriptor.id, capabilities: [...descriptor.capabilities] };
  });
  const sourceIds = sources.map((source) => source.id);

  // The honest union: every capability ANY wired source declares.
  const union = new Set<Capability>();
  for (const source of sources) {
    for (const capability of source.capabilities) union.add(capability);
  }
  const capabilities = CANONICAL_CAPABILITY_ORDER.filter((capability) => union.has(capability));

  const degradations = new Map<string, string>();
  const skips = new Map<string, string>();

  function record(sourceId: string, detail: string): void {
    degradations.set(sourceId, detail);
  }

  function recordSkip(sourceId: string, note: string): void {
    skips.set(sourceId, note);
  }

  /**
   * R03: resolve the per-user gate ONCE per fan-out call. A gate failure is
   * a degradation (named, logged in the diary) — the call proceeds UNGATED
   * (each source's own typed degradation covers its failures honestly).
   */
  async function resolveGate(
    ctx: ConnectorContext,
  ): Promise<ReadonlyMap<string, FanOutSourceAuthState> | null> {
    if (options.authGate === undefined) return null;
    try {
      return await options.authGate(ctx);
    } catch (thrown) {
      record("auth-gate", `auth gate failed: ${describeThrown(thrown)} — proceeding ungated`);
      return null;
    }
  }

  /**
   * The honest skip note for a gated-out source, or null when the source
   * should be queried (usable, or the gate did not speak for it).
   */
  function gateSkipNote(state: FanOutSourceAuthState): string | null {
    if (state.usable) return null;
    switch (state.session) {
      case "signedOut":
        return "skipped: the source is signed out — connect it in settings";
      case "expired":
        return `expired: ${
          state.detail ?? "the stored authorization expired"
        } — reauthorize the source`;
      case "authorizing":
        return "skipped: the connection is in progress (authorizing)";
      case "failed":
        return `skipped: the authorization failed${
          state.detail !== undefined ? ` (${state.detail})` : ""
        } — reconnect the source`;
      case "signedIn":
        // usable=false but signedIn (a gate inconsistency): the source's
        // own truth decides — query it.
        return null;
    }
  }

  /** The skip note for one source under one resolved gate (null = query). */
  function skipFor(
    gate: ReadonlyMap<string, FanOutSourceAuthState> | null,
    source: WiredSource,
  ): string | null {
    if (gate === null) return null;
    const state = gate.get(source.id);
    if (state === undefined) return null;
    return gateSkipNote(state);
  }

  /**
   * Run one source's read-shaped call; a thrown error degrades to the
   * fallback value for THAT source and is recorded — never an outage.
   */
  async function guardedRead<T>(
    source: WiredSource,
    operation: string,
    call: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await call();
    } catch (thrown) {
      const detail = describeThrown(thrown);
      record(source.id, `${operation}: ${detail}`);
      return fallback;
    }
  }

  /** Call a source's optional library read (absent method ⇒ empty). */
  async function readLibraryOf(source: WiredSource, ctx: ConnectorContext): Promise<LibraryEntry[]> {
    if (typeof source.connector.readLibrary !== "function") return [];
    return source.connector.readLibrary(ctx);
  }

  /** The R02 profile-scoped twin of a source read, when the source supports it. */
  async function readProfileLibraryOf(source: WiredSource, profileId: string): Promise<LibraryEntry[] | null> {
    const scoped = source.connector as Partial<ProfileScopedSource>;
    if (typeof scoped.readLibraryForProfile !== "function") return null;
    return scoped.readLibraryForProfile(profileId);
  }

  const connector: FanOutConnector = {
    sourceIds,

    lastDegradations() {
      return new Map(degradations);
    },

    lastSourceSkips() {
      return new Map(skips);
    },

    descriptor(): ConnectorDescriptor {
      return {
        id: EXPERIENCE_SERVICE_CONNECTOR_ID,
        version: options.version ?? "1.0.0",
        displayName: `WebFlix Experience Service (fan-out: ${sourceIds.join(" + ")})`,
        capabilities: [...capabilities],
        auth: "none",
      };
    },

    async search(ctx: ConnectorContext, query: string): Promise<SearchResult[]> {
      if (typeof query !== "string" || query.trim().length === 0) return [];
      const gate = await resolveGate(ctx);
      // Fan out concurrently; collect by SOURCE ORDER (not completion
      // order) so the merge is deterministic.
      const perSource = await Promise.all(
        sources.map((source) => {
          const skip = skipFor(gate, source);
          if (skip !== null) {
            recordSkip(source.id, `search: ${skip}`);
            return Promise.resolve([] as SearchResult[]);
          }
          return guardedRead(source, "search", () => source.connector.search(ctx, query), [] as SearchResult[]);
        }),
      );
      const seen = new Set<string>();
      const merged: SearchResult[] = [];
      for (const hits of perSource) {
        if (!Array.isArray(hits)) continue;
        for (const hit of hits) {
          if (!isRecord(hit)) continue;
          if (typeof hit.externalRef !== "string" || hit.externalRef.length === 0) continue;
          // After the id rewrite both sources present the same binding id,
          // so the SAME video discovered by two sources would be a literal
          // duplicate — dedupe by externalRef, first-wins (probe order).
          if (seen.has(hit.externalRef)) continue;
          seen.add(hit.externalRef);
          merged.push(rewriteReferring(hit as unknown as SearchResult));
        }
      }
      return merged;
    },

    async metadata(ctx: ConnectorContext, ref: string): Promise<SourceItem | null> {
      if (typeof ref !== "string" || ref.length === 0) return null;
      const gate = await resolveGate(ctx);
      for (const source of sources) {
        const skip = skipFor(gate, source);
        if (skip !== null) {
          recordSkip(source.id, `metadata: ${skip}`);
          continue; // a skip is not an answer — probe the next source
        }
        const item = await guardedRead(
          source,
          "metadata",
          () => source.connector.metadata(ctx, ref),
          null as SourceItem | null,
        );
        if (item !== null) return rewriteReferring(item);
      }
      return null;
    },

    async resolve(ctx: ConnectorContext, ref: string): Promise<PlaybackRealization[]> {
      if (typeof ref !== "string" || ref.length === 0) return [];
      const gate = await resolveGate(ctx);
      for (const source of sources) {
        const skip = skipFor(gate, source);
        if (skip !== null) {
          recordSkip(source.id, `resolve: ${skip}`);
          continue; // a skip is not an answer — probe the next source
        }
        const realizations = await guardedRead(
          source,
          "resolve",
          () => source.connector.resolve(ctx, ref),
          [] as PlaybackRealization[],
        );
        if (Array.isArray(realizations) && realizations.length > 0) {
          return realizations.map(rewriteRealization);
        }
      }
      return [];
    },

    async executeAction(ctx: ConnectorContext, action: UserAction): Promise<ActionReceipt> {
      const occurredAt = isoNow(clock);
      if (!isRecord(action) || typeof action.type !== "string") {
        return { status: "failed", detail: "action: expected a UserAction object", occurredAt };
      }
      if (!USER_ACTION_TYPES.includes(action.type)) {
        return {
          status: "failed",
          detail: `action.type: expected one of ${USER_ACTION_TYPES.join(" | ")}, got '${action.type}'`,
          occurredAt,
        };
      }
      if (typeof action.connectorId !== "string" || action.connectorId.length === 0) {
        return {
          status: "failed",
          detail: "action.connectorId: expected a non-empty string",
          occurredAt,
        };
      }
      if (typeof action.externalRef !== "string" || action.externalRef.length === 0) {
        return {
          status: "failed",
          detail: "action.externalRef: expected a non-empty string",
          occurredAt,
        };
      }

      // Capability truth of the UNION: nobody wired declares this action's
      // capability — the honest unsupported receipt, no source is probed.
      if (!union.has(action.type as Capability)) {
        return {
          status: "unsupported",
          detail: `capability '${action.type}' is not declared by any wired source (${sourceIds.join(", ")})`,
          occurredAt,
        };
      }

      // Routing: an exact source-id match goes to that source alone; the
      // service binding id probes in wiring order; anything else is an
      // honest failed receipt naming what IS wired.
      const named = sources.find((source) => source.id === action.connectorId);
      const targets =
        named !== undefined
          ? [named]
          : action.connectorId === EXPERIENCE_SERVICE_CONNECTOR_ID
            ? sources
            : null;
      if (targets === null) {
        return {
          status: "failed",
          detail:
            `action targets connector '${action.connectorId}' but this service presents ` +
            `'${EXPERIENCE_SERVICE_CONNECTOR_ID}' (wired sources: ${sourceIds.join(", ")})`,
          occurredAt,
        };
      }

      const gate = await resolveGate(ctx);
      const failures: string[] = [];
      for (const source of targets) {
        // R03: a gated-out source answers the honest failed receipt naming
        // its auth state (an expired source surfaces `expired` — J28).
        const skip = skipFor(gate, source);
        if (skip !== null) {
          recordSkip(source.id, `executeAction: ${skip}`);
          failures.push(`${source.id}: ${skip}`);
          continue;
        }
        // Rewrite the binding id to the probed source's own id — the SDK
        // law that an action is bound to its own connector.
        const routed: UserAction = { ...action, connectorId: source.id };
        let receipt: ActionReceipt;
        try {
          receipt = await source.connector.executeAction(ctx, routed);
        } catch (thrown) {
          const detail = describeThrown(thrown);
          record(source.id, `executeAction: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (!isUsableReceipt(receipt)) {
          const detail = "executeAction answered a malformed ActionReceipt";
          record(source.id, `executeAction: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (receipt.status !== "failed") return receipt;
        const detail = receipt.detail ?? "failed";
        record(source.id, `executeAction: ${detail}`);
        failures.push(`${source.id}: ${detail}`);
      }
      return {
        status: "failed",
        detail: `no wired source could execute the action — ${failures.join("; ")}`,
        occurredAt,
      };
    },

    async readLibrary(ctx: ConnectorContext): Promise<LibraryEntry[]> {
      const gate = await resolveGate(ctx);
      const perSource = await Promise.all(
        sources.map((source) => {
          const skip = skipFor(gate, source);
          if (skip !== null) {
            recordSkip(source.id, `readLibrary: ${skip}`);
            return Promise.resolve([] as LibraryEntry[]);
          }
          return guardedRead(source, "readLibrary", () => readLibraryOf(source, ctx), [] as LibraryEntry[]);
        }),
      );
      const seen = new Set<string>();
      const merged: LibraryEntry[] = [];
      for (const entries of perSource) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!isRecord(entry)) continue;
          if (typeof entry.externalRef !== "string" || entry.externalRef.length === 0) continue;
          if (seen.has(entry.externalRef)) continue;
          seen.add(entry.externalRef);
          merged.push(rewriteReferring(entry as unknown as LibraryEntry));
        }
      }
      return merged;
    },

    async readLibraryForProfile(profileId: string): Promise<LibraryEntry[]> {
      // R02: only sources that OWN a service-side library contribute (the
      // webflix-catalog); provider-scoped libraries are R03's lane.
      // (No auth gate here: the profile library is the WebFlix-owned
      // service library, not a provider-scoped read.)
      const perSource = await Promise.all(
        sources.map((source) =>
          guardedRead(
            source,
            "readLibraryForProfile",
            () => readProfileLibraryOf(source, profileId),
            null as LibraryEntry[] | null,
          ),
        ),
      );
      const seen = new Set<string>();
      const merged: LibraryEntry[] = [];
      for (const entries of perSource) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!isRecord(entry)) continue;
          if (typeof entry.externalRef !== "string" || entry.externalRef.length === 0) continue;
          if (seen.has(entry.externalRef)) continue;
          seen.add(entry.externalRef);
          merged.push(rewriteReferring(entry as unknown as LibraryEntry));
        }
      }
      return merged;
    },

    async writeLibrary(ctx: ConnectorContext, command: LibraryCommand): Promise<ActionReceipt> {
      const occurredAt = isoNow(clock);
      if (!isRecord(command) || (command.op !== "add" && command.op !== "remove")) {
        return {
          status: "failed",
          detail: "command.op: expected 'add' or 'remove'",
          occurredAt,
        };
      }
      if (typeof command.externalRef !== "string" || command.externalRef.length === 0) {
        return {
          status: "failed",
          detail: "command.externalRef: expected a non-empty string",
          occurredAt,
        };
      }
      if (!union.has("libraryWrite")) {
        return {
          status: "unsupported",
          detail: `capability 'libraryWrite' is not declared by any wired source (${sourceIds.join(", ")})`,
          occurredAt,
        };
      }

      // The frozen LibraryCommand carries no connector id — probe in wiring
      // order; the first source that answers a non-failed receipt wins.
      const gate = await resolveGate(ctx);
      const failures: string[] = [];
      for (const source of sources) {
        const skip = skipFor(gate, source);
        if (skip !== null) {
          recordSkip(source.id, `writeLibrary: ${skip}`);
          failures.push(`${source.id}: ${skip}`);
          continue;
        }
        if (typeof source.connector.writeLibrary !== "function") {
          failures.push(`${source.id}: writeLibrary not implemented`);
          continue;
        }
        let receipt: ActionReceipt;
        try {
          receipt = await source.connector.writeLibrary(ctx, command);
        } catch (thrown) {
          const detail = describeThrown(thrown);
          record(source.id, `writeLibrary: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (!isUsableReceipt(receipt)) {
          const detail = "writeLibrary answered a malformed ActionReceipt";
          record(source.id, `writeLibrary: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (receipt.status !== "failed") return receipt;
        const detail = receipt.detail ?? "failed";
        record(source.id, `writeLibrary: ${detail}`);
        failures.push(`${source.id}: ${detail}`);
      }
      return {
        status: "failed",
        detail: `no wired source could execute the library command — ${failures.join("; ")}`,
        occurredAt,
      };
    },

    async writeLibraryForProfile(
      ctx: ConnectorContext,
      profileId: string,
      command: LibraryCommand,
    ): Promise<ActionReceipt> {
      const occurredAt = isoNow(clock);
      if (!isRecord(command) || (command.op !== "add" && command.op !== "remove")) {
        return {
          status: "failed",
          detail: "command.op: expected 'add' or 'remove'",
          occurredAt,
        };
      }
      if (typeof command.externalRef !== "string" || command.externalRef.length === 0) {
        return {
          status: "failed",
          detail: "command.externalRef: expected a non-empty string",
          occurredAt,
        };
      }
      if (typeof profileId !== "string" || profileId.length === 0) {
        return {
          status: "failed",
          detail: "profileId: expected a non-empty string",
          occurredAt,
        };
      }
      if (!union.has("libraryWrite")) {
        return {
          status: "unsupported",
          detail: `capability 'libraryWrite' is not declared by any wired source (${sourceIds.join(", ")})`,
          occurredAt,
        };
      }

      // Same probe law as writeLibrary, but profile-aware sources take the
      // explicit profile; a source without profile support honestly says so
      // (it cannot attribute this write).
      const gate = await resolveGate(ctx);
      const failures: string[] = [];
      for (const source of sources) {
        const skip = skipFor(gate, source);
        if (skip !== null) {
          recordSkip(source.id, `writeLibraryForProfile: ${skip}`);
          failures.push(`${source.id}: ${skip}`);
          continue;
        }
        const scoped = source.connector as Partial<ProfileScopedSource>;
        if (typeof scoped.writeLibraryForProfile !== "function") {
          failures.push(`${source.id}: writeLibraryForProfile not implemented`);
          continue;
        }
        let receipt: ActionReceipt;
        try {
          receipt = await scoped.writeLibraryForProfile(ctx, profileId, command);
        } catch (thrown) {
          const detail = describeThrown(thrown);
          record(source.id, `writeLibraryForProfile: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (!isUsableReceipt(receipt)) {
          const detail = "writeLibraryForProfile answered a malformed ActionReceipt";
          record(source.id, `writeLibraryForProfile: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (receipt.status !== "failed") return receipt;
        const detail = receipt.detail ?? "failed";
        record(source.id, `writeLibraryForProfile: ${detail}`);
        failures.push(`${source.id}: ${detail}`);
      }
      return {
        status: "failed",
        detail: `no wired source could execute the profile-scoped library command — ${failures.join("; ")}`,
        occurredAt,
      };
    },

    async executeActionForProfile(
      ctx: ConnectorContext,
      profileId: string,
      action: UserAction,
    ): Promise<ActionReceipt> {
      const occurredAt = isoNow(clock);
      if (!isRecord(action) || typeof action.type !== "string") {
        return { status: "failed", detail: "action: expected a UserAction object", occurredAt };
      }
      if (typeof profileId !== "string" || profileId.length === 0) {
        return {
          status: "failed",
          detail: "profileId: expected a non-empty string",
          occurredAt,
        };
      }
      if (!USER_ACTION_TYPES.includes(action.type)) {
        return {
          status: "failed",
          detail: `action.type: expected one of ${USER_ACTION_TYPES.join(" | ")}, got '${action.type}'`,
          occurredAt,
        };
      }
      if (typeof action.connectorId !== "string" || action.connectorId.length === 0) {
        return {
          status: "failed",
          detail: "action.connectorId: expected a non-empty string",
          occurredAt,
        };
      }
      if (typeof action.externalRef !== "string" || action.externalRef.length === 0) {
        return {
          status: "failed",
          detail: "action.externalRef: expected a non-empty string",
          occurredAt,
        };
      }
      if (!union.has(action.type as Capability)) {
        return {
          status: "unsupported",
          detail: `capability '${action.type}' is not declared by any wired source (${sourceIds.join(", ")})`,
          occurredAt,
        };
      }

      // EXACTLY the executeAction routing (named source > service id probes
      // > honest failed receipt) — only the per-source call is profile-aware
      // where the source supports it.
      const named = sources.find((source) => source.id === action.connectorId);
      const targets =
        named !== undefined
          ? [named]
          : action.connectorId === EXPERIENCE_SERVICE_CONNECTOR_ID
            ? sources
            : null;
      if (targets === null) {
        return {
          status: "failed",
          detail:
            `action targets connector '${action.connectorId}' but this service presents ` +
            `'${EXPERIENCE_SERVICE_CONNECTOR_ID}' (wired sources: ${sourceIds.join(", ")})`,
          occurredAt,
        };
      }

      const gate = await resolveGate(ctx);
      const failures: string[] = [];
      for (const source of targets) {
        const skip = skipFor(gate, source);
        if (skip !== null) {
          recordSkip(source.id, `executeActionForProfile: ${skip}`);
          failures.push(`${source.id}: ${skip}`);
          continue;
        }
        const routed: UserAction = { ...action, connectorId: source.id };
        const scoped = source.connector as Partial<ProfileScopedSource>;
        let receipt: ActionReceipt;
        try {
          receipt =
            typeof scoped.executeActionForProfile === "function"
              ? await scoped.executeActionForProfile(ctx, profileId, routed)
              : await source.connector.executeAction(ctx, routed);
        } catch (thrown) {
          const detail = describeThrown(thrown);
          record(source.id, `executeActionForProfile: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (!isUsableReceipt(receipt)) {
          const detail = "executeActionForProfile answered a malformed ActionReceipt";
          record(source.id, `executeActionForProfile: ${detail}`);
          failures.push(`${source.id}: ${detail}`);
          continue;
        }
        if (receipt.status !== "failed") return receipt;
        const detail = receipt.detail ?? "failed";
        record(source.id, `executeActionForProfile: ${detail}`);
        failures.push(`${source.id}: ${detail}`);
      }
      return {
        status: "failed",
        detail: `no wired source could execute the action — ${failures.join("; ")}`,
        occurredAt,
      };
    },
  };

  return connector;
}
