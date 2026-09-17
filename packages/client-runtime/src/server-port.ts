/**
 * @wfx/client-runtime — ServerPort, the server transport seam (R01;
 * R02 profile extension).
 *
 * The runtime NEVER fetches directly: an adapter injects a `ServerPort`
 * implementation (R07's web adapter maps the frozen WFX_API_BASE HTTP
 * transport of apps/web/src/host/remote-ports.ts onto this interface; other
 * adapters map their transport). The OPERATIONS mirror that frozen
 * transport contract one-to-one — search/metadata/resolve/actions/library/
 * events — plus the shorts operation the shorts surface needs.
 *
 * FAILURE SEMANTICS — the deliberate R01 refinement of the frozen
 * transport's degrade law (LEAD RATIFICATION ITEM, see README):
 *
 * The frozen web host degrades read failures to empty answers at the port
 * ("the frozen plain surface has no error channel for reads; diagnostics
 * live at the port"). The runtime's ServerPort ADDS that error channel, so
 * an adapter implementing THIS port must answer `ok: false` with the typed
 * `ServerFailure` instead of silently degrading: a network-down search is
 * an ERROR STATE in the runtime (rendered honestly), never a fake empty
 * result. The frozen laws that are PRESERVED verbatim:
 *
 * - The EVENT SINK exception: a lost watch-state event is NEVER a silent
 *   success — `emitEvent` answers its failure and the runtime keeps the
 *   event pending (at-least-once outbox) and throws the typed RuntimeError
 *   to the caller.
 * - Action-shaped calls NEVER fabricate success: a transport failure
 *   settles the action `failed` with the failure detail; an `unsupported`
 *   receipt settles `unsupported` — never rendered as success.
 * - Identity rides in the port's bound context (the runtime stamps every
 *   emitted event with the session context; adapters map it to headers like
 *   `x-wfx-user-id`/`x-wfx-session-id` — identity never in URLs).
 *
 * THE R02 PROFILE EXTENSION (ADD-ONLY — the documented extension the R02
 * work item authorizes; every R01 member keeps its exact semantics):
 *
 * The runtime session carries an ACTIVE PROFILE (`RuntimeContext.profileId`
 * — optional: anonymous/transition sessions carry none; R07's adapter sets
 * it from the auth session's selected profile). The port gains PROFILE-AWARE
 * reads/writes that operate on that active profile's server-side data
 * (cross-device continuity: any device with the same profile sees the same
 * history/library/intents/policy). They answer the SAME typed
 * `ServerResult` failures — never silent degradation. `readLibrary` (the
 * R01 member) keeps its UNscoped connector-side semantics; the profile-
 * scoped library read is `readProfileLibrary` (the spec's "readLibrary"
 * profile-aware read, renamed to honor the ADD-not-reshape law — flagged
 * for the lead's ratification).
 *
 * THE R03 SOURCE EXTENSION (ADD-ONLY + OPTIONAL — see `readSources`):
 *
 * `SourceInfo` is the source-management read model (descriptor + capability
 * truth + authorization state + account linkage + availability notes),
 * aligned with the architecture's seven source-management abilities; the
 * settings surface's `sources` section (R01's `SettingsSection` vocabulary:
 * sources | model | general) renders it. The port member is declared
 * OPTIONAL deliberately: the frozen Web and Desktop adapters (R07/R08)
 * already implement `ServerPort` without it, and this work item may not
 * edit them — an adapter that has not wired the source read yet keeps
 * compiling, and the runtime's `sources()` op degrades the absence to the
 * typed `unavailable` error section (never a fake empty list). The lead's
 * integration completion promotes the member to required when the adapters
 * implement it — the exact precedent of R02's profile extension ("lead: R02
 * integration completion — desktop/web ServerPort implements the profile
 * extension").
 */

