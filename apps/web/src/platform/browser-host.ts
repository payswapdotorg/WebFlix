/**
 * @wfx/app-web — the Web BrowserHostPort (R07): the contained surface.
 *
 * The Web adapter's realization of the contained browser surface: a
 * SANDBOXED IFRAME the adapter mounts, cookie/storage-isolated from the
 * WebFlix origin and from every other surface session, in which
 * PROVIDER-OWNED pages play. This is the `browser` rung of the frozen
 * Media Surface precedence (Native > Embed > Browser > External) as it
 * truthfully exists on the web platform.
 *
 * SECURITY BOUNDARY (frozen architecture law, verbatim in force):
 *
 * - The surface is a UX surface, NEVER a circumvention mechanism. Provider
 *   DRM, access controls, CAPTCHAs, anti-bot controls, rate limits, and
 *   geographic restrictions are never circumvented, intercepted, or
 *   modified.
 * - Provider pages stay PROVIDER-OWNED: no script injection into the
 *   iframe, no credential capture, no content inspection. Cross-origin
 *   iframes are opaque to the host BY BROWSER DESIGN — and this adapter
 *   keeps it that way deliberately.
 * - COOKIE/STORAGE ISOLATION (`restrictCookies: "isolate"` — the only
 *   legal value): the iframe is created with the `sandbox` attribute
 *   WITHOUT `allow-same-origin`, so it runs in an OPAQUE ORIGIN — its
 *   cookies and storage are isolated from the WebFlix origin AND from
 *   every other sandboxed session. Each `open()` mints a fresh iframe;
 *   sessions never share browsing state.
 * - Navigation is OBSERVED, never steered: the host reports the
 *   navigations IT commands (`navigate()`) and the close; in-surface user
 *   navigation (clicks inside the provider page) is INVISIBLE to the host
 *   by browser origin isolation — the honest, provider-owned boundary.
 *   Nothing is intercepted.
 *
 * TWO MOUNTS, ONE CONTRACT (environment-driven, honest):
 *
 * - DOM MOUNT (a browser context): `open()` creates a real sandboxed
 *   iframe appended to the document body; `navigate()` sets its `src`;
 *   `close()` removes it; the iframe's own `load` event is observed and
 *   reported as a `navigated` event (the load of the URL we set).
 * - RENDERED MOUNT (a server render pass — no DOM): `open()` records the
 *   session; the ADAPTER'S RENDER LAYER mounts the iframe for open
 *   sessions in the delivered markup (the player surface asks
 *   `renderedSessions()`), so the contained surface really exists in the
 *   browser once the page arrives. `navigate()` updates the session's URL
 *   record — applied on the next render, an honestly documented limitation
 *   of a server-rendered context; `close()` emits `closed`.
 *
 * The port exists in BOTH contexts because the web PLATFORM truthfully
 * supports a contained surface; a boot context that cannot mount one RIGHT
 * NOW answers the typed `unavailable` failure — never a fake handle.
 */

import {
  BrowserSurfaceError,
  type BrowserHostPort,
  type BrowserSurfaceEvent,
  type BrowserSurfaceRequest,
  type BrowserSurfaceSession,
} from "@wfx/platform-contracts";
import type { Unsubscribe } from "@wfx/platform-contracts";
import type { RuntimeClock } from "@wfx/client-runtime";

import type { HTMLIFrameElementLike, WebEnvironment } from "./environment";
import { WebClock } from "./lifecycle";

/**
 * The sandbox tokens of the contained surface. Deliberately WITHOUT
 * `allow-same-origin` (opaque origin — the cookie/storage isolation) and
 * WITHOUT `allow-storage-access-by-user-activation` (no provider storage
 * grant). `allow-scripts` lets the provider's own player run — it is their
 * page, running isolated.
 */
const SURFACE_SANDBOX_TOKENS: readonly string[] = [
  "allow-scripts",
  "allow-forms",
  "allow-popups",
  "allow-presentation",
];

/** The surface-session id prefix (host-minted, opaque). */
const SURFACE_ID_PREFIX = "wfxsurf-";

// ---------------------------------------------------------------------------
// R09 — the web contained surface's honest CAPABILITY TRUTH (J08)
// ---------------------------------------------------------------------------

/** The mount the contained surface runs on in this boot context. */
export type WebSurfaceMount = "dom" | "rendered";

/**
 * The web contained surface's honest capability truth — what the browser
 * platform PERMITS (J08: "Constrained" where webview APIs are absent).
 * Pure data derived from the environment; never a probe at read time.
 */
