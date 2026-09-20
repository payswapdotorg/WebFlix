/**
 * @wfx/connectors — BaseConnector, the SDK's implementation seam (WFX-003).
 *
 * DESIGN — reconciling the frozen plain contract with typed results:
 *
 * The frozen `SourceConnector` contract (packages/domain, generated from
 * docs/architecture/contracts.md) declares PLAIN method signatures, e.g.
 * `search(ctx, query): Promise<SearchResult[]>`. It has no error channel
 * except `ActionReceipt.status` and `metadata()`'s `null`. At the same time
 * the SDK's law is: unsupported operations return typed
 * `{ ok: false, error: { kind: "unsupported", ... } }` — never thrown, never
 * faked. `BaseConnector` resolves this with a DUAL SURFACE:
 *
 * 1. RESULT SURFACE (primary, honest — use this):
 *    `searchResult / metadataResult / resolveResult / executeActionResult /
 *    readLibraryResult / writeLibraryResult` — every call returns a
 *    `ConnectorResult`. Guard order per call:
 *      a. lifecycle  — wrong state throws typed `LifecycleError` (programmer
 *                     error; see lifecycle.ts for the error-channel split)
 *      b. input      — malformed ctx/query/ref/action → `invalid-input`
 *      c. capability — undeclared capability → `unsupported` (never a throw)
 *      d. hook       — the subclass implementation; an unexpected throw is
 *                      caught and wrapped as a `transport` error so the
 *                      result contract can never be bypassed by a bug
 *
 * 2. PLAIN SURFACE (frozen-contract compatibility shims):
 *    `search / metadata / resolve / executeAction / readLibrary /
 *    writeLibrary` — EXACT frozen signatures, so `BaseConnector implements
 *    SourceConnector` literally. They delegate to the result surface and
 *    degrade typed errors into the limited plain representations, ALWAYS
 *    recording the error in `lastError()` for diagnostics:
 *      search/resolve/readLibrary → `[]`   metadata → `null`
 *      executeAction/writeLibrary → receipt `status:"unsupported"` (for
 *      unsupported) or `"failed"` (everything else) with the error summary
 *      in `detail`. Never a silent success: `lastError()` + receipt tell the
 *      truth. Prefer the result surface in new code.
 *
 * 3. HOOKS (what concrete connectors implement):
 *    protected `onSearch / onMetadata / onResolve / onExecuteAction`
 *    (abstract) and `onReadLibrary / onWriteLibrary` (optional, default
 *    unsupported). Hooks return `T | ConnectorError | ConnectorResult<T>`
 *    (sync or promised) — `asyncResult()` normalizes all of these shapes
 *    uniformly, so an implementation may simply `return plainValue`.
 *
 * Operation gating map (canonical, enforced by the result surface):
 *   search        → catalogSearch
 *   metadata      → metadata
 *   resolve       → any of playNative | playEmbed | playBrowser | playExternal
 *   executeAction → the action's own capability: like | save | follow |
 *                   comment | download | transform (UserAction.type is a
 *                   member of the frozen Capability union)
 *   readLibrary   → libraryRead
 *   writeLibrary  → libraryWrite
 *   importFeed    → feedImport (R20-B: the EXPLICIT feed/import capability —
 *                   never inferred from catalogSearch; connectors that
 *                   cannot legally/reliably expose the user's feed answer
 *                   the typed `unsupported` verdict)
 *   identity, availability → informational only: they gate no SDK operation
 *   (availability is reported per item via SourceItem.availability; identity
 *   is surfaced by auth-aware orchestrators, e.g. WFX-012).
 *
 * Hooks may call `requireCapability()` for ADDITIONAL gating beyond the
 * canonical map; the public result surface has already enforced the
 * canonical gate before the hook runs.
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorFeedSnapshot,
  FeedImportRequest,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceConnector,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { isFeedImportMethod, isFeedRelationship } from "@wfx/domain";

import { defineDescriptor } from "./descriptor";
import { assertOperational, ConnectorLifecycle, type LifecycleState } from "./lifecycle";
import {
  describeConnectorError,
  errResult,
  invalidInput,
  isConnectorError,
  okResult,
  transport,
  unsupported,
  type ConnectorError,
  type ConnectorResult,
} from "./result";

// ---------------------------------------------------------------------------
// asyncResult — uniform normalization of hook return shapes
// ---------------------------------------------------------------------------

/**
 * Anything a connector hook may return: the plain value `T`, a typed
 * `ConnectorError`, or a full `ConnectorResult<T>` — or a promise of any of
 * those. `asyncResult()` normalizes all shapes into `ConnectorResult<T>`.
 *
 * Ambiguity note: a hook value that is structurally result-like
 * (`{ ok: boolean, ... }`) is ALWAYS interpreted as a `ConnectorResult`, and
 * a value with a valid error `kind` as an error. Hooks must not use such
 * shapes as DATA.
 */