import type {
  ActionReceipt,
  Capability,
  EntertainmentEvent,
  IntentRecord,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  RecommendationPolicy,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";

import type { RuntimeErrorKind } from "./errors";
import type { RecommendationPolicyCommand, UserIntentCommand } from "./intent";

// ---------------------------------------------------------------------------
// The typed failure channel
// ---------------------------------------------------------------------------

/** The closed server-transport failure vocabulary. */
export type ServerFailureKind =
  /** The transport did not complete (offline, DNS, timeout, HTTP 5xx). */
  | "network"
  /** Authentication/authorization failed or is missing (HTTP 401/403). */
  | "unauthorized"
  /** The service answered but cannot serve this right now (HTTP 5xx/503, gone). */
  | "unavailable"
  /** The service answered a malformed payload (garbage in, garbage named). */
  | "malformed";

/** Every value of `ServerFailureKind`, in union order. */
export const SERVER_FAILURE_KINDS: readonly ServerFailureKind[] = [
  "network",
  "unauthorized",
  "unavailable",
  "malformed",
];

/** One typed transport failure. */
export interface ServerFailure {
  readonly kind: ServerFailureKind;
  /** Non-empty human-readable detail (what exactly failed). */
  readonly detail: string;
}

/** The result envelope every ServerPort operation answers with. */
export type ServerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ServerFailure };

// ---------------------------------------------------------------------------
// The session context the port is bound to
// ---------------------------------------------------------------------------

/**
 * The identity context of one runtime session. Structurally the frozen
 * `ConnectorContext` plus `sessionId` (the same shape the frozen transport
 * carries as `x-wfx-*` headers). The runtime stamps every emitted event
 * with it; adapters map it onto their transport's identity channel.
 *
 * R02: `profileId` — the ACTIVE PROFILE the session operates as. OPTIONAL:
 * anonymous/transition sessions carry none (the server resolves its
 * default-profile fallback); adapters with an authenticated session set it
 * from the session's selected profile, and every profile-aware ServerPort
 * operation (below) reads it from HERE — profile ids never appear in URLs
 * or operation arguments (the same identity law as userId).
 */
export interface RuntimeContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly locale: string;
  readonly region?: string;
  readonly profileId?: string;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The server transport port. Adapters implement it; the runtime consumes
 * it. Every operation is fallible and answers a typed `ServerResult` —
 * reads degrade to NOTHING silently (see module doc).
 */
export interface ServerPort {
  /** Stable identity of the service binding this port fronts. */
  readonly serviceId: string;

  /** Catalog search (frozen `GET /experience/search?query=`). */
  search(query: string): Promise<ServerResult<readonly SearchResult[]>>;
  /**
   * Short-form feed query (the shorts surface's server operation). The
   * query is OPTIONAL: the server curates the shorts feed; a query refines
   * it.
   */
  shorts(query?: string): Promise<ServerResult<readonly SearchResult[]>>;
  /** Full metadata for one external reference (frozen `GET /experience/metadata?ref=`). */
  metadata(ref: string): Promise<ServerResult<SourceItem | null>>;
  /** Playback realizations for one external reference (frozen `GET /experience/resolve?ref=`). */
  resolve(ref: string): Promise<ServerResult<readonly PlaybackRealization[]>>;

  /**
   * Execute a user action (frozen `POST /experience/actions`). A transport
   * failure answers `ok: false`; a service-side failure/unsupported answers
   * a `failed`/`unsupported` receipt — either way the runtime settles the
   * action state honestly, never as success.
   */
  executeAction(action: UserAction): Promise<ServerResult<ActionReceipt>>;
  /** Read the connector-side library (frozen `GET /experience/library`). */
  readLibrary(): Promise<ServerResult<readonly LibraryEntry[]>>;
  /** Write the connector-side library (frozen `POST /experience/library`). */
  writeLibrary(command: LibraryCommand): Promise<ServerResult<ActionReceipt>>;

  /**
   * Emit one watch-state event (frozen `POST /experience/events`). The
   * EVENT SINK LAW: a failure here answers `ok: false` — the runtime keeps
   * the event in its at-least-once outbox and surfaces the loss; a lost
   * watch-state event is never a silent success.
   */
  emitEvent(event: EntertainmentEvent): Promise<ServerResult<void>>;