export interface WebSurfaceCapabilityTruth {
  /** Which mount `open()` uses in this boot context. */
  readonly mount: WebSurfaceMount;
  /** The cookie/storage isolation discipline (the sandbox law, verbatim). */
  readonly cookieIsolation: "opaque-origin-sandbox";
  /**
   * The honest navigation-observation truth: the host observes ONLY the
   * navigations IT commands (`navigate()` + the load of the URL it set);
   * in-surface user navigation is invisible BY ORIGIN ISOLATION — the
   * provider-owned boundary (never intercepted, never steered).
   */
  readonly navigationObservation: "host-commands-only";
  /**
   * J08's honest "Constrained" answer: `true` when this boot context has
   * no DOM (a server render pass) and the surface is therefore constrained
   * to the rendered mount — sessions are recorded for the render layer,
   * `navigate()` applies on the next render (the documented limitation).
   * `false` in a browser context (the DOM mount: real iframes, live).
   */
  readonly constrained: boolean;
  /** NON-EMPTY honest constraint note (present when `constrained`). */
  readonly constraint: string;
}

/**
 * The web contained surface's capability truth for one environment (pure;
 * J08's constrained-platform answer where the DOM is absent).
 */
export function webSurfaceCapabilityTruth(
  environment: Pick<WebEnvironment, "document">,
): WebSurfaceCapabilityTruth {
  const domMounted = environment.document !== null;
  return {
    mount: domMounted ? "dom" : "rendered",
    cookieIsolation: "opaque-origin-sandbox",
    navigationObservation: "host-commands-only",
    constrained: !domMounted,
    constraint: domMounted
      ? "the DOM mount holds live sandboxed iframes in this context"
      : "this boot context has no DOM (a server render pass) — the contained surface is CONSTRAINED to the rendered mount: sessions are recorded for the render layer and navigation applies on the next render (J08's honest Constrained answer)",
  };
}

/** Options for {@link createWebBrowserHostPort}. */
export interface WebBrowserHostPortOptions {
  /** The environment (default: no DOM — the rendered mount). */
  readonly environment?: WebEnvironment;
  /** The clock stamping observation events (default: the real wall clock). */
  readonly clock?: RuntimeClock;
  /**
   * The policy hook: reject URLs by adapter policy with the typed
   * `blocked` failure. The default policy allows http(s) URLs only (the
   * transport the contained surface is defined over). NEVER a content
   * filter — provider pages are provider-owned.
   */
  readonly urlPolicy?: (url: URL) => string | null;
}

/**
 * The web BrowserHostPort: the frozen port plus the R09 productionization
 * surface — `renderedSessions` (the render layer's view) and `sessions()`
 * (the full open-session enumeration, both mounts) plus the host's own
 * capability truth (`surfaceCapabilityTruth()`).
 */
export interface WebBrowserHostPort extends BrowserHostPort {
  /**
   * The sessions the RENDERED MOUNT is holding open (server-render
   * contexts). The render layer mounts one sandboxed iframe per session.
   * Empty in a DOM-mount context (the DOM mount already holds its own
   * iframes). Read-only copies.
   */
  renderedSessions(): readonly { readonly id: string; readonly url: string; readonly purpose: string }[];
  /**
   * R09: EVERY open surface session of this host, in open order, with its
   * mount — the session-lifecycle enumeration (open/navigate/close
   * round-trips are observable on it). Read-only copies.
   */
  sessions(): readonly {
    readonly id: string;
    readonly url: string;
    readonly purpose: BrowserSurfaceRequest["purpose"];
    readonly mount: WebSurfaceMount;
    readonly closed: false;
  }[];
  /** R09: the honest capability truth of this host's boot context (J08). */
  surfaceCapabilityTruth(): WebSurfaceCapabilityTruth;
}

/** One session's internal record. */
interface SurfaceRecord {
  id: string;
  url: string;
  purpose: BrowserSurfaceRequest["purpose"];
  listeners: Set<(event: BrowserSurfaceEvent) => void>;
  closed: boolean;
  frame: HTMLIFrameElementLike | null;
  /** The recorded-mount sessions map (null for DOM-mounted sessions). */
  rendered: boolean;
}

