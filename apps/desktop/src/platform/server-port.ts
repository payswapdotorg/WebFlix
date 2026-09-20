/**
 * @wfx/app-desktop — ServerPort against the Experience API (R08).
 *
 * The Desktop server transport seam: the SAME frozen `WFX_API_BASE`
 * transport contract the web adapter's host maps
 * (`apps/web/src/host/remote-ports.ts`), consumed from the desktop
 * adapter — identical endpoints, identical identity channel, IDENTICAL
 * payload guards, but answering the R01 `ServerPort`'s TYPED
 * `ServerResult` failures (the R01 refinement: an adapter implementing
 * THIS port answers `ok: false` with the typed `ServerFailure` instead
 * of silently degrading reads to empty answers — a network-down search
 * is an ERROR STATE in the runtime, never a fake empty result).
 *
 * ENDPOINT MAPPING (the frozen transport contract, verbatim):
 *
 * | ServerPort call       | HTTP                                  | Body / query             |
 * |-----------------------|---------------------------------------|--------------------------|
 * | `search`              | `GET  {base}/experience/search`       | `?query=<q>`             |
 * | `shorts`              | `GET  {base}/experience/shorts`       | `?query=<q>` (optional)  |
 * | `metadata`            | `GET  {base}/experience/metadata`     | `?ref=<ref>`             |
 * | `resolve`             | `GET  {base}/experience/resolve`      | `?ref=<ref>`             |
 * | `executeAction`       | `POST {base}/experience/actions`      | `UserAction` JSON        |
 * | `readLibrary`         | `GET  {base}/experience/library`      | —                        |
 * | `writeLibrary`        | `POST {base}/experience/library`      | `LibraryCommand` JSON    |
 * | `emitEvent`           | `POST {base}/experience/events`       | `EntertainmentEvent` JSON|
 *
 * (`shorts` is the R01 ServerPort's shorts-surface operation; the frozen
 * web transport table has no row for it yet — the desktop adapter maps
 * the natural `GET /experience/shorts` and flags it for R07's lead
 * ratification, documented in the adapter README.)
 *
 * Failure semantics (the R01 laws):
 * - READ-SHAPED CALLS answer `{ ok: false, failure }` with the typed kind:
 *   transport did not complete → `"network"`; HTTP 401/403 →
 *   `"unauthorized"`; HTTP 5xx → `"unavailable"`; non-JSON or malformed
 *   payload → `"malformed"`. Never a silent empty answer.
 * - ACTION-SHAPED CALLS answer `ok: false` on transport failure; a
 *   service answer that fails the receipt guard answers a `"malformed"`
 *   failure — the runtime settles the action `failed`, never a fabricated
 *   success.
 * - THE EVENT SINK LAW (frozen verbatim): `emitEvent` answers its failure
 *   (`ok: false`) — the runtime keeps the event pending in its
 *   at-least-once outbox; a lost watch-state event is NEVER a silent
 *   success.
 * - Identity rides as headers (`x-wfx-user-id`, `x-wfx-session-id`,
 *   `x-wfx-locale`, `x-wfx-region`) — never in URLs.
 *
 * Injectability (the same seams as the web host): the `fetch`
 * implementation, the clock, and the id source are options — tests inject
 * a stub fetch and run fully offline and deterministically. The clock is
 * the adapter's ONE wall-clock read (receipt timestamps); ids are
 * canonical Crockford ULID bodies from `crypto.getRandomValues`.
 */