export type ConnectorResultInput<T> = ConnectorResult<T> | ConnectorError | T;

/** `ConnectorResultInput<T>` or a promise of it. */
export type AsyncConnectorResultInput<T> =
  | ConnectorResultInput<T>
  | Promise<ConnectorResultInput<T>>;

function isResultLike(
  x: unknown,
): x is { ok: boolean; value?: unknown; error?: unknown } {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { ok?: unknown }).ok === "boolean"
  );
}

/**
 * Normalize a hook return value into a `ConnectorResult`:
 * - `ConnectorResult` (ok:true) → passed through
 * - `ConnectorResult` (ok:false) with a valid error → passed through;
 *   a malformed error is reported as `invalid-input` (never fake success)
 * - `ConnectorError` → wrapped as `{ ok: false, error }`
 * - anything else → the plain success value, wrapped as `{ ok: true, value }`
 */
export async function asyncResult<T>(
  input: AsyncConnectorResultInput<T>,
): Promise<ConnectorResult<T>> {
  const settled = await input;
  if (isResultLike(settled)) {
    if (settled.ok) {
      return okResult(settled.value as T);
    }
    if (isConnectorError(settled.error)) {
      return errResult<T>(settled.error);
    }
    return errResult<T>(
      invalidInput(
        "connector implementation returned a malformed ConnectorResult (ok:false without a valid ConnectorError)",
      ),
    );
  }
  if (isConnectorError(settled)) {
    return errResult<T>(settled);
  }
  // Not result-like and not an error: by contract this is the plain value T.
  return okResult(settled as T);
}

// ---------------------------------------------------------------------------
// Internal runtime input validation (module-private)
// ---------------------------------------------------------------------------

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function invalidString(field: string, rule: string): ConnectorError {
  return invalidInput(`'${field}' ${rule}`);
}

function validateContext(ctx: unknown): ConnectorError | null {
  if (!isPlainObject(ctx)) {
    return invalidString("ctx", "must be an object");
  }
  if (typeof ctx.userId !== "string" || ctx.userId.trim().length === 0) {
    return invalidString("ctx.userId", "must be a non-empty string");
  }
  if (typeof ctx.locale !== "string" || ctx.locale.trim().length === 0) {
    return invalidString("ctx.locale", "must be a non-empty string");
  }
  if (ctx.region !== undefined && typeof ctx.region !== "string") {
    return invalidString("ctx.region", "must be a string when present");
  }
  return null;
}

function validateNonEmptyString(field: string, value: unknown): ConnectorError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidString(field, "must be a non-empty string (after trim)");
  }
  return null;
}

