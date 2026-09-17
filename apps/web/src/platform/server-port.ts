/**
 * @wfx/app-web — the Web ServerPort (R07): the R01 transport seam.
 *
 * The ServerPort implementation the web adapter injects into
 * `createRuntime`. It implements the frozen WFX_API_BASE transport mapping
 * (the endpoint table of the frozen WFX-050 transport contract — the
 * former `host/remote-ports.ts`, carried forward by this module — the
 * transport contract the service side honors) with the R01 TYPED
 * FAILURE refinement: every operation answers `ServerResult` — reads NEVER
 * degrade to empty answers (the frozen WFX-003 degrade law is deliberately
 * superseded here per the R01 ServerPort ratification: a network-down
 * search is an ERROR STATE in the runtime, rendered honestly, never a fake
 * empty result).
 *
 * TRANSPORT TABLE (the frozen mapping + the shorts extension):
 *
 * | ServerPort call     | HTTP                                | Body / query             |
 * |---------------------|-------------------------------------|--------------------------|
 * | `search`            | `GET  {base}/experience/search`     | `?query=<q>`             |
 * | `shorts`            | `GET  {base}/experience/search`     | `?query=<q>` + frozen short-form eligibility (below) |
 * | `metadata`          | `GET  {base}/experience/metadata`   | `?ref=<ref>`             |
 * | `resolve`           | `GET  {base}/experience/resolve`    | `?ref=<ref>`             |
 * | `executeAction`     | `POST {base}/experience/actions`    | `UserAction` JSON        |
 * | `readLibrary`       | `GET  {base}/experience/library`    | —                        |
 * | `writeLibrary`      | `POST {base}/experience/library`    | `LibraryCommand` JSON    |
 * | `emitEvent`         | `POST {base}/experience/events`     | `EntertainmentEvent` JSON |
 *
 * Identity rides as request headers — `x-wfx-user-id`, `x-wfx-session-id`,
 * `x-wfx-locale`, `x-wfx-region` (the frozen transport law: identity never
 * in URLs). The port is BOUND to one `RuntimeContext` at construction.
 *
 * THE SHORTS COMPOSITION (documented transport mapping): the frozen
 * transport has no dedicated shorts endpoint; the R01 ServerPort adds the
 * `shorts` operation. This port composes it over the FROZEN search
 * transport plus the FROZEN short-form eligibility law
 * (`isShortFormCandidate` from `@wfx/experience` — the same law the frozen
 * short feed uses): the search hits are filtered to short-form candidates.
 * When the service ships a dedicated `GET /experience/shorts` endpoint, the
 * mapping swaps in one place (this module) with no adapter surgery.
 *
 * TYPED FAILURE MAPPING (deterministic, from real response states):
 *
 * - fetch rejection (offline, DNS, timeout, abort) → `network`
 * - HTTP 401 / 403 → `unauthorized`
 * - HTTP 404 → `unavailable` (the lead-ratified 404→unavailable honesty
 *   law) — EXCEPT `metadata`, where 404 means the HONEST ABSENCE of the
 *   item (`ok: true, value: null` — the frozen transport's metadata-null
 *   semantics, the one read whose type carries absence)
 * - HTTP 5xx (500/502/503/504…) → `unavailable` (the service answered but
 *   cannot serve right now)
 * - HTTP 408 / 429 → `unavailable` (timeout/rate-limit — retryable later)
 * - other 4xx (400, 409, 422…) → `malformed` (the request as sent was
 *   rejected; garbage named, not swallowed)
 * - 2xx with a non-JSON body → `malformed`
 * - 2xx with a wrong-shaped payload (e.g. a non-array search body) →
 *   `malformed`; individually malformed ENTRIES inside a valid array are
 *   skipped (documented — the same law the runtime's own hit-joining
 *   applies: a broken hit is never a card)
 * - `emitEvent` transport failures answer `ok: false` — the runtime keeps
 *   the event in its at-least-once outbox (the EVENT SINK LAW: a lost
 *   watch-state event is never a silent success)
 * - action/library-write transport failures answer `ok: false` — the
 *   runtime settles the action `failed` / the library entry `failed`
 *   honestly, never a fabricated receipt
 *
 * Determinism: no clock reads, no randomness; the fetch implementation and
 * timeout are injectable seams (tests stub `fetch` and run offline).
 */

