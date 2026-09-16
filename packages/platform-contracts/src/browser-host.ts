/**
 * @wfx/platform-contracts — BrowserHostPort (R01).
 *
 * The contained browser surface capability of a platform adapter: the Web
 * adapter may offer a contained iframe/tab surface where technically
 * permitted, the Desktop adapter a native WebView surface, the Mobile
 * adapter a WKWebView/WebView surface. Declared truthfully as
 * `browserHost: "none" | "contained"` on the capability bundle — an adapter
 * that cannot contain a browser surface simply does not provide this port.
 *
 * SECURITY BOUNDARY (frozen remediation architecture, "Media Surface"):
 *
 * - The browser surface is a UX surface, NEVER a circumvention mechanism.
 * - Provider pages stay PROVIDER-OWNED: their markup, scripts, DRM, access
 *   controls, CAPTCHAs, anti-bot controls, rate limits, and geographic
 *   restrictions are never circumvented, intercepted, or modified by
 *   WebFlix.
 * - Cookie/storage isolation is MANDATORY: every `open()` carries
 *   `restrictCookies: "isolate"` and the host MUST keep the surface's
 *   cookies/storage isolated from the WebFlix origin and from every other
 *   surface session (mirrors the WFX-026 isolation contract of
 *   `@wfx/experience`'s BrowserHost — one law, two seams: that port is the
 *   experience-side controller seam, THIS port is the platform capability).
 * - Navigation is OBSERVED, never blocked and never steered: the host
 *   reports where the user went; provider handoffs are honest observations.
 * - This port deliberately has NO script injection for circumvention, NO
 *   credential capture, NO content inspection of provider pages. An adapter
 *   offering any such mechanism violates this contract and cannot satisfy
 *   the port.
 */

import type { Unsubscribe } from "./common";

/**
 * The cookie/storage isolation mode. The single legal value: hosts MUST
 * isolate provider cookies/storage for the surface session.
 */
export type CookieIsolationMode = "isolate";

/** Why the contained surface is being opened (surfaced to the user honestly). */
export type BrowserSurfacePurpose =
  /** Provider web playback through the contained surface. */
  | "playback"
  /** A connector authorization flow (never a credential capture). */
  | "authorization"
  /** Any other provider-owned destination. */
  | "general";

/** Options every `BrowserHostPort.open()` receives. */
export interface BrowserSurfaceRequest {
  /** The provider-owned URL to open. */
  readonly url: string;
  /** Cookie/storage isolation the host MUST enforce (always `"isolate"`). */
  readonly restrictCookies: CookieIsolationMode;
  /** Why the surface is opened (surfaced honestly in UX). */
  readonly purpose: BrowserSurfacePurpose;
}

/** The closed browser-surface failure vocabulary. */
export type BrowserSurfaceErrorCode =
  /** The host cannot open another surface right now (retryable). */
  | "unavailable"
  /** The URL is not openable in the contained surface (e.g. not http(s)). */
  | "invalid-url"
  /** The host's own policy refused the URL (typed, never silent). */
  | "blocked"
  /** The surface session is unknown or already closed. */
  | "invalid-session";

/** Every value of `BrowserSurfaceErrorCode`, in union order. */
export const BROWSER_SURFACE_ERROR_CODES: readonly BrowserSurfaceErrorCode[] = [
  "unavailable",
  "invalid-url",
  "blocked",
  "invalid-session",
];

/**
 * The typed failure `open`/`navigate` reject with. A host that blocks a URL
 * by policy fails with `"blocked"` and the reason — the runtime surfaces
 * that honestly; it never pretends the surface opened.
 */
export class BrowserSurfaceError extends Error {
  readonly code: BrowserSurfaceErrorCode;
  readonly detail: string;

  constructor(code: BrowserSurfaceErrorCode, detail: string) {
    super(`browser surface failure (${code}): ${detail}`);
    this.name = "BrowserSurfaceError";
    this.code = code;
    this.detail = detail;
  }
}

/** One observed navigation inside an open surface session. */
export interface BrowserSurfaceEvent {
  readonly kind:
    /** The surface navigated (provider-owned flow, observed not steered). */
    | "navigated"
    /** The surface closed (user or host). Terminal for the session. */
    | "closed"
    /** The host refused a navigation by policy (typed, honest). */
    | "blocked";
  /** The session the event belongs to. */
  readonly sessionId: string;
  /** The URL involved (navigated-to / blocked target). */
  readonly url?: string;
  /** Epoch milliseconds (adapter clock). */
  readonly occurredAtMs: number;
  /** Honest reason text (always present for `"blocked"`). */
  readonly reason?: string;
}

/** A handle to ONE open contained browser surface session. */
export interface BrowserSurfaceSession {
  /** Opaque session identity (host-minted). */
  readonly id: string;
  /** The URL the surface was opened at. */
  readonly url: string;
  /** Navigate the surface to a provider-owned URL. Observed, never steered. */
  navigate(url: string): Promise<void>;
  /** Close the surface exactly once; stops its events. */
  close(): Promise<void>;
  /** Observe this session's events until close. */
  subscribe(listener: (event: BrowserSurfaceEvent) => void): Unsubscribe;
}

/**
 * The contained browser surface port. INTERFACE ONLY in this package — real
 * surfaces are adapter implementations (R07 web, R08/R09 desktop); the
 * runtime consumes this port for `browser`-mode playback preparation.
 */
export interface BrowserHostPort {
  /**
   * Open a new isolated contained surface. Rejects with the typed
   * `BrowserSurfaceError` — never a fake handle, never a silent failure.
   */
  open(request: BrowserSurfaceRequest): Promise<BrowserSurfaceSession>;
}