const ACTION_TYPES: readonly UserAction["type"][] = [
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

function validateAction(action: unknown, selfId: string): ConnectorError | null {
  if (!isPlainObject(action)) {
    return invalidString("action", "must be an object");
  }
  if (typeof action.type !== "string" || !ACTION_TYPES.includes(action.type as UserAction["type"])) {
    return invalidString(
      "action.type",
      `must be one of ${ACTION_TYPES.join(" | ")}, got '${String(action.type)}'`,
    );
  }
  if (typeof action.connectorId !== "string" || action.connectorId.trim().length === 0) {
    return invalidString("action.connectorId", "must be a non-empty string");
  }
  if (action.connectorId !== selfId) {
    return invalidInput(
      `action targets connector '${action.connectorId}' but was sent to '${selfId}'`,
    );
  }
  const refError = validateNonEmptyString("action.externalRef", action.externalRef);
  if (refError) return refError;
  if (action.payload !== undefined && !isPlainObject(action.payload)) {
    return invalidString("action.payload", "must be an object when present");
  }
  return null;
}

function validateLibraryCommand(command: unknown): ConnectorError | null {
  if (!isPlainObject(command)) {
    return invalidString("command", "must be an object");
  }
  if (command.op !== "add" && command.op !== "remove") {
    return invalidString("command.op", "must be 'add' or 'remove'");
  }
  const refError = validateNonEmptyString("command.externalRef", command.externalRef);
  if (refError) return refError;
  if (command.title !== undefined && typeof command.title !== "string") {
    return invalidString("command.title", "must be a string when present");
  }
  if (command.metadata !== undefined && !isPlainObject(command.metadata)) {
    return invalidString("command.metadata", "must be an object when present");
  }
  return null;
}

function validateFeedImportRequest(request: unknown): ConnectorError | null {
  if (!isPlainObject(request)) {
    return invalidString("request", "must be an object");
  }
  if (!isFeedImportMethod(request.method)) {
    return invalidInput(
      `request.method must be one of 'api' | 'official-export' | 'user-file' | 'snapshot', got '${String(request.method)}'`,
    );
  }
  if (request.relationships !== undefined) {
    if (!Array.isArray(request.relationships)) {
      return invalidString("request.relationships", "must be an array when present");
    }
    for (const relationship of request.relationships) {
      if (!isFeedRelationship(relationship)) {
        return invalidInput(
          `request.relationships contains an unknown relationship '${String(relationship)}'`,
        );
      }
    }
  }
  if (request.sourceRef !== undefined) {
    const refError = validateNonEmptyString("request.sourceRef", request.sourceRef);
    if (refError) return refError;
  }
  if (request.artifact !== undefined && !(request.artifact instanceof Uint8Array)) {
    return invalidInput("request.artifact must be a Uint8Array when present");
  }
  return null;
}

function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  return String(thrown);
}

/** Capabilities that can produce a playback realization (one is required). */
const PLAY_CAPABILITIES: readonly Capability[] = [
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
];

/**
 * Degrade a typed error into the frozen contract's plain receipt shape.
 * Only used by the plain-surface shims; the error is always named in
 * `detail` so the degradation is diagnosable via the receipt itself.
 */
