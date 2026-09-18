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
 * THE R03 SOURCE EXTENSION (ADD-ONLY — the source-management work item;
 * every R01/R02 member keeps its exact semantics):
 *
 * The port gains `readSources()` — the user's source-management truth as
 * `SourceInfo[]` (descriptor + capability truth + authorization state +
 * last-checked), the read behind the settings/sources surface (R01's
 * `SettingsSection` vocabulary: sources | model | general). The CONNECT and
 * DISCONNECT flows themselves run through the ADAPTER's platform UX (the
 * OAuth dance is a web/desktop transport concern — browser redirects,
 * provider pages); the runtime models the RESULTING STATE through the
 * source-state store (`sources.ts`): refresh from the port + observe
 * post-flow transitions, never the handshake itself. Answers carry the
 * typed `ServerResult` failures — a failing source read is an ERROR model,
 * never a fake empty list.
 *
 * > **Ratification item for the lead (the R03 transport seam):** unlike the
 * > R02 profile members — which could be REQUIRED because no adapter had
 * > shipped when R02 landed — `readSources` is OPTIONAL because the frozen
 * > R07/R08 adapters (the web + desktop ServerPort implementations) implement
 * > `ServerPort` TODAY and this work item may not edit them. The runtime
 * > answers the honest `unavailable` failure ("the adapter transport has
 * > not implemented the source read yet") until the lead wires the R03
 * > HTTP mapping (`GET /sources`, delivered by this work item) onto the
 * > adapters — the same integration step that wired the R02 members
 * > post-merge. The shape is final; only the adapters' wiring is pending.
 */

import type {
  ActionReceipt,
  Capability,
  EntertainmentEvent,
  IntentRecord,
  LibraryCommand,
  LibraryEntry,
  ModelPolicy,
  ModelTask,
  PlaybackRealization,
  RecommendationPolicy,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";

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

  // — the R03 source extension (ADD-ONLY; see the module doc + the
  // ratification note on why this member is optional until the lead wires
  // the adapters) —

  /**
   * The user's source-management truth (R03): every known source's
   * descriptor truth + capability truth + CURRENT authorization state +
   * account linkage + availability notes. Anonymous sessions answer the
   * HONEST empty list (the anonymous user has no connected sources — never
   * a fake one). Typed failures — never a fake empty list.
   *
   * OPTIONAL until the lead wires the adapters' transports (see the module
   * doc's ratification note): the runtime's source-state store answers the
   * honest `unavailable` failure when the bound port does not implement it.
   */
  readSources?(): Promise<ServerResult<readonly SourceInfo[]>>;

  // — the R06 model-and-AI-controls extension (ADD-ONLY — the documented
  // extension this work item authorizes; every R01/R02/R03 member keeps
  // its exact semantics; the SettingsSection "model" vocabulary the R01
  // runtime's navigation declares is the surface these read/write) —

  /**
   * The ACTIVE profile's ModelPolicy for `task` (preferred provider +
   * fallback chain + privacy class + cost ceiling), or the HONEST null
   * when unset (the R05/R06 honesty law — never a fabricated
   * default-as-if-configured). Typed failures — never a fake null.
   *
   * OPTIONAL until the lead wires the adapters' transports (same
   * ratification note as `readSources`): the runtime answers the honest
   * `unavailable` failure when the bound port does not implement it.
   */
  readModelPolicy?(task: ModelTask): Promise<ServerResult<ModelPolicy | null>>;

  /**
   * Write the ACTIVE profile's ModelPolicy (the validated command). Typed
   * failures — never a fabricated success (a model-policy write failure is
   * an ERROR STATE).
   */
  writeModelPolicy?(command: ModelPolicyCommand): Promise<ServerResult<void>>;

  /**
   * The provider registry view (first-party + BYOM + local where
   * supported) with per-task capability truth — the "see actual
   * capabilities" law applied to models. BYOM bindings are listed as
   * secret-free projections ONLY (the response NEVER contains key
   * material — the R06 privacy law). Anonymous sessions answer the
   * first-party providers honestly (the BYOM list is empty for
   * anonymous — never a fake one).
   */
  readModelProviders?(): Promise<ServerResult<readonly ModelProviderInfo[]>>;

  /**
   * Store a BYOM provider binding (the key SEALED via the envelope-
   * encrypted account-store pattern — plaintext NEVER at rest). The
   * transport returns the HANDLE + metadata ONLY (never the key). Typed
   * failures — never a fabricated success.
   */
  bindByomProvider?(command: ByomBindingCommand): Promise<ServerResult<ByomBindingHandle>>;

  /**
   * DELETE one BYOM binding (the vault's delete discipline — the sealed
   * material is destroyed). Typed failures — never a fabricated success.
   */
  unbindByomProvider?(providerId: string): Promise<ServerResult<void>>;

  /**
   * Submit one explicit transformation (kind + input + options). The
   * transport creates a `queued` operation and answers the operation
   * record immediately; the pipeline runs ASYNCHRONOUSLY. Typed failures
   * — never a fabricated success (a submit failure is an ERROR STATE).
   */
  submitTransform?(command: TransformSubmitCommand): Promise<ServerResult<TransformOperation>>;

  /**
   * Read one transform operation's current state + the append-only state
   * history. The 404 (`not-found`) is the honest miss.
   */
  readTransform?(operationId: string): Promise<ServerResult<TransformOperation>>;

  /**
   * Cancel a queued/running transform operation (the explicit
   * cancellation path — never a silent drop). Terminal operations reject.
   */
  cancelTransform?(operationId: string): Promise<ServerResult<TransformOperation>>;

  /**
   * DELETE the result of a succeeded transform (result cleanup). Rejects
   * when the operation is not in the succeeded state.
   */
  clearTransformResult?(operationId: string): Promise<ServerResult<TransformOperation>>;
}

// ---------------------------------------------------------------------------
// The R03 source-management truth shape
// ---------------------------------------------------------------------------

/** The authorization-state vocabulary of a source (the SDK's session states). */
export type SourceAuthState =
  | "signedOut"
  | "authorizing"
  | "signedIn"
  | "expired"
  | "failed";

/** Every value of `SourceAuthState`, in union order. */
export const SOURCE_AUTH_STATES: readonly SourceAuthState[] = [
  "signedOut",
  "authorizing",
  "signedIn",
  "expired",
  "failed",
] as const;

/** Runtime membership check against the `SourceAuthState` union. */
export function isSourceAuthState(x: unknown): x is SourceAuthState {
  return typeof x === "string" && SOURCE_AUTH_STATES.includes(x as SourceAuthState);
}

/** The auth modes a source's descriptor can declare (the SDK's union). */
export type SourceAuthMode = "none" | "oauth" | "device" | "local";

/** Every value of `SourceAuthMode`, in union order. */
export const SOURCE_AUTH_MODES: readonly SourceAuthMode[] = [
  "none",
  "oauth",
  "device",
  "local",
] as const;

/** Runtime membership check against the `SourceAuthMode` union. */
export function isSourceAuthMode(x: unknown): x is SourceAuthMode {
  return typeof x === "string" && SOURCE_AUTH_MODES.includes(x as SourceAuthMode);
}

/**
 * One source's management-view truth (R03 — the architecture's seven user
 * abilities: connect / see actual capabilities / see authorization state /
 * reconnect / disconnect / inspect availability / sync-vs-local). Aligned
 * with the service's `GET /sources` row; adapters render it directly and
 * NEVER guess capability or authorization truth.
 */
export interface SourceInfo {
  /** The connector's stable id (the SDK descriptor id). */
  readonly connectorId: string;
  /** Human display name (the SDK descriptor). */
  readonly displayName: string;
  /** The connector's version (the SDK descriptor). */
  readonly version: string;
  /** The declared auth mode (the SDK descriptor). */
  readonly authMode: SourceAuthMode;
  /**
   * Capability truth: EVERY frozen capability with an explicit declared /
   * not-declared flag — the "see actual capabilities" ability. Truthfully
   * shows what each source CAN and CANNOT do.
   */
  readonly capabilities: Readonly<Record<Capability, boolean>>;
  /** The CURRENT authorization state (the session machine's truth). */
  readonly authState: SourceAuthState;
  /** False only for `authMode: "none"` sources (they need no authorization). */
  readonly requiresAuthorization: boolean;
  /** Whether a connected account exists (account linkage). */
  readonly connected: boolean;
  /** The account id when connected (an opaque handle — NEVER a credential). */
  readonly accountId: string | null;
  /** When the CURRENT authorization was granted (null when never/not). */
  readonly authorizedAt: string | null;
  /** When the authorization state last changed. */
  readonly lastStateChange: string | null;
  /** The authorization's expiry (ISO instant) when the server reports one. */
  readonly expiresAt: string | null;
  /** Source-specific availability notes (quota/health truth — never secrets). */
  readonly availabilityNotes: readonly string[];
  /** When the server last checked this source's truth (ISO instant). */
  readonly lastChecked: string;
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

// ---------------------------------------------------------------------------
// The R06 model-and-AI-controls truth shapes
// ---------------------------------------------------------------------------

/**
 * The model-policy write command (the wire shape the runtime sends to
 * `writeModelPolicy`). Structurally identical to the API's
 * `ModelPolicyCommandWire` — the lane rule.
 */
export interface ModelPolicyCommand {
  readonly task: ModelTask;
  readonly preferredProvider?: string;
  readonly fallbackProviders: readonly string[];
  readonly privacy: ModelPolicy["privacy"];
  readonly maxCostPerOperation?: number;
}

/**
 * The BYOM binding write command (the wire shape the runtime sends to
 * `bindByomProvider`). The `key` is the secret; the transport SEALS it
 * via the envelope-encrypted account-store pattern.
 */
export interface ByomBindingCommand {
  readonly providerId: string;
  readonly endpointUrl: string;
  readonly key: string;
  readonly metadata?: Record<string, unknown>;
  /** The capabilities the binding's model declares (the frozen ModelTask set). */
  readonly capabilities?: readonly ModelTask[];
  /** The model's declared cost per call (fabric abstract units). */
  readonly costPerCall?: number;
}

/**
 * The BYOM binding HANDLE the transport returns from `bindByomProvider`
 * — the secret-free projection (the response NEVER contains key material
 * — the R06 privacy law).
 */
export interface ByomBindingHandle {
  readonly id: string;
  readonly providerId: string;
  readonly endpointUrl: string;
  readonly keyId: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The transform submit command (the wire shape the runtime sends to
 * `submitTransform`). `kind` is one of the closed transform vocabulary;
 * `input` is the task's validated input shape; `options` carries privacy
 * class + provider hints + cost ceiling + timeout.
 */
export interface TransformSubmitCommand {
  readonly kind: string;
  readonly input: unknown;
  readonly options?: {
    readonly privacy?: ModelPolicy["privacy"];
    readonly preferredProvider?: string;
    readonly fallbackProviders?: readonly string[];
    readonly maxCostPerOperation?: number;
    readonly timeoutMs?: number;
  };
}

/** The closed transform-operation state union (mirrors the fabric). */
export type TransformOperationState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Every value of `TransformOperationState`, in union order. */
export const TRANSFORM_OPERATION_STATES: readonly TransformOperationState[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

/** Runtime membership check against the state union. */
export function isTransformOperationState(
  x: unknown,
): x is TransformOperationState {
  return (
    typeof x === "string" &&
    (TRANSFORM_OPERATION_STATES as readonly string[]).includes(
      x as TransformOperationState,
    )
  );
}

/**
 * One transform operation's current state + the snapshot read-model. The
 * append-only state history is fetched alongside the operation when the
 * transport supports it.
 */
export interface TransformOperation {
  readonly id: string;
  readonly kind: string;
  readonly targetRef: string;
  readonly options: Record<string, unknown>;
  readonly state: TransformOperationState;
  readonly progress: number | null;
  readonly resultRef: string | null;
  readonly errorDetail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One entry in the operation's append-only state history (every
 * transition recorded, never overwritten — honest audit truth).
 */
export interface TransformOperationStateHistoryEntry {
  readonly id: string;
  readonly operationId: string;
  readonly state: TransformOperationState;
  readonly progress: number | null;
  readonly detail: string | null;
  readonly transitionedAt: string;
}

/**
 * The provider registry view (the "see actual capabilities" law applied to
 * models). One row per provider — first-party (local, cost 0), BYOM-bound
 * (cloud, the binding's declared cost), and local (where supported). The
 * `availability` field carries the J20 "Constrained" truth: an
 * unsupported capability is named, never a fake success.
 */
export interface ModelProviderInfo {
  readonly id: string;
  /** Where the provider runs (local | cloud — the registry vocabulary). */
  readonly privacy: "local" | "cloud";
  /** The frozen ModelTask set the provider declares. */
  readonly capabilities: readonly ModelTask[];
  /** Whether the provider is bound BYOM (true) or first-party/local (false). */
  readonly byomBound: boolean;
  /** The declared cost per operation, per task (absent tasks not in the map). */
  readonly costs: Readonly<Record<string, number>>;
  /** Honest availability truth: 'available' | 'unsupported' (J20 Constrained). */
  readonly availability: "available" | "unsupported";
}
