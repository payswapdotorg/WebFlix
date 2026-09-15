/**
 * @wfx/connectors — the YouTube connector's HTTP transport seam (WFX-054).
 *
 * Every network byte the connector moves flows through `YouTubeHttpTransport`
 * — an injectable, deterministic-testable seam in the repo's established
 * style (same law as @wfx/actions' SyncDriver and @wfx/experience's Ports):
 *
 * - PRODUCTION: `createFetchYouTubeTransport()` wraps the global `fetch`
 *   with a BOUNDED timeout (AbortController, default 10s — the same budget
 *   the WFX-050 remote-ports transport uses). A timeout or network refusal
 *   is thrown and classified by ./errors.ts (`unavailable`, retryable).
 * - TESTS: `createScriptedYouTubeTransport()` (in ./fixtures.ts) replays
 *   recorded fixture replies in exact FIFO order and records every request
 *   for assertion — no network, full determinism.
 *
 * The seam carries the minimum the API layer needs: method, URL, optional
 * headers, optional body. Response = status + body text. JSON parsing and
 * shape validation live in ./api.ts; error classification in ./errors.ts.
 */

/** The request shape the YouTube API layer issues. */
export interface YouTubeHttpRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** The response shape every transport must return. */
export interface YouTubeHttpReply {
  readonly status: number;
  readonly bodyText: string;
}

/**
 * The HTTP seam. Implementations return a completed HTTP exchange or THROW
 * on transport-level failure (network refused, timeout, abort) — the API
 * layer catches and classifies those (`classifyYouTubeTransportFailure`).
 */
export interface YouTubeHttpTransport {
  request(request: YouTubeHttpRequest): Promise<YouTubeHttpReply>;
}

/** Default request timeout: 10 seconds (bounded, never hanging). */
export const YOUTUBE_HTTP_TIMEOUT_MS = 10_000;

export interface FetchYouTubeTransportOptions {
  /** Request timeout in milliseconds; default 10_000. */
  readonly timeoutMs?: number;
  /** The fetch implementation (tests may inject a stub); default global fetch. */
  readonly fetch?: typeof fetch;
}

/**
 * The production transport: global `fetch` + a bounded AbortController
 * timeout. No retries here — retry policy is a CALLER concern (the WFX-053
 * containment rule: no retry storms inside the transport).
 */
export function createFetchYouTubeTransport(
  options: FetchYouTubeTransportOptions = {},
): YouTubeHttpTransport {
  const timeoutMs = options.timeoutMs ?? YOUTUBE_HTTP_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  return {
    async request(request: YouTubeHttpRequest): Promise<YouTubeHttpReply> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // exactOptionalPropertyTypes: never materialize undefined headers/body.
        const init: RequestInit = {
          method: request.method,
          signal: controller.signal,
          redirect: "manual",
          ...(request.headers !== undefined ? { headers: request.headers } : {}),
          ...(request.body !== undefined ? { body: request.body } : {}),
        };
        const response = await doFetch(request.url, init);
        const bodyText = await response.text();
        return { status: response.status, bodyText };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