import type {
  ActionReceipt,
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
import { isIso8601, isRecord, validatePlaybackRealization } from "@wfx/domain";
import { isShortFormCandidate } from "@wfx/experience";
import type {
  ProfileHistoryEntry,
  RecommendationPolicyCommand,
  RuntimeContext,
  ServerPort,
  ServerResult,
  UserIntentCommand,
} from "@wfx/client-runtime";
import type { ServerFailure, ServerFailureKind } from "@wfx/client-runtime";

/** Options for {@link createWebServerPort}. */
export interface WebServerPortOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /** The identity context every request is stamped with (headers, never URLs). */
  readonly context: RuntimeContext;
  /** The fetch implementation (default: the global `fetch`; tests inject a stub). */
  readonly fetchImpl?: typeof fetch;
  /**
   * Per-request timeout in milliseconds (default 10 000; `0` disables).
   * Bounded so a hung service cannot pin a server render.
   */
  readonly timeoutMs?: number;
}

/** The stable service binding identity this port fronts. */
export const WEB_SERVER_SERVICE_ID = "wfx-experience-service";

/** The HTTP status classes the failure mapping consumes (documented law). */
function failureForStatus(
  method: "GET" | "POST" | "PUT",
  status: number,
  url: string,
): ServerFailure {
  const detail = `${method} ${url} answered HTTP ${status}`;
  let kind: ServerFailureKind;
  if (status === 401 || status === 403) {
    kind = "unauthorized";
  } else if (status >= 500 || status === 408 || status === 429) {
    kind = "unavailable";
  } else {
    // 404 and the remaining 4xx: the service answered "cannot serve this
    // request as sent" — unavailable per the ratified mapping (metadata
    // 404 is handled separately as honest absence).
    kind = status === 404 ? "unavailable" : "malformed";
  }
  return { kind, detail };
}

/** One raw request outcome (transport-level, before payload validation). */
type RawOutcome =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: ServerFailure };

