/**
 * @wfx/client-runtime — ServerPort, the server transport seam (R01).
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
 */

import type {
  ActionReceipt,
  EntertainmentEvent,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";

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
 */
export interface RuntimeContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly locale: string;
  readonly region?: string;
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
}