function degradeReceipt(error: ConnectorError): ActionReceipt {
  const status: ActionReceipt["status"] =
    error.kind === "unsupported" ? "unsupported" : "failed";
  return {
    status,
    detail: describeConnectorError(error),
    occurredAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// BaseConnector
// ---------------------------------------------------------------------------

/**
 * Abstract base for every source connector.
 *
 * Concrete connectors extend this class, pass a descriptor (validated
 * strictly at construction via `defineDescriptor`) to `super(...)`, and
 * implement the abstract hooks. They MUST NOT fake capability: if the
 * descriptor does not declare a capability, the result surface answers the
 * matching operation with a typed `unsupported` error without ever invoking
 * the hook.
 */
export abstract class BaseConnector implements SourceConnector {
  private readonly descriptor_: ConnectorDescriptor;
  private readonly lifecycle_: ConnectorLifecycle;
  private lastError_: ConnectorError | null = null;

  /**
   * @param input descriptor-shaped object; validated strictly (throws
   *        `DescriptorValidationError`) and deep-frozen — see descriptor.ts.
   */
  protected constructor(input: unknown) {
    this.descriptor_ = defineDescriptor(input);
    this.lifecycle_ = new ConnectorLifecycle();
  }

  // --- identity -----------------------------------------------------------

  /** The validated, frozen descriptor of this connector. */
  descriptor(): ConnectorDescriptor {
    return this.descriptor_;
  }

  /** Stable connector id (same as `descriptor().id`). */
  get id(): string {
    return this.descriptor_.id;
  }

  /** Does this connector declare `cap`? The single capability truth. */
  hasCapability(cap: Capability): boolean {
    return this.descriptor_.capabilities.includes(cap);
  }

  // --- lifecycle ----------------------------------------------------------

  /** The lifecycle state machine owned by this connector. */
  get lifecycle(): ConnectorLifecycle {
    return this.lifecycle_;
  }

  /** Current lifecycle state. */
  state(): LifecycleState {
    return this.lifecycle_.state();
  }

  /**
   * registered → initialized. Runs the optional `onInitialize()` hook first;
   * if it throws, the connector transitions to `failed` and the error is
   * re-thrown (initialization failure is never papered over).
   */
  async initialize(): Promise<void> {
    if (this.lifecycle_.state() !== "registered") {
      // Produce the typed LifecycleError for the exact illegal state.
      this.lifecycle_.initialize();
      return;
    }
    try {
      await this.onInitialize();
    } catch (thrown) {
      this.lifecycle_.fail(`onInitialize failed: ${describeThrown(thrown)}`);
      throw thrown;
    }
    this.lifecycle_.initialize();
  }

  /**
   * initialized → disposed. Runs the optional `onDispose()` hook first; if it
   * throws, the connector transitions to `failed` and the error is re-thrown.
   */
  async dispose(): Promise<void> {
    if (this.lifecycle_.state() !== "initialized") {
      // Produce the typed LifecycleError for the exact illegal state.
      this.lifecycle_.dispose();
      return;
    }
    try {
      await this.onDispose();
    } catch (thrown) {
      this.lifecycle_.fail(`onDispose failed: ${describeThrown(thrown)}`);
      throw thrown;
    }
    this.lifecycle_.dispose();
  }

  // --- diagnostics --------------------------------------------------------

  /**
   * Error of the most recent operation call (result OR plain surface):
   * `null` when that call succeeded. The diagnostic channel for the plain
   * surface's documented degradations.
   */
  lastError(): ConnectorError | null {
    return this.lastError_;
  }

  // --- capability guards (for subclasses) ----------------------------------

  /**
   * `null` if this connector declares `cap`, otherwise a ready-to-return
   * `unsupported` error. "ConnectorResult-friendly": a hook can simply do
   * `const e = this.requireCapability(x); if (e) return e;` — `asyncResult`
   * turns the bare error into `{ ok: false, error }`.
   */
  protected requireCapability(cap: Capability): ConnectorError | null {
    return this.hasCapability(cap)
      ? null
      : unsupported(cap, `connector '${this.id}' does not declare '${cap}'`);
  }

  /**
   * Like `requireCapability` but satisfied by ANY of `caps`. The returned
   * unsupported error names `caps[0]` and lists the full set in `detail`.
   */
  protected requireAnyCapability(caps: readonly Capability[]): ConnectorError | null {
    if (caps.some((cap) => this.hasCapability(cap))) return null;
    return unsupported(
      caps[0] ?? "playNative",
      `requires at least one of: ${caps.join(" | ")} (connector '${this.id}' declares none)`,
    );
  }

  // --- hooks (what concrete connectors implement) --------------------------

  /** Search implementation. Gated (canonically) by `catalogSearch`. */
  protected abstract onSearch(
    ctx: ConnectorContext,
    query: string,
  ): AsyncConnectorResultInput<SearchResult[]>;

  /** Metadata implementation. Gated by `metadata`. Unknown refs → `null`. */
  protected abstract onMetadata(
    ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<SourceItem | null>;

  /**
   * Playback resolution. Gated by any play capability. Implementations must
   * only produce realizations whose `mode` matches a DECLARED play
   * capability — never fabricate a realization mode the descriptor denies.
   */
  protected abstract onResolve(
    ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<PlaybackRealization[]>;

  /** Action execution. Gated by the action type's own capability. */
  protected abstract onExecuteAction(
    ctx: ConnectorContext,
    action: UserAction,
  ): AsyncConnectorResultInput<ActionReceipt>;

  /**
   * Optional library read. Default: typed `unsupported` — a connector that
   * declares `libraryRead` but provides no implementation honestly answers
   * unsupported instead of faking an empty library.
   */
  protected onReadLibrary(
    _ctx: ConnectorContext,
  ): AsyncConnectorResultInput<LibraryEntry[]> {
    return unsupported(
      "libraryRead",
      `connector '${this.id}' declares 'libraryRead' but provides no onReadLibrary implementation`,
    );
  }

  /**
   * Optional library write. Default: typed `unsupported` (see onReadLibrary).
   */
  protected onWriteLibrary(
    _ctx: ConnectorContext,
    _command: LibraryCommand,
  ): AsyncConnectorResultInput<ActionReceipt> {
    return unsupported(
      "libraryWrite",
      `connector '${this.id}' declares 'libraryWrite' but provides no onWriteLibrary implementation`,
    );
  }

  /**
   * Optional authorized feed import (R20-B). Default: typed `unsupported` —
   * a connector that declares 'feedImport' but provides no implementation
   * honestly answers unsupported instead of fabricating a feed. The frozen
   * `SourceConnector` interface carries no importFeed member (BYOF is an
   * SDK-extended surface, like the YouTube pagination surfaces); the result
   * surface below is the canonical entry point.
   */
  protected onImportFeed(
    _ctx: ConnectorContext,
    _request: FeedImportRequest,
  ): AsyncConnectorResultInput<ConnectorFeedSnapshot> {
    return unsupported(
      "feedImport",
      `connector '${this.id}' declares 'feedImport' but provides no onImportFeed implementation`,
    );
  }

  /** Optional async setup, run before the registered → initialized transition. */
  protected onInitialize(): void | Promise<void> {}

  /** Optional async teardown, run before the initialized → disposed transition. */
  protected onDispose(): void | Promise<void> {}

  // --- result surface (PRIMARY — typed, honest) -----------------------------

  /** Typed search. Requires `catalogSearch`. */
  async searchResult(
    ctx: ConnectorContext,
    query: string,
  ): Promise<ConnectorResult<SearchResult[]>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx) ?? validateNonEmptyString("query", query);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireCapability("catalogSearch");
    if (capError) return this.failWith(capError);
    return this.settle("search", () => this.onSearch(ctx, query));
  }

  /** Typed metadata. Requires `metadata`. Unknown refs resolve to `null`. */
  async metadataResult(
    ctx: ConnectorContext,
    ref: string,
  ): Promise<ConnectorResult<SourceItem | null>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx) ?? validateNonEmptyString("ref", ref);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireCapability("metadata");
    if (capError) return this.failWith(capError);
    return this.settle("metadata", () => this.onMetadata(ctx, ref));
  }

  /** Typed playback resolution. Requires at least one play capability. */
  async resolveResult(
    ctx: ConnectorContext,
    ref: string,
  ): Promise<ConnectorResult<PlaybackRealization[]>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx) ?? validateNonEmptyString("ref", ref);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireAnyCapability(PLAY_CAPABILITIES);
    if (capError) return this.failWith(capError);
    return this.settle("resolve", () => this.onResolve(ctx, ref));
  }

  /** Typed action execution. Requires the action type's own capability. */
  async executeActionResult(
    ctx: ConnectorContext,
    action: UserAction,
  ): Promise<ConnectorResult<ActionReceipt>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx) ?? validateAction(action, this.id);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireCapability(action.type);
    if (capError) return this.failWith(capError);
    return this.settle("executeAction", () => this.onExecuteAction(ctx, action));
  }

  /** Typed library read. Requires `libraryRead`. */
  async readLibraryResult(
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<LibraryEntry[]>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireCapability("libraryRead");
    if (capError) return this.failWith(capError);
    return this.settle("readLibrary", () => this.onReadLibrary(ctx));
  }

  /** Typed library write. Requires `libraryWrite`. */
  async writeLibraryResult(
    ctx: ConnectorContext,
    command: LibraryCommand,
  ): Promise<ConnectorResult<ActionReceipt>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx) ?? validateLibraryCommand(command);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireCapability("libraryWrite");
    if (capError) return this.failWith(capError);
    return this.settle("writeLibrary", () => this.onWriteLibrary(ctx, command));
  }

  /**
   * Typed authorized feed import (R20-B). Requires the EXPLICIT `feedImport`
   * capability — never `catalogSearch`. The hook returns one honest
   * `ConnectorFeedSnapshot` (a point-in-time capture with provenance) or a
   * typed failure: `unsupported` when the provider cannot legally/reliably
   * expose the requested feed, `unauthorized` when the user's grant is
   * missing.
   */
  async importFeedResult(
    ctx: ConnectorContext,
    request: FeedImportRequest,
  ): Promise<ConnectorResult<ConnectorFeedSnapshot>> {
    assertOperational(this.lifecycle_.state());
    const inputError = validateContext(ctx) ?? validateFeedImportRequest(request);
    if (inputError) return this.failWith(inputError);
    const capError = this.requireCapability("feedImport");
    if (capError) return this.failWith(capError);
    return this.settle("importFeed", () => this.onImportFeed(ctx, request));
  }

  // --- plain surface (frozen-contract shims — see module docs) --------------

  /** @deprecated prefer `searchResult` — plain surface degrades errors to `[]`. */
  async search(ctx: ConnectorContext, query: string): Promise<SearchResult[]> {
    const result = await this.searchResult(ctx, query);
    return result.ok ? result.value : [];
  }

  /** @deprecated prefer `metadataResult` — plain surface degrades errors to `null`. */
  async metadata(ctx: ConnectorContext, ref: string): Promise<SourceItem | null> {
    const result = await this.metadataResult(ctx, ref);
    return result.ok ? result.value : null;
  }

  /** @deprecated prefer `resolveResult` — plain surface degrades errors to `[]`. */
  async resolve(ctx: ConnectorContext, ref: string): Promise<PlaybackRealization[]> {
    const result = await this.resolveResult(ctx, ref);
    return result.ok ? result.value : [];
  }

  /**
   * @deprecated prefer `executeActionResult` — plain surface degrades errors
   * into a receipt with `status` "unsupported"/"failed" + `detail`.
   */
  async executeAction(ctx: ConnectorContext, action: UserAction): Promise<ActionReceipt> {
    const result = await this.executeActionResult(ctx, action);
    return result.ok ? result.value : degradeReceipt(result.error);
  }

  /** @deprecated prefer `readLibraryResult` — plain surface degrades errors to `[]`. */
  async readLibrary(ctx: ConnectorContext): Promise<LibraryEntry[]> {
    const result = await this.readLibraryResult(ctx);
    return result.ok ? result.value : [];
  }

  /** @deprecated prefer `writeLibraryResult` — plain surface degrades errors into a receipt. */
  async writeLibrary(
    ctx: ConnectorContext,
    command: LibraryCommand,
  ): Promise<ActionReceipt> {
    const result = await this.writeLibraryResult(ctx, command);
    return result.ok ? result.value : degradeReceipt(result.error);
  }

  // --- internals -------------------------------------------------------------

  private failWith<T>(error: ConnectorError): ConnectorResult<T> {
    this.lastError_ = error;
    return errResult<T>(error);
  }

  private async settle<T>(
    op: string,
    hook: () => AsyncConnectorResultInput<T>,
  ): Promise<ConnectorResult<T>> {
    try {
      const result = await asyncResult(hook());
      this.lastError_ = result.ok ? null : result.error;
      return result;
    } catch (thrown) {
      // A hook bug can never bypass the result contract: unexpected throws
      // are wrapped as typed transport errors (the operation did not
      // complete against the source).
      const error = transport(
        this.id,
        `unexpected failure during ${op}: ${describeThrown(thrown)}`,
      );
      this.lastError_ = error;
      return errResult<T>(error);
    }
  }
}