/** Create the Web contained-browser-surface port. */
export function createWebBrowserHostPort(
  options: WebBrowserHostPortOptions = {},
): WebBrowserHostPort {
  const document = options.environment?.document ?? null;
  const clock = options.clock ?? new WebClock();
  const urlPolicy = options.urlPolicy ?? defaultUrlPolicy;
  const domMounted = document !== null;
  const records = new Map<string, SurfaceRecord>();
  let counter = 0;

  function publish(record: SurfaceRecord, event: BrowserSurfaceEvent): void {
    for (const listener of record.listeners) listener(event);
  }

  function navigateRecord(record: SurfaceRecord, url: string): void {
    record.url = url;
    if (record.frame !== null) record.frame.src = url;
    publish(record, {
      kind: "navigated",
      sessionId: record.id,
      url,
      occurredAtMs: clock.now(),
    });
  }

  async function closeRecord(record: SurfaceRecord): Promise<void> {
    if (record.closed) return; // close is idempotent per the contract
    record.closed = true;
    if (record.frame !== null && document !== null) {
      document.body.removeChild(record.frame);
      record.frame = null;
    }
    records.delete(record.id);
    publish(record, { kind: "closed", sessionId: record.id, occurredAtMs: clock.now() });
    record.listeners.clear(); // events stop at close (the contract)
  }

  function toSession(record: SurfaceRecord): BrowserSurfaceSession {
    return {
      id: record.id,
      url: record.url,
      navigate: async (url: string) => {
        if (record.closed) {
          throw new BrowserSurfaceError(
            "invalid-session",
            `session '${record.id}' is closed — navigation is not possible`,
          );
        }
        const problem = validateOpenableUrl(url, urlPolicy);
        if (problem !== null) throw problem;
        navigateRecord(record, url);
      },
      close: () => closeRecord(record),
      subscribe(listener: (event: BrowserSurfaceEvent) => void): Unsubscribe {
        if (record.closed) return () => undefined; // closed sessions emit nothing
        record.listeners.add(listener);
        return () => {
          record.listeners.delete(listener);
        };
      },
    };
  }

  return {
    renderedSessions: () =>
      [...records.values()]
        .filter((record) => record.rendered)
        .map((record) => ({ id: record.id, url: record.url, purpose: record.purpose })),

    sessions: () =>
      [...records.values()].map((record) => ({
        id: record.id,
        url: record.url,
        purpose: record.purpose,
        mount: (record.rendered ? "rendered" : "dom") as WebSurfaceMount,
        closed: false as const,
      })),

    surfaceCapabilityTruth: () => webSurfaceCapabilityTruth({ document }),

    async open(request: BrowserSurfaceRequest): Promise<BrowserSurfaceSession> {
      // The cookie-isolation contract is not optional — a caller that does
      // not ask for isolation cannot open a surface at all.
      if (request.restrictCookies !== "isolate") {
        throw new BrowserSurfaceError(
          "invalid-session",
          'restrictCookies must be "isolate" (the cookie-isolation contract is not optional)',
        );
      }
      const problem = validateOpenableUrl(request.url, urlPolicy);
      if (problem !== null) throw problem;
      counter += 1;
      const record: SurfaceRecord = {
        id: `${SURFACE_ID_PREFIX}${counter}`,
        url: request.url,
        purpose: request.purpose,
        listeners: new Set(),
        closed: false,
        frame: null,
        rendered: !domMounted,
      };
      records.set(record.id, record);

      if (domMounted && document !== null) {
        try {
          const frame = document.createElement("iframe");
          frame.src = request.url;
          frame.title = `WebFlix contained surface: ${request.purpose}`;
          frame.referrerPolicy = "strict-origin-when-cross-origin";
          frame.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
          if (frame.sandbox !== null) {
            frame.sandbox.add(...SURFACE_SANDBOX_TOKENS);
          }
          // The load of the URL WE SET is observable (it is our command's
          // effect); in-surface navigation stays provider-owned and opaque.
          frame.addEventListener("load", () => {
            if (!record.closed) {
              publish(record, {
                kind: "navigated",
                sessionId: record.id,
                url: record.url,
                occurredAtMs: clock.now(),
              });
            }
          });
          document.body.appendChild(frame);
          record.frame = frame;
        } catch (thrown) {
          records.delete(record.id);
          throw new BrowserSurfaceError(
            "unavailable",
            `the contained surface could not mount in this context: ${
              thrown instanceof Error ? thrown.message : String(thrown)
            }`,
          );
        }
      }
      // The rendered mount records the session; the render layer mounts the
      // iframe in the delivered markup (see the module doc).
      return toSession(record);
    },
  };
}

/**
 * The default URL policy: permissive for http(s) — the scheme law is
 * BUILT INTO `validateOpenableUrl` (non-http(s) is `invalid-url` before
 * any policy runs). Hosts may inject a stricter policy (typed `blocked`
 * with the reason) — NEVER a content filter; provider pages are
 * provider-owned.
 */
function defaultUrlPolicy(_url: URL): string | null {
  void _url;
  return null;
}

/**
 * Validate + policy-check one openable URL (typed failures, never a throw).
 *
 * The scheme law is BUILT IN (not a policy): the contained surface is
 * defined over http(s) provider pages — any other scheme (`javascript:`,
 * `data:`, `file:`) answers the typed `invalid-url`, never an open. The
 * policy hook then applies to http(s) URLs only and answers `blocked`
 * with the host's reason (a policy refusal, never a content judgment).
 */
function validateOpenableUrl(
  raw: string,
  urlPolicy: (url: URL) => string | null,
): BrowserSurfaceError | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return new BrowserSurfaceError("invalid-url", "the URL is empty");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new BrowserSurfaceError("invalid-url", `'${raw}' is not a parsable absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return new BrowserSurfaceError(
      "invalid-url",
      `the contained surface opens http(s) provider pages only (got '${url.protocol}')`,
    );
  }
  const blockedReason = urlPolicy(url);
  if (blockedReason !== null) {
    return new BrowserSurfaceError("blocked", blockedReason);
  }
  return null;
}
