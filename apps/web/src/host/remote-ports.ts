/**
 * @wfx/app-web — split-runtime service ports (WFX-050).
 *
 * The PRODUCTION port bundle: a `Ports` implementation that consumes the
 * Experience API over HTTP at `WFX_API_BASE` (the canonical environment
 * variable for split-runtime service consumption —
 * docs/infrastructure/environment-inventory.md). This is real wiring, not
 * fixtures: every capability this bundle answers for is an actual HTTP
 * round-trip to the configured service.
 *
 * Transport contract (the WFX_API_BASE mapping this host implements; the
 * service side is a later productionization lane and must honor it):
 *
 * | Ports call                | HTTP                                | Body / query          |
 * |---------------------------|-------------------------------------|-----------------------|
 * | `connector.search`        | `GET  {base}/experience/search`     | `?query=<q>`          |
 * | `connector.metadata`      | `GET  {base}/experience/metadata`   | `?ref=<ref>`          |
 * | `connector.resolve`       | `GET  {base}/experience/resolve`    | `?ref=<ref>`          |
 * | `connector.executeAction` | `POST {base}/experience/actions`    | `UserAction` JSON     |
 * | `connector.readLibrary`   | `GET  {base}/experience/library`    | —                     |
 * | `connector.writeLibrary`  | `POST {base}/experience/library`    | `LibraryCommand` JSON |
 * | `events.emit`             | `POST {base}/experience/events`     | `EntertainmentEvent` JSON |
 *
 * The `ConnectorContext` / `ExperienceContext` ride as request headers
 * (`x-wfx-user-id`, `x-wfx-session-id`, `x-wfx-locale`, `x-wfx-region`) —
 * identity travels as headers, never in URLs.
 *
 * Failure semantics — the WFX-003 SDK degrade law, mirrored honestly:
 *
 * - Read-shaped connector calls degrade to their empty answers on any
 *   transport failure (network error, non-2xx, malformed JSON, malformed
 *   payload): `search` → `[]`, `metadata` → `null`, `resolve` → `[]`,
 *   `readLibrary` → `[]`. The frozen plain surface has no error channel
 *   for reads; diagnostics live here at the port.
 * - Action-shaped calls answer a `status: "failed"` `ActionReceipt` whose
 *   `detail` names the transport failure — a failed action is never a
 *   fabricated success and never a thrown crash.
 * - The EVENT SINK is the exception: a lost watch-state event must never
 *   be a silent success (the `EventSink` port contract), so transport
 *   failure there THROWS the typed `HostTransportError` and propagates to
 *   the use-case caller.
 *
 * Production seams (deliberate, documented, injectable):
 *
 * - `SystemClock` wraps `Date.now()` — this is precisely the seam the
 *   `Clock` port exists for: the domain stays deterministic, the host
 *   supplies real time. No other module in this app reads the wall clock.
 * - `CryptoUlidGen` mints canonical 26-char Crockford Base32 ULID bodies
 *   from `crypto.getRandomValues` — the identity seam. No `Math.random()`
 *   anywhere.
 *
 * Both are options: tests inject a fixed clock / sequential ids / a stub
 * `fetch` and run fully offline and deterministically.
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  EntertainmentEvent,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
} from "@wfx/domain";
import { isIso8601, isRecord, validatePlaybackRealization } from "@wfx/domain";
import type { Clock, ConnectorPort, EventSink, IdGen, Ports } from "@wfx/experience";
import { isUsableReceipt } from "@wfx/experience";

import { WEB_HOST_VERSION } from "./version";

// ---------------------------------------------------------------------------
// Typed transport error (the event-sink failure channel)
// ---------------------------------------------------------------------------

/**
 * Typed error thrown by the remote event sink when the Experience API
 * rejects or cannot accept an event. Propagates to the use-case caller —
 * a lost watch-state event is never a silent success.
 */
export class HostTransportError extends Error {
  readonly kind = "host-transport" as const;
  readonly operation: string;

  constructor(operation: string, detail: string) {
    super(`webflix web host transport failure (${operation}): ${detail}`);
    this.name = "HostTransportError";
    this.operation = operation;
  }
}

// ---------------------------------------------------------------------------
// Production seams: the real clock and the real id source
// ---------------------------------------------------------------------------