  // — the R02 profile extension (ADD-ONLY; see the module doc) —

  /**
   * The ACTIVE profile's watch history, most recently watched first
   * (cross-device: the server-side fold, not the session fold). Answers the
   * typed failures — never a fake empty history.
   */
  readHistory(): Promise<ServerResult<readonly ProfileHistoryEntry[]>>;

  /**
   * The ACTIVE profile's server-side library (cross-device saves). The
   * profile-scoped twin of `readLibrary` (which keeps its R01 connector-side
   * semantics).
   */
  readProfileLibrary(): Promise<ServerResult<readonly LibraryEntry[]>>;

  /** The ACTIVE profile's durable intent records (the frozen shapes). */
  readIntents(): Promise<ServerResult<readonly IntentRecord[]>>;

  /**
   * Write one intent to the ACTIVE profile's durable intent set. The
   * command shape is the runtime's `UserIntentCommand`; the server mints
   * ids/bookkeeping. Typed failures — never a fabricated success.
   */
  writeIntent(intent: UserIntentCommand): Promise<ServerResult<void>>;

  /** The ACTIVE profile's recommendation policy (null when unset). */
  readPolicy(): Promise<ServerResult<RecommendationPolicy | null>>;

  /**
   * Write the ACTIVE profile's recommendation policy (attention mode +
   * dials). Typed failures — never a fabricated success.
   */
  writePolicy(policy: RecommendationPolicyCommand): Promise<ServerResult<void>>;

  // — the R03 source extension (ADD-ONLY + OPTIONAL; see the module doc) —

  /**
   * R03 — the user's source-management read: one `SourceInfo` per source
   * (descriptor + capability truth + authorization state + account linkage
   * + availability notes). The settings surface's `sources` section renders
   * it; the connect/disconnect FLOWS run through the adapter's platform UX
   * (the OAuth dance is the adapter's, never the runtime's) — this read
   * models the RESULTING state.
   *
   * OPTIONAL on purpose (see the module doc): the frozen Web/Desktop
   * adapters implement `ServerPort` without it; the runtime's `sources()`
   * op degrades the absence to the typed `unavailable` error section —
   * never a fake empty list. Anonymous sessions answer the honest EMPTY
   * list server-side (an anonymous user has no connected sources — never
   * a fabricated one).
   */
  readSources?(): Promise<ServerResult<readonly SourceInfo[]>>;
}

// ---------------------------------------------------------------------------
// The R03 source-management read model
// ---------------------------------------------------------------------------

/** A source's auth mode (mirrors the frozen descriptor `auth` union). */
export type SourceAuthMode = "none" | "oauth" | "device" | "local";

/** Every value of `SourceAuthMode`, in union order. */
export const SOURCE_AUTH_MODES: readonly SourceAuthMode[] = [
  "none",
  "oauth",
  "device",
  "local",
];

/**
 * A source's authorization state (mirrors the connector SDK's
 * `AuthSessionState` — the session state machine's vocabulary; an expired
 * token is REPORTED expired, never silently "connected").
 */
export type SourceAuthorizationState =
  | "signedOut"
  | "authorizing"
  | "signedIn"
  | "expired"
  | "failed";

/** Every value of `SourceAuthorizationState`, in union order. */
export const SOURCE_AUTHORIZATION_STATES: readonly SourceAuthorizationState[] = [
  "signedOut",
  "authorizing",
  "signedIn",
  "expired",
  "failed",
];

/**
 * One source's management truth (R03): what it IS (descriptor identity +
 * capability truth), whether the user's authorization to it is usable, and
 * the source-specific availability notes. Structurally secret-FREE —
 * provider credentials never enter this shape (the runtime privacy law);
 * notes carry non-secret quota/health truth only.
 */