/** Create the Web ServerPort over the frozen WFX_API_BASE transport. */
export function createWebServerPort(options: WebServerPortOptions): ServerPort {
  const base = options.apiBase;
  const context = options.context;
  // The fetch seam resolves PER CALL when not injected — the standard
  // testability pattern (a stubbed global fetch is honored even for ports
  // constructed before the stub installed). The narrow call signature is
  // deliberate: this port only ever GETs/POSTs.
  const fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;

  function endpoint(path: string, query?: URLSearchParams): string {
    const url = new URL(`${base.pathname === "/" ? "" : base.pathname}${path}`, base);
    if (query !== undefined) {
      for (const [key, value] of query.entries()) url.searchParams.set(key, value);
    }
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
    operation: string,
    method: "GET" | "POST" | "PUT",
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
      return { ok: false, failure: failureForStatus(method, response.status, url) };
    }
    if (response.status === 204) {
      return { ok: true, body: undefined };
    }
    try {
      return { ok: true, body: await response.json() };
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return {
        ok: false,
        failure: { kind: "malformed", detail: `${method} ${url} answered a non-JSON body (${message})` },
      };
    }
  }

  // -------------------------------------------------------------------------
  // Payload guards (mirroring the frozen transport's — a malformed service
  // answer never becomes domain data; individually malformed entries are
  // skipped, a wrong-shaped payload is a typed malformed failure)
  // -------------------------------------------------------------------------

  function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  function isUsableSearchResult(value: unknown): value is SearchResult {
    if (!isRecord(value)) return false;
    if (!isNonEmptyString(value.connectorId)) return false;
    if (!isNonEmptyString(value.externalRef)) return false;
    if (typeof value.title !== "string") return false;
    if (value.canonicalType !== undefined && typeof value.canonicalType !== "string") return false;
    if (
      value.durationMs !== undefined &&
      (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0)
    ) {
      return false;
    }
    if (value.orientation !== undefined && typeof value.orientation !== "string") return false;
    return true;
  }

  function isUsableSourceItem(value: unknown): value is SourceItem {
    if (!isRecord(value)) return false;
    // The SourceItem extensions first (checked as a raw record — a
    // SearchResult-shaped guard would narrow away the extra fields).
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
    return isUsableSearchResult(value);
  }

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

  function isUsableReceipt(value: unknown): value is ActionReceipt {
    if (!isRecord(value)) return false;
    if (
      value.status !== "confirmed" &&
      value.status !== "local-only" &&
      value.status !== "unsupported" &&
      value.status !== "failed"
    ) {
      return false;
    }
    if (typeof value.occurredAt !== "string" || !isIso8601(value.occurredAt)) return false;
    if (value.externalId !== undefined && typeof value.externalId !== "string") return false;
    if (value.detail !== undefined && typeof value.detail !== "string") return false;
    return true;
  }

  // — the R02 profile-extension guards (mirroring the desktop adapter's
  // lead-ratified shapes verbatim: a malformed service answer never
  // becomes domain data) —

  /** Transport guard for one usable `ProfileHistoryEntry` (the R02 shape). */
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

  /** Filter a must-be-array payload; a non-array is a typed malformed failure. */
  function arrayOf(
    body: unknown,
    operation: string,
  ): { readonly ok: true; readonly entries: readonly unknown[] } | { readonly ok: false; readonly failure: ServerFailure } {
    if (!Array.isArray(body)) {
      return {
        ok: false,
        failure: {
          kind: "malformed",
          detail: `${operation} answered ${preview(body)} (expected a JSON array)`,
        },
      };
    }
    return { ok: true, entries: body };
  }

  return {
    serviceId: WEB_SERVER_SERVICE_ID,

    async search(query: string): Promise<ServerResult<readonly SearchResult[]>> {
      const outcome = await request(
        "search",
        "GET",
        endpoint("/experience/search", new URLSearchParams({ query })),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "search");
      if (!array.ok) return { ok: false, failure: array.failure };
      return {
        ok: true,
        value: array.entries.filter((hit): hit is SearchResult => isUsableSearchResult(hit)),
      };
    },

    async shorts(query?: string): Promise<ServerResult<readonly SearchResult[]>> {
      // The documented shorts composition: the frozen search transport +
      // the frozen short-form eligibility law (see the module doc). The
      // eligibility projection carries only the fields the frozen law
      // reads (canonicalType/orientation/durationMs) — the id is a
      // type-level placeholder, never exposed.
      const effectiveQuery = query ?? "";
      const outcome = await request(
        "shorts",
        "GET",
        endpoint(
          "/experience/search",
          effectiveQuery.length > 0 ? new URLSearchParams({ query: effectiveQuery }) : undefined,
        ),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "shorts");
      if (!array.ok) return { ok: false, failure: array.failure };
      const shortForm: SearchResult[] = [];
      for (const entry of array.entries) {
        if (!isUsableSearchResult(entry)) continue;
        if (
          isShortFormCandidate({
            id: "wfxitm_shorts_projection",
            canonicalType: entry.canonicalType ?? "video",
            ...(entry.orientation !== undefined ? { orientation: entry.orientation } : {}),
            ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
          })
        ) {
          shortForm.push(entry);
        }
      }
      return { ok: true, value: shortForm };
    },

    async metadata(ref: string): Promise<ServerResult<SourceItem | null>> {
      const url = endpoint("/experience/metadata", new URLSearchParams({ ref }));
      const outcome = await request("metadata", "GET", url);
      if (!outcome.ok) {
        // The ONE read whose type carries absence: metadata 404 is the
        // honest "no metadata for this ref" (the frozen transport's null),
        // not a service failure. Every other failure stays typed.
        if (outcome.failure.kind === "unavailable" && isNotFound(outcome.failure, url)) {
          return { ok: true, value: null };
        }
        return { ok: false, failure: outcome.failure };
      }
      if (outcome.body === null) return { ok: true, value: null };
      if (!isUsableSourceItem(outcome.body)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `metadata answered a payload that is not a usable SourceItem (${preview(outcome.body)})`,
          },
        };
      }
      return { ok: true, value: outcome.body };
    },

    async resolve(ref: string): Promise<ServerResult<readonly PlaybackRealization[]>> {
      const outcome = await request(
        "resolve",
        "GET",
        endpoint("/experience/resolve", new URLSearchParams({ ref })),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "resolve");
      if (!array.ok) return { ok: false, failure: array.failure };
      return {
        ok: true,
        value: array.entries.filter(
          (candidate): candidate is PlaybackRealization => validatePlaybackRealization(candidate).ok,
        ),
      };
    },

    async executeAction(action: UserAction): Promise<ServerResult<ActionReceipt>> {
      const outcome = await request(
        "actions",
        "POST",
        endpoint("/experience/actions"),
        JSON.stringify(action),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      if (!isUsableReceipt(outcome.body)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `POST /experience/actions answered a payload that is not a usable ActionReceipt (${preview(outcome.body)})`,
          },
        };
      }
      return { ok: true, value: outcome.body };
    },

    async readLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
      const outcome = await request("library", "GET", endpoint("/experience/library"));
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "library");
      if (!array.ok) return { ok: false, failure: array.failure };
      return {
        ok: true,
        value: array.entries.filter((entry): entry is LibraryEntry => isUsableLibraryEntry(entry)),
      };
    },

    async writeLibrary(command: LibraryCommand): Promise<ServerResult<ActionReceipt>> {
      const outcome = await request(
        "library",
        "POST",
        endpoint("/experience/library"),
        JSON.stringify(command),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      if (!isUsableReceipt(outcome.body)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `POST /experience/library answered a payload that is not a usable ActionReceipt (${preview(outcome.body)})`,
          },
        };
      }
      return { ok: true, value: outcome.body };
    },

    async emitEvent(event: EntertainmentEvent): Promise<ServerResult<void>> {
      const outcome = await request("events", "POST", endpoint("/experience/events"), JSON.stringify(event));
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      return { ok: true, value: undefined };
    },

    // — the R02 profile extension (ADD-ONLY; lead-ratified HTTP mapping) —
    // These endpoints land with R04 (history) and R05 (intents/policy);
    // until then the typed `unavailable` failure answers honestly (never
    // a fake empty read), and the mapping needs ZERO changes when they do
    // (the same law the desktop adapter's R02 integration ratified).

    async readHistory(): Promise<ServerResult<readonly ProfileHistoryEntry[]>> {
      const outcome = await request("history", "GET", endpoint("/experience/history"));
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "history");
      if (!array.ok) return { ok: false, failure: array.failure };
      return {
        ok: true,
        value: array.entries.filter(
          (entry): entry is ProfileHistoryEntry => isUsableProfileHistoryEntry(entry),
        ),
      };
    },

    async readProfileLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
      // The profile-scoped twin of readLibrary: the SAME endpoint — with an
      // authenticated session the server scopes to the active profile;
      // anonymous sessions get the default-profile fallback (the R02 law).
      const outcome = await request(
        "profile-library",
        "GET",
        endpoint("/experience/library"),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "profile-library");
      if (!array.ok) return { ok: false, failure: array.failure };
      return {
        ok: true,
        value: array.entries.filter((entry): entry is LibraryEntry => isUsableLibraryEntry(entry)),
      };
    },

    async readIntents(): Promise<ServerResult<readonly IntentRecord[]>> {
      const outcome = await request("intents", "GET", endpoint("/experience/intents"));
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      const array = arrayOf(outcome.body, "intents");
      if (!array.ok) return { ok: false, failure: array.failure };
      return {
        ok: true,
        value: array.entries.filter(
          (entry): entry is IntentRecord => isUsableIntentRecord(entry),
        ),
      };
    },

    async writeIntent(intent: UserIntentCommand): Promise<ServerResult<void>> {
      const outcome = await request(
        "intents",
        "POST",
        endpoint("/experience/intents"),
        JSON.stringify(intent),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      return { ok: true, value: undefined };
    },

    async readPolicy(): Promise<ServerResult<RecommendationPolicy | null>> {
      const outcome = await request("policy", "GET", endpoint("/experience/policy"));
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      if (outcome.body === null) return { ok: true, value: null };
      if (!isUsableRecommendationPolicy(outcome.body)) {
        return {
          ok: false,
          failure: {
            kind: "malformed",
            detail: `GET /experience/policy answered a payload that is not a usable RecommendationPolicy (${preview(outcome.body)})`,
          },
        };
      }
      return { ok: true, value: outcome.body };
    },

    async writePolicy(policy: RecommendationPolicyCommand): Promise<ServerResult<void>> {
      const outcome = await request(
        "policy",
        "PUT",
        endpoint("/experience/policy"),
        JSON.stringify(policy),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      return { ok: true, value: undefined };
    },
  };
}

/** Does this failure detail name the 404 of this exact URL? (metadata law) */
function isNotFound(failure: ServerFailure, url: string): boolean {
  return failure.detail.includes(`${url} answered HTTP 404`);
}

/** A short, honest preview of an untrusted payload (never a dump). */
function preview(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array-expected mismatch";
  return typeof value;
}