import type {
  ActionReceipt,
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
import { isIso8601, isRecord, validatePlaybackRealization } from "@wfx/domain";
import type {
  ByomBindingCommand,
  ByomBindingHandle,
  ModelPolicyCommand,
  ModelProviderInfo,
  ProfileHistoryEntry,
  RecommendationPolicyCommand,
  RuntimeContext,
  RuntimeClock,
  RuntimeIdGen,
  ServerFailure,
  ServerFailureKind,
  ServerPort,
  ServerResult,
  SourceInfo,
  TransformOperation,
  TransformSubmitCommand,
  UserIntentCommand,
} from "@wfx/client-runtime";
import { isTransformOperationState, isUsableSourceInfo } from "@wfx/client-runtime";

// ---------------------------------------------------------------------------
// The production seams (clock + ids — the same discipline as the web host)
// ---------------------------------------------------------------------------

/**
 * The production `RuntimeClock`: the real wall clock. This is the ONE
 * place in the desktop adapter that reads `Date.now()` — the runtime and
 * the domain stay deterministic and time-injected.
 */
export class SystemClock implements RuntimeClock {
  now(): number {
    return Date.now();
  }
}

/** The Crockford Base32 alphabet (excludes I, L, O, U) — 32 symbols. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Canonical ULID body shape (mirrors @wfx/domain `ids.ts`). */
const ULID_BODY_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * The production `RuntimeIdGen`: cryptographically random 26-char
 * Crockford Base32 ULID bodies (first char in `[0-7]`, 32 divides 256 so
 * `byte % 32` is uniform). No `Math.random()` anywhere.
 */
export class CryptoUlidGen implements RuntimeIdGen {
  next(): string {
    const bytes = new Uint8Array(26);
    crypto.getRandomValues(bytes);
    let body = CROCKFORD_ALPHABET[bytes[0]! % 8]!;
    for (let index = 1; index < 26; index += 1) {
      body += CROCKFORD_ALPHABET[bytes[index]! % 32];
    }
    return body;
  }
}

/** Is this a canonical 26-char Crockford ULID body? */
export function isUlidBody(value: string): boolean {
  return ULID_BODY_RE.test(value);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopServerPort}. */
export interface DesktopServerPortOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /** The identity context stamped onto every request's headers. */
  readonly context: RuntimeContext;
  /** The fetch implementation (default: the platform `fetch`). */
  readonly fetchImpl?: FetchLike;
  /**
   * Per-request timeout in milliseconds (default 10 000; `0` disables).
   * Bounds a hung service from pinning the desktop app.
   */
  readonly timeoutMs?: number;
}

/**
 * The structural fetch seam this transport consumes (the call signature
 * only — tests inject a stub; production passes the platform `fetch`).
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The connector-style id this transport presents (stable, honest). */
export const DESKTOP_SERVICE_CONNECTOR_ID = "wfx-experience-service";

// ---------------------------------------------------------------------------
// Payload guards (a malformed service answer never becomes domain data —
// the same guards the frozen web host applies, mirrored for this adapter)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Transport guard for one `SearchResult` (the feed-use-case mirror). */
function isUsableSearchResult(value: unknown): value is SearchResult {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (!isOptionalString(value.canonicalType)) return false;
  if (value.durationMs !== undefined && !isNonNegativeFinite(value.durationMs)) return false;
  if (!isOptionalString(value.orientation)) return false;
  return true;
}

/** Transport guard for one `SourceItem`. */
function isUsableSourceItem(value: unknown): value is SourceItem {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (!isOptionalString(value.canonicalType)) return false;
  if (value.durationMs !== undefined && !isNonNegativeFinite(value.durationMs)) return false;
  if (!isOptionalString(value.orientation)) return false;
  if (
    value.availability !== "available" &&
    value.availability !== "unknown" &&
    value.availability !== "unavailable"
  ) {
    return false;
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((cap) => typeof cap === "string")) {
    return false;
  }
  return true;
}

/** Transport guard for one `LibraryEntry`. */
function isUsableLibraryEntry(value: unknown): value is LibraryEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (value.addedAt !== undefined && (typeof value.addedAt !== "string" || !isIso8601(value.addedAt))) {
    return false;
  }
  return true;
}

/** Transport guard for one usable `ProfileHistoryEntry` (the R02 read). */
function isUsableProfileHistoryEntry(value: unknown): value is ProfileHistoryEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.itemId)) return false;
  if (typeof value.positionMs !== "number" || !Number.isFinite(value.positionMs) || value.positionMs < 0) {
    return false;
  }
  if (typeof value.completed !== "boolean") return false;
  if (value.lastEventType !== null && typeof value.lastEventType !== "string") return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  return true;
}

/** Transport guard for one usable `IntentRecord` (the frozen intent shape). */
function isUsableIntentRecord(value: unknown): value is IntentRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !value.id.startsWith("wfxint_")) return false;
  if (!isNonEmptyString(value.userId)) return false;
  if (!isNonEmptyString(value.objective)) return false;
  if (typeof value.weight !== "number" || !Number.isFinite(value.weight)) return false;
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  if (typeof value.evidenceCount !== "number" || !Number.isInteger(value.evidenceCount)) return false;
  return true;
}