export interface SourceInfo {
  /** The connector's stable kebab-case id. */
  readonly connectorId: string;
  readonly displayName: string;
  readonly version: string;
  /** The declared auth handshake this source uses. */
  readonly authMode: SourceAuthMode;
  /** The CURRENT authorization state (expired is reported expired). */
  readonly authState: SourceAuthorizationState;
  /**
   * Usable for authenticated operations: true for `authMode: "none"`
   * sources (no authorization needed) and for `authState: "signedIn"`
   * sources; false otherwise.
   */
  readonly usable: boolean;
  /** Whether the user has a linked account row for this source. */
  readonly connected: boolean;
  /**
   * The capability truth row: EVERY frozen capability with declared =
   * true — Web truthfully shows what each source CAN and CANNOT do.
   */
  readonly capabilities: Readonly<Record<Capability, boolean>>;
  /** ISO instant of the current credential's authorization, when linked. */
  readonly authorizedAt: string | null;
  /** ISO instant of the last authorization-state change, when known. */
  readonly lastStateChange: string | null;
  /** ISO instant of the stored authorization's expiry, when it carries one. */
  readonly expiresAt: string | null;
  /** Source-specific availability notes (non-secret quota/health truth). */
  readonly notes: readonly string[];
}

/**
 * The source-management read model (the runtime's `sources()` answer): the
 * honest section status + the per-source truth. Degradation lives IN THE
 * MODEL (the R01 law): a failing read is an ERROR section, never a fake
 * empty list.
 */
export interface SourcesModel {
  readonly status: {
    readonly state: "ready" | "error";
    readonly error?: { readonly kind: RuntimeErrorKind; readonly detail: string };
  };
  /** Present iff `status.state === "ready"`: the sources (validated shape). */
  readonly sources: readonly SourceInfo[];
}

/**
 * Structural shape guard for one `SourceInfo` (the transport boundary's
 * honesty filter — a malformed entry is skipped by the runtime, never
 * rendered as a card, the same law as search hits). Exported for the
 * adapters' lead-integration (the web/desktop ports validate their HTTP
 * payloads with the same shape).
 */
export function isUsableSourceInfo(value: unknown): value is SourceInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const info = value as Record<string, unknown>;
  if (typeof info.connectorId !== "string" || info.connectorId.length === 0) return false;
  if (typeof info.displayName !== "string" || info.displayName.length === 0) return false;
  if (typeof info.version !== "string" || info.version.length === 0) return false;
  if (!(SOURCE_AUTH_MODES as readonly string[]).includes(String(info.authMode))) return false;
  if (
    !(SOURCE_AUTHORIZATION_STATES as readonly string[]).includes(String(info.authState))
  ) {
    return false;
  }
  if (typeof info.usable !== "boolean") return false;
  if (typeof info.connected !== "boolean") return false;
  if (
    typeof info.capabilities !== "object" ||
    info.capabilities === null ||
    Array.isArray(info.capabilities)
  ) {
    return false;
  }
  const optionalIso = (x: unknown): boolean =>
    x === null || (typeof x === "string" && x.length > 0);
  if (!optionalIso(info.authorizedAt)) return false;
  if (!optionalIso(info.lastStateChange)) return false;
  if (!optionalIso(info.expiresAt)) return false;
  if (!Array.isArray(info.notes) || info.notes.some((note) => typeof note !== "string")) {
    return false;
  }
  return true;
}

/**
 * One profile-scoped watch-history entry read from the server (the durable
 * projection a resume surface hydrates from — the cross-device twin of
 * the session fold's `SessionWatchState`).
 */
export interface ProfileHistoryEntry {
  /** The canonical entertainment-item id (`wfxitm_…`). */
  readonly itemId: string;
  /** Latest known playback position in ms (>= 0). */
  readonly positionMs: number;
  /** Monotone completion flag (once true, always true). */
  readonly completed: boolean;
  /** The last folded watch-state event type, when the server reports one. */
  readonly lastEventType: string | null;
  /** ISO 8601 instant of the latest update (the recency order key). */
  readonly updatedAt: string;
}
