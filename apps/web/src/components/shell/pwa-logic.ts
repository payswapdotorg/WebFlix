/**
 * @wfx/app-web — installable-surface logic (WFX-057), pure + testable.
 *
 * Everything the PWA islands decide lives here as plain functions over
 * injected seams (`matchMedia`, storage, event targets, the environment) —
 * the client islands (`InstallPrompt.tsx`, `UpdatePrompt.tsx`) only bind
 * these decisions to the real browser. Tests drive the same functions with
 * fakes (tests/install-surface.test.ts) — no jsdom.
 *
 * The honesty laws:
 * - NO fake install prompts: the offer renders only when the browser fired
 *   a REAL `beforeinstallprompt` (Chrome/Edge desktop + Android). Safari
 *   iOS never fires it — there the island renders the honest
 *   "Add to Home Screen" instruction sheet instead.
 * - Dismissals are remembered (`localStorage`), and remembered HONESTLY:
 *   storage failures (private mode) fail open — the affordance still shows.
 * - The service worker registers ONLY in production builds booted in
 *   service mode (see `shouldRegisterServiceWorker`).
 */

/** The localStorage key remembering an explicit "Not now". */
export const INSTALL_DISMISSAL_KEY = "wfx.install.dismissed";

/** The minimal storage seam (a real `Storage`, or a Map-backed fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Has the user previously dismissed the install offer? (memory = truth) */
export function readInstallDismissed(storage: StorageLike): boolean {
  try {
    return storage.getItem(INSTALL_DISMISSAL_KEY) === "1";
  } catch {
    // Storage unavailable (privacy mode / disabled): fail OPEN — the
    // affordance still shows; a hidden storage error must not silently
    // kill the install surface.
    return false;
  }
}

/** Remember an explicit dismissal. Best-effort; a storage failure is swallowed (session-only memory then). */
export function writeInstallDismissed(storage: StorageLike): void {
  try {
    storage.setItem(INSTALL_DISMISSAL_KEY, "1");
  } catch {
    // Unavailable storage: the dismissal is remembered only in this
    // session's component state — the next visit may offer again. Honest.
  }
}

/** The minimal matchMedia seam. */
export interface MatchMediaLike {
  matches(query: string): boolean;
}

/**
 * Is the app running as an installed app (standalone display mode)?
 *
 * Checks the standard `display-mode` media queries, plus iOS Safari's
 * proprietary `navigator.standalone` (older iOS does not implement the
 * media query). Injected seams keep this deterministic in tests.
 */
export function isStandaloneDisplay(
  matchMedia: MatchMediaLike,
  navigatorStandalone: boolean | undefined,
): boolean {
  if (navigatorStandalone === true) return true;
  return (
    matchMedia.matches("(display-mode: standalone)") ||
    matchMedia.matches("(display-mode: fullscreen)") ||
    matchMedia.matches("(display-mode: minimal-ui)")
  );
}

/**
 * Best-effort iOS detection from UA hints (the packet's "UA hints" law).
 *
 * iPadOS 13+ masquerades as desktop Safari (`Macintosh`) while reporting
 * touch points — the touch heuristic is the documented best-effort signal.
 * False positives are harmless here (an instruction sheet on a touch Mac),
 * and the sheet is honest on any device without `beforeinstallprompt`.
 */
export function detectIOSUserAgent(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** What the install island renders. */
export type InstallPhase =
  /** Nothing — no honest offer exists right now. */
  | "idle"
  /** A REAL deferred `beforeinstallprompt` is stashed — offer the install. */
  | "offer"
  /** iOS Safari, not installed — the honest Add-to-Home-Screen instruction sheet. */
  | "instructions"
  /** `appinstalled` fired — confirm, then hide. */
  | "installed";

/** Everything the phase decision consumes (all injectable/deterministic). */
export interface InstallContext {
  /** Running as an installed app already (display-mode / navigator.standalone). */
  readonly standalone: boolean;
  /** Best-effort iOS detection (UA hints). */
  readonly isIOS: boolean;
  /** A real deferred `beforeinstallprompt` is currently stashed. */
  readonly promptAvailable: boolean;
  /** The user dismissed the offer (remembered, or this session). */
  readonly dismissed: boolean;
  /** `appinstalled` fired on this page. */
  readonly installed: boolean;
}

/**
 * The install-surface decision — one pure function, the island's whole
 * visibility law. NO fake prompts: any situation without a REAL signal
 * renders nothing.
 */
export function installSurfaceFor(context: InstallContext): InstallPhase {
  if (context.installed) return "installed";
  if (context.standalone) return "idle";
  if (context.dismissed) return "idle";
  if (context.promptAvailable) return "offer";
  if (context.isIOS) return "instructions";
  return "idle";
}

/**
 * Attach the install event listeners to an event target (the real `window`
 * in production; any `EventTarget` in tests — dispatched events drive the
 * same handlers). Returns the detach function.
 */
export function attachInstallListeners(
  target: EventTarget,
  handlers: {
    onBeforeInstallPrompt(event: Event): void;
    onAppInstalled(event: Event): void;
  },
): () => void {
  const onBeforeInstallPrompt = (event: Event): void => handlers.onBeforeInstallPrompt(event);
  const onAppInstalled = (event: Event): void => handlers.onAppInstalled(event);
  target.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  target.addEventListener("appinstalled", onAppInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    target.removeEventListener("appinstalled", onAppInstalled);
  };
}

/**
 * The service-worker registration law (WFX-057 §2):
 *
 * register ONLY when BOTH hold —
 * 1. `nodeEnv === "production"`: the client bundle was built for
 *    production (`process.env.NODE_ENV` is inlined at build time by Next —
 *    `next dev` never registers), AND
 * 2. `enabled`: the host booted in SERVICE mode (the `AppShell` `mode`
 *    prop — `WFX_DEV_FIXTURES` fixtures mode is dev-only content by the
 *    050 boot law and never a PWA surface; this flag is how the app knows
 *    its mode on the client).
 *
 * (`serviceWorkerSupported` is the `navigator.serviceWorker` capability
 * check — unsupported browsers skip registration with no error.)
 */
export function shouldRegisterServiceWorker(input: {
  readonly enabled: boolean;
  readonly serviceWorkerSupported: boolean;
  readonly nodeEnv: string | undefined;
}): boolean {
  return input.enabled && input.serviceWorkerSupported && input.nodeEnv === "production";
}