/** Transport guard for one usable `RecommendationPolicy` (the frozen shape). */
function isUsableRecommendationPolicy(value: unknown): value is RecommendationPolicy {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.userId)) return false;
  if (!Array.isArray(value.objectives)) return false;
  for (const objective of value.objectives) {
    if (!isRecord(objective)) return false;
    if (!isNonEmptyString(objective.id)) return false;
    if (typeof objective.weight !== "number" || !Number.isFinite(objective.weight)) return false;
    if (objective.direction !== "maximize" && objective.direction !== "minimize") return false;
  }
  for (const dial of [value.exploration, value.novelty, value.socialInfluence]) {
    if (typeof dial !== "number" || !Number.isFinite(dial)) return false;
  }
  if (
    value.attentionMode !== "mindful" &&
    value.attentionMode !== "balanced" &&
    value.attentionMode !== "immersive" &&
    value.attentionMode !== "custom"
  ) {
    return false;
  }
  return true;
}

/** Transport guard for one usable `ActionReceipt` (the frozen statuses). */
function isUsableReceipt(value: unknown): value is ActionReceipt {
  if (!isRecord(value)) return false;
  if (
    value.status !== "confirmed" &&
    value.status !== "confirmed-locally" &&
    value.status !== "unsupported" &&
    value.status !== "failed"
  ) {
    return false;
  }
  if (typeof value.occurredAt !== "string" || !isIso8601(value.occurredAt)) return false;
  if (value.detail !== undefined && typeof value.detail !== "string") return false;
  if (value.externalId !== undefined && typeof value.externalId !== "string") return false;
  return true;
}

// ---------------------------------------------------------------------------
// The R03/R06 model-controls payload guards (R21-B — the desktop twin of
// the web port's completion; a malformed service answer never becomes
// domain data)
// ---------------------------------------------------------------------------

/** The frozen ModelTask vocabulary (mirrors the frozen domain union). */
const MODEL_TASKS: readonly ModelTask[] = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
];

/** The frozen ModelPolicy privacy vocabulary. */
const MODEL_PRIVACIES: readonly ModelPolicy["privacy"][] = [
  "local-only",
  "trusted-cloud",
  "any-cloud",
];

/** Transport guard for one usable `ModelPolicy` (the frozen shape). */
function isUsableModelPolicy(value: unknown): value is ModelPolicy {
  if (!isRecord(value)) return false;
  if (!MODEL_TASKS.includes(value.task as ModelTask)) return false;
  if (value.preferredProvider !== undefined && typeof value.preferredProvider !== "string") {
    return false;
  }
  if (
    !Array.isArray(value.fallbackProviders) ||
    !value.fallbackProviders.every((provider) => typeof provider === "string" && provider.length > 0)
  ) {
    return false;
  }
  if (!MODEL_PRIVACIES.includes(value.privacy as ModelPolicy["privacy"])) return false;
  if (
    value.maxCostPerOperation !== undefined &&
    (typeof value.maxCostPerOperation !== "number" ||
      !Number.isFinite(value.maxCostPerOperation) ||
      value.maxCostPerOperation < 0)
  ) {
    return false;
  }
  return true;
}

/** Transport guard for one usable `ModelProviderInfo` (the registry row). */
function isUsableModelProvider(value: unknown): value is ModelProviderInfo {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (value.privacy !== "local" && value.privacy !== "cloud") return false;
  if (
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((task) => MODEL_TASKS.includes(task as ModelTask))
  ) {
    return false;
  }
  if (typeof value.byomBound !== "boolean") return false;
  if (!isRecord(value.costs)) return false;
  for (const cost of Object.values(value.costs)) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return false;
  }
  if (value.availability !== "available" && value.availability !== "unsupported") return false;
  return true;
}

/** Transport guard for one usable BYOM binding handle (secret-free projection). */
function isUsableByomHandle(value: unknown): value is ByomBindingHandle {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.providerId)) return false;
  if (!isNonEmptyString(value.endpointUrl)) return false;
  if (!isNonEmptyString(value.keyId)) return false;
  if (value.metadata !== null && !isRecord(value.metadata)) return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  return true;
}