/**
 * The production `Clock`: the real wall clock. This is the ONE place in
 * the web app that reads `Date.now()` — the entire reason the `Clock`
 * port exists (the domain and the runtime stay deterministic and
 * time-injected).
 */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** The Crockford Base32 alphabet (excludes I, L, O, U) — 32 symbols. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Canonical ULID body shape (mirrors @wfx/domain `ids.ts`). */
const ULID_BODY_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * The production `IdGen`: cryptographically random 26-char Crockford
 * Base32 ULID bodies. The first character is drawn from `[0-7]` (the
 * canonical ULID leading-bit constraint) and the remaining 25 from the
 * full alphabet; 32 divides 256 exactly, so `byte % 32` is uniform.
 * Uniqueness is the job of an id source — this is that seam.
 */
export class CryptoUlidGen implements IdGen {
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

/** Is this a canonical 26-char ULID body? */
export function isUlidBody(value: string): boolean {
  return ULID_BODY_RE.test(value);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link createRemotePorts}. */
export interface RemotePortsOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /**
   * The fetch implementation (default: the global `fetch`). Tests inject a
   * stub; production uses the platform fetch.
   */
  readonly fetchImpl?: typeof fetch;
  /** The clock (default: the real system clock). */
  readonly clock?: Clock;
  /** The id source (default: the crypto ULID generator). */
  readonly ids?: IdGen;
  /**
   * Per-request timeout in milliseconds (default 10 000; `0` disables the
   * timeout). Bound so a hung service cannot pin a serverless handler.
   */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// The remote connector descriptor
// ---------------------------------------------------------------------------

/**
 * The connector id this host presents for the remote service binding.
 * Stable and honest: it names the SERVICE, not any concrete provider.
 */
export const REMOTE_CONNECTOR_ID = "wfx-experience-service";

/**
 * Capabilities the WFX_API_BASE transport implements. These are the
 * operations with a mapped HTTP endpoint (see the module doc table) — the
 * transport's supported surface, not a claim about any provider. The
 * service behind `WFX_API_BASE` is the source of truth for what its
 * answers contain; this descriptor is the documented provisional contract
 * until the service lane ships its own capability negotiation.
 */
const REMOTE_CAPABILITIES: readonly Capability[] = [
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
];

// ---------------------------------------------------------------------------
// Payload guards (a malformed service answer never becomes domain data)
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

/** Transport guard for one `SearchResult` (mirror of the feed use-case's check). */
function isUsableRemoteSearchResult(value: unknown): value is SearchResult {
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
function isUsableRemoteSourceItem(value: unknown): value is SourceItem {
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
function isUsableRemoteLibraryEntry(value: unknown): value is LibraryEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (value.addedAt !== undefined && (typeof value.addedAt !== "string" || !isIso8601(value.addedAt))) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The remote ports bundle
// ---------------------------------------------------------------------------

/** Build the context headers (identity rides as headers, never in URLs). */
function contextHeaders(ctx: ConnectorContext): Record<string, string> {
  const headers: Record<string, string> = {
    "x-wfx-user-id": ctx.userId,
    "x-wfx-locale": ctx.locale,
  };
  if (ctx.region !== undefined) headers["x-wfx-region"] = ctx.region;
  const withSession = ctx as ConnectorContext & { sessionId?: unknown };
  if (typeof withSession.sessionId === "string" && withSession.sessionId.length > 0) {
    headers["x-wfx-session-id"] = withSession.sessionId;
  }
  return headers;
}

type RequestOutcome = { ok: true; value: unknown } | { ok: false; detail: string };

/**
 * Build the production `Ports` bundle against `WFX_API_BASE`.
 *
 * @throws nothing at construction time — failures surface per-call through
 * the typed degrade law described in the module doc (reads degrade,
 * actions answer failed receipts, events throw `HostTransportError`).
 */
export function createRemotePorts(options: RemotePortsOptions): Ports {
  const base = options.apiBase;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new CryptoUlidGen();
  const timeoutMs = options.timeoutMs ?? 10_000;

  function endpoint(path: string, query?: URLSearchParams): string {
    const url = new URL(`${base.pathname === "/" ? "" : base.pathname}${path}`, base);
    if (query !== undefined) {
      for (const [key, value] of query.entries()) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async function request(
    headers: Record<string, string>,
    method: "GET" | "POST",
    url: string,
    body?: string,
  ): Promise<RequestOutcome> {
    const requestHeaders: Record<string, string> = {
      accept: "application/json",
      ...headers,
    };
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
      return { ok: false, detail: `${method} ${url} did not complete (${name}: ${message})` };
    }
    if (!response.ok) {
      return { ok: false, detail: `${method} ${url} answered HTTP ${response.status}` };
    }
    try {
      return { ok: true, value: await response.json() };
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return { ok: false, detail: `${method} ${url} answered a non-JSON body (${message})` };
    }
  }

  /** Stamp a receipt from the injected clock (never a hidden wall clock). */
  function transportOccurredAt(): string {
    return new Date(clock.now()).toISOString();
  }

  const connector: ConnectorPort = {
    descriptor() {
      return {
        id: REMOTE_CONNECTOR_ID,
        version: WEB_HOST_VERSION,
        displayName: `WebFlix Experience Service (${base.origin})`,
        capabilities: [...REMOTE_CAPABILITIES],
        auth: "none",
      };
    },

    async search(ctx: ConnectorContext, query: string): Promise<SearchResult[]> {
      const result = await request(
        contextHeaders(ctx),
        "GET",
        endpoint("/experience/search", new URLSearchParams({ query })),
      );
      if (!result.ok) return []; // degrade law: search failure ⇒ no hits
      if (!Array.isArray(result.value)) return [];
      return result.value.filter((hit): hit is SearchResult => isUsableRemoteSearchResult(hit));
    },

    async metadata(ctx: ConnectorContext, ref: string): Promise<SourceItem | null> {
      const result = await request(
        contextHeaders(ctx),
        "GET",
        endpoint("/experience/metadata", new URLSearchParams({ ref })),
      );
      if (!result.ok) return null; // degrade law: metadata failure ⇒ no metadata
      if (result.value === null) return null;
      if (!isUsableRemoteSourceItem(result.value)) return null;
      return result.value;
    },

    async resolve(ctx: ConnectorContext, ref: string): Promise<PlaybackRealization[]> {
      const result = await request(
        contextHeaders(ctx),
        "GET",
        endpoint("/experience/resolve", new URLSearchParams({ ref })),
      );
      if (!result.ok) return []; // degrade law: resolve failure ⇒ no candidates
      if (!Array.isArray(result.value)) return [];
      return result.value.filter(
        (candidate): candidate is PlaybackRealization => validatePlaybackRealization(candidate).ok,
      );
    },

    async executeAction(ctx: ConnectorContext, action: unknown): Promise<ActionReceipt> {
      const result = await request(
        contextHeaders(ctx),
        "POST",
        endpoint("/experience/actions"),
        JSON.stringify(action),
      );
      if (!result.ok) {
        return { status: "failed", detail: result.detail, occurredAt: transportOccurredAt() };
      }
      if (isUsableReceipt(result.value)) return result.value;
      return {
        status: "failed",
        detail: "POST /experience/actions answered a malformed ActionReceipt",
        occurredAt: transportOccurredAt(),
      };
    },

    async readLibrary(ctx: ConnectorContext): Promise<LibraryEntry[]> {
      const result = await request(contextHeaders(ctx), "GET", endpoint("/experience/library"));
      if (!result.ok) return []; // degrade law: library read failure ⇒ empty
      if (!Array.isArray(result.value)) return [];
      return result.value.filter((entry): entry is LibraryEntry => isUsableRemoteLibraryEntry(entry));
    },

    async writeLibrary(ctx: ConnectorContext, command: unknown): Promise<ActionReceipt> {
      const result = await request(
        contextHeaders(ctx),
        "POST",
        endpoint("/experience/library"),
        JSON.stringify(command),
      );
      if (!result.ok) {
        return { status: "failed", detail: result.detail, occurredAt: transportOccurredAt() };
      }
      if (isUsableReceipt(result.value)) return result.value;
      return {
        status: "failed",
        detail: "POST /experience/library answered a malformed ActionReceipt",
        occurredAt: transportOccurredAt(),
      };
    },
  };

  const events: EventSink = {
    async emit(event: EntertainmentEvent): Promise<void> {
      // The EventSink contract: a lost watch-state event is NEVER a silent
      // success — the typed failure propagates to the caller. The event
      // itself carries the identity headers (userId + sessionId).
      const result = await request(
        { "x-wfx-user-id": event.userId, "x-wfx-session-id": event.sessionId },
        "POST",
        endpoint("/experience/events"),
        JSON.stringify(event),
      );
      if (!result.ok) {
        throw new HostTransportError("events.emit", result.detail);
      }
    },
  };

  return { connector, events, clock, ids };
}