/** Transport guard for one usable `TransformOperation` (the snapshot record). */
function isUsableTransformOperation(value: unknown): value is TransformOperation {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id.startsWith("wfxtx_")) return false;
  if (typeof value.kind !== "string" || value.kind.length === 0) return false;
  if (typeof value.targetRef !== "string") return false;
  if (!isRecord(value.options)) return false;
  if (!isTransformOperationState(value.state)) return false;
  if (
    value.progress !== null &&
    (typeof value.progress !== "number" || !Number.isFinite(value.progress))
  ) {
    return false;
  }
  if (value.resultRef !== null && typeof value.resultRef !== "string") return false;
  if (value.errorDetail !== null && typeof value.errorDetail !== "string") return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The transport core
// ---------------------------------------------------------------------------

type RequestOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: ServerFailure };

/**
 * Build the Desktop `ServerPort` against the frozen `WFX_API_BASE`
 * transport. Failures are typed per the R01 refinement (see module doc);
 * identity rides as headers, never in URLs.
 */
export function createDesktopServerPort(options: DesktopServerPortOptions): ServerPort {
  const base = options.apiBase;
  const context = options.context;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;

  const serviceId = `${DESKTOP_SERVICE_CONNECTOR_ID}@${base.origin}`;

  function endpoint(path: string, query?: URLSearchParams): string {
    const url = new URL(`${base.pathname === "/" ? "" : base.pathname}${path}`, base);
    if (query !== undefined) {
      for (const [key, value] of query.entries()) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  function contextHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "x-wfx-user-id": context.userId,
      "x-wfx-session-id": context.sessionId,
      "x-wfx-locale": context.locale,
    };
    if (context.region !== undefined) headers["x-wfx-region"] = context.region;
    return headers;
  }

  async function request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    body?: string,
  ): Promise<RequestOutcome> {
    const headers: Record<string, string> = { accept: "application/json", ...contextHeaders() };
    let signal: AbortSignal | undefined;
    if (timeoutMs > 0) signal = AbortSignal.timeout(timeoutMs);
    if (body !== undefined) headers["content-type"] = "application/json";
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (signal !== undefined) init.signal = signal;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (thrown) {
      const name = thrown instanceof Error ? thrown.name : "unknown";
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return {
        ok: false,
        failure: {
          kind: "network",
          detail: `${method} ${url} did not complete (${name}: ${message})`,
        },
      };
    }
    if (!response.ok) {
      const kind: ServerFailureKind =
        response.status === 401 || response.status === 403
          ? "unauthorized"
          : response.status === 404 || response.status >= 500
            ? "unavailable"
            : "malformed";
      // 404 -> "unavailable" (lead ratification, R02 integration): the
      // profile-aware reads map onto /experience/{history,intents,policy},
      // which the R04/R05 lanes serve — the honest answer is "the service
      // cannot serve this right now", not "garbage payload".
      return {
        ok: false,
        failure: {
          kind,
          detail: `${method} ${url} answered HTTP ${response.status}`,
        },
      };
    }
    if (response.status === 204) return { ok: true, value: undefined };
    try {
      return { ok: true, value: await response.json() };
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return {
        ok: false,
        failure: {
          kind: "malformed",
          detail: `${method} ${url} answered a non-JSON body (${message})`,
        },
      };
    }
  }

  /** Read-shaped array fetch with element-level guards (malformed filtered, honest). */
  async function readArray(
    url: string,
    guard: (value: unknown) => boolean,
    label: string,
  ): Promise<ServerResult<readonly unknown[]>> {
    const result = await request("GET", url);
    if (!result.ok) return { ok: false, failure: result.failure };
    if (!Array.isArray(result.value)) {
      return {
        ok: false,
        failure: { kind: "malformed", detail: `${label} answered a non-array payload` },
      };
    }
    // Malformed ELEMENTS are filtered (garbage never becomes a card); the
    // array shape itself was checked — the runtime's own registry re-checks
    // what it consumes.
    return { ok: true, value: result.value.filter((entry) => guard(entry)) };
  }

  return {
    serviceId,

    async search(query: string): Promise<ServerResult<readonly SearchResult[]>> {
      const result = await readArray(
        endpoint("/experience/search", new URLSearchParams({ query })),
        isUsableSearchResult,
        "GET /experience/search",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly SearchResult[] };
    },

    async shorts(query?: string): Promise<ServerResult<readonly SearchResult[]>> {
      const search = new URLSearchParams();
      if (query !== undefined && query.length > 0) search.set("query", query);
      const result = await readArray(
        endpoint("/experience/shorts", search),
        isUsableSearchResult,
        "GET /experience/shorts",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly SearchResult[] };
    },

    async metadata(ref: string): Promise<ServerResult<SourceItem | null>> {
      const result = await request(
        "GET",
        endpoint("/experience/metadata", new URLSearchParams({ ref })),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (result.value === null) return { ok: true, value: null };
      if (!isUsableSourceItem(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "GET /experience/metadata answered a malformed SourceItem",
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async resolve(ref: string): Promise<ServerResult<readonly PlaybackRealization[]>> {
      const result = await readArray(
        endpoint("/experience/resolve", new URLSearchParams({ ref })),
        (entry) => validatePlaybackRealization(entry).ok,
        "GET /experience/resolve",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly PlaybackRealization[] };
    },

    async executeAction(action: UserAction): Promise<ServerResult<ActionReceipt>> {
      const result = await request("POST", endpoint("/experience/actions"), JSON.stringify(action));
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isUsableReceipt(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "POST /experience/actions answered a malformed ActionReceipt",
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async readLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
      const result = await readArray(
        endpoint("/experience/library"),
        isUsableLibraryEntry,
        "GET /experience/library",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly LibraryEntry[] };
    },

    async writeLibrary(command: LibraryCommand): Promise<ServerResult<ActionReceipt>> {
      const result = await request(
        "POST",
        endpoint("/experience/library"),
        JSON.stringify(command),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isUsableReceipt(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "POST /experience/library answered a malformed ActionReceipt",
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async emitEvent(event: EntertainmentEvent): Promise<ServerResult<void>> {
      // THE EVENT SINK LAW: the event carries its own identity stamps; the
      // failure answers ok:false so the runtime keeps it pending — a lost
      // watch-state event is never a silent success.
      const result = await request("POST", endpoint("/experience/events"), JSON.stringify(event));
      if (!result.ok) return { ok: false, failure: result.failure };
      return { ok: true, value: undefined };
    },

    // — the R02 profile extension (ADD-ONLY; lead-ratified HTTP mapping) —
    // These endpoints land with R04 (history) and R05 (intents/policy);
    // until then the typed `unavailable` failure answers honestly (never
    // a fake empty read), and the mapping needs ZERO changes when they do.

    async readHistory(): Promise<ServerResult<readonly ProfileHistoryEntry[]>> {
      const result = await readArray(
        endpoint("/experience/history"),
        isUsableProfileHistoryEntry,
        "GET /experience/history",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly ProfileHistoryEntry[] };
    },

    async readProfileLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
      // The profile-scoped twin of readLibrary: the SAME endpoint — with an
      // authenticated session the server scopes to the active profile;
      // anonymous sessions get the default-profile fallback (the R02 law).
      const result = await readArray(
        endpoint("/experience/library"),
        isUsableLibraryEntry,
        "GET /experience/library (profile-scoped)",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly LibraryEntry[] };
    },

    async readIntents(): Promise<ServerResult<readonly IntentRecord[]>> {
      const result = await readArray(
        endpoint("/experience/intents"),
        isUsableIntentRecord,
        "GET /experience/intents",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly IntentRecord[] };
    },

    async writeIntent(intent: UserIntentCommand): Promise<ServerResult<void>> {
      const result = await request(
        "POST",
        endpoint("/experience/intents"),
        JSON.stringify(intent),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      return { ok: true, value: undefined };
    },

    async readPolicy(): Promise<ServerResult<RecommendationPolicy | null>> {
      const result = await request("GET", endpoint("/experience/policy"));
      if (!result.ok) return { ok: false, failure: result.failure };
      if (result.value === null) return { ok: true, value: null };
      if (!isUsableRecommendationPolicy(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "GET /experience/policy answered a malformed RecommendationPolicy",
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async writePolicy(policy: RecommendationPolicyCommand): Promise<ServerResult<void>> {
      const result = await request(
        "PUT",
        endpoint("/experience/policy"),
        JSON.stringify(policy),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      return { ok: true, value: undefined };
    },

    // — the R03 source read (ADD-ONLY; R21-B wires the desktop transport —
    // the same completion the web port received: GET /sources over the
    // { authenticated, sources } envelope) —

    async readSources(): Promise<ServerResult<readonly SourceInfo[]>> {
      const result = await request("GET", endpoint("/sources"));
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isRecord(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "GET /sources answered a non-object payload (expected the { authenticated, sources } envelope)",
          },
        };
      }
      const sources = (result.value as { sources?: unknown }).sources;
      if (!Array.isArray(sources)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "GET /sources answered a 'sources' field that is not a JSON array",
          },
        };
      }
      const usable = sources.filter((source) => isUsableSourceInfo(source));
      return { ok: true, value: usable as readonly SourceInfo[] };
    },

    // — the R06 model-and-AI-controls extension (ADD-ONLY; the R21-B
    // transport completion — the desktop twin of the web port's mapping) —

    async readModelPolicy(task: ModelTask): Promise<ServerResult<ModelPolicy | null>> {
      const result = await request(
        "GET",
        endpoint("/experience/model-policy", new URLSearchParams({ task })),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (result.value === null) return { ok: true, value: null };
      if (!isUsableModelPolicy(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `GET /experience/model-policy answered a malformed ModelPolicy (task '${task}')`,
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async writeModelPolicy(command: ModelPolicyCommand): Promise<ServerResult<void>> {
      const result = await request(
        "PUT",
        endpoint("/experience/model-policy"),
        JSON.stringify(command),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      return { ok: true, value: undefined };
    },

    async readModelProviders(): Promise<ServerResult<readonly ModelProviderInfo[]>> {
      const result = await readArray(
        endpoint("/experience/model-providers"),
        isUsableModelProvider,
        "GET /experience/model-providers",
      );
      if (!result.ok) return result;
      return { ok: true, value: result.value as readonly ModelProviderInfo[] };
    },

    async bindByomProvider(command: ByomBindingCommand): Promise<ServerResult<ByomBindingHandle>> {
      const result = await request(
        "PUT",
        endpoint(`/experience/model-providers/byom/${encodeURIComponent(command.providerId)}`),
        JSON.stringify({
          endpointUrl: command.endpointUrl,
          key: command.key,
          ...(command.metadata !== undefined ? { metadata: command.metadata } : {}),
          ...(command.capabilities !== undefined ? { capabilities: command.capabilities } : {}),
          ...(command.costPerCall !== undefined ? { costPerCall: command.costPerCall } : {}),
        }),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isUsableByomHandle(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "PUT /experience/model-providers/byom answered a malformed binding handle",
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async unbindByomProvider(providerId: string): Promise<ServerResult<void>> {
      const result = await request(
        "DELETE",
        endpoint(`/experience/model-providers/byom/${encodeURIComponent(providerId)}`),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      return { ok: true, value: undefined };
    },

    async submitTransform(command: TransformSubmitCommand): Promise<ServerResult<TransformOperation>> {
      const result = await request(
        "POST",
        endpoint("/experience/transforms"),
        JSON.stringify({
          kind: command.kind,
          input: command.input,
          ...(command.options !== undefined ? { options: command.options } : {}),
        }),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isUsableTransformOperation(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: "POST /experience/transforms answered a malformed transform operation",
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async readTransform(operationId: string): Promise<ServerResult<TransformOperation>> {
      const result = await request(
        "GET",
        endpoint(`/experience/transforms/${encodeURIComponent(operationId)}`),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      const operation = isRecord(result.value)
        ? (result.value as { operation?: unknown }).operation
        : undefined;
      if (!isUsableTransformOperation(operation)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `GET /experience/transforms/:id answered a malformed transform operation ('${operationId}')`,
          },
        };
      }
      return { ok: true, value: operation };
    },

    async cancelTransform(operationId: string): Promise<ServerResult<TransformOperation>> {
      const result = await request(
        "POST",
        endpoint(`/experience/transforms/${encodeURIComponent(operationId)}/cancel`),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isUsableTransformOperation(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `POST /experience/transforms/:id/cancel answered a malformed transform operation ('${operationId}')`,
          },
        };
      }
      return { ok: true, value: result.value };
    },

    async clearTransformResult(operationId: string): Promise<ServerResult<TransformOperation>> {
      const result = await request(
        "DELETE",
        endpoint(`/experience/transforms/${encodeURIComponent(operationId)}`),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      if (!isUsableTransformOperation(result.value)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `DELETE /experience/transforms/:id answered a malformed transform operation ('${operationId}')`,
          },
        };
      }
      return { ok: true, value: result.value };
    },
  };
}
