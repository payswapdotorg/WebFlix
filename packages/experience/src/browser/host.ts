/**
 * @wfx/experience — in-app browser surface HOST PORT (WFX-026, Lane C).
 *
 * The platform seam of the contained browser session model: the typed
 * contract a PLATFORM ADAPTER (Tauri WebView / Android WebView / iOS
 * WKWebView) implements to give the WebFlix shell a real web surface. This
 * module ships the PORT and a deterministic TEST FIXTURE only — NO real
 * browser engine control lives here (frozen architecture, "Platform
 * Adapters"; dispatch packet: "NO actual browser engine control — injected
 * as a typed BrowserHost port").
 *
 * Browser mode is a UX surface, not a mechanism for defeating provider
 * security (docs/architecture/webflix-frozen-architecture.md). The host port
 * therefore exposes ONLY surface-lifecycle operations — open, close,
 * navigation observation, and (optionally) script evaluation. It has no
 * ad-block injection, no DRM tooling, no credential capture: hosts that
 * offered any such mechanism would violate the provider security boundary
 * (docs/architecture/product-boundaries.md) and cannot satisfy this port.
 *
 * Cookie/storage isolation CONTRACT (the typed deliverable of this item):
 * every `open()` receives `BrowserOpenOptions.restrictCookies: "isolate"`
 * and the host MUST honor it — providers' cookies and storage MUST be kept
 * isolated from both the WebFlix web client's origin and other providers'
 * sessions (fresh isolated storage per browser surface session). The
 * isolation POLICY in `isolation.ts` asserts this; the HOST enforces it.
 *
 * Error-channel law (ports.ts): invalid CALLER INPUT and port-contract
 * violations (opening a dead handle, double close, a navigation script that
 * targets an unknown session) throw the typed `ExperienceError`. The
 * fixture additionally REJECTS any `open()` whose options do not carry
 * `restrictCookies: "isolate"` — the cookie-isolation contract is never
 * optional.
 */

import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// The host port — the platform seam
// ---------------------------------------------------------------------------

/**
 * The cookie/storage isolation mode. The single legal value: hosts MUST
 * isolate provider cookies/storage for the browser surface session.
 */
export type CookieIsolationMode = "isolate";

/**
 * Options every `BrowserHost.open()` receives. The typed cookie-isolation
 * contract: `restrictCookies` is always `"isolate"` and hosts MUST honor it
 * (see module doc). Platform adapters that cannot isolate cookies cannot
 * implement this port.
 */
export interface BrowserOpenOptions {
  /** Cookie/storage isolation the host MUST enforce for this session. */
  readonly restrictCookies: CookieIsolationMode;
}

/**
 * A handle to ONE open host-side browser session. Opaque identity + the
 * URL the host opened; all further host operations address the session
 * through this handle.
 */
export interface BrowserSessionHandle {
  readonly id: string;
  readonly url: string;
}

/**
 * A navigation the host observed inside a session. Delivered through the
 * `onNavigation` callback with the session's new URL — the host's honest
 * report of where the user navigated, consumed by the session FSM
 * (`session.ts`). The host reports; it never asks permission — provider
 * handoffs are OBSERVED, never blocked (provider security boundary).
 */
export interface BrowserNavigation {
  /** The URL the session now shows. */
  readonly url: string;
}

/**
 * The platform seam of the in-app browser surface. Implemented by real
 * platform adapters (Tauri WebView / Android WebView / iOS WKWebView) at the
 * app layer; implemented by `FixtureBrowserHost` in tests.
 *
 * Contract:
 * - `open(url, options)` — open a NEW host session at `url` under the
 *   cookie-isolation contract. Returns the handle. A host that cannot open
 *   may throw — the controller (`component.ts`) converts that into the typed
 *   `host-open-failed` result and returns its session to the closed state.
 * - `close(handle)` — close the session. Exactly once per open handle;
 *   after close the host MUST NOT deliver further navigation events for it.
 *   (The fixture enforces this: scripts targeting a closed handle throw.)
 * - `onNavigation(handle, cb)` — observe navigations. Multiple listeners
 *   per handle are legal (invoked in registration order). Listeners are
 *   only invoked while the handle is open.
 * - `evaluate` — OPTIONAL script evaluation. Absent means the host cannot
 *   evaluate scripts (capability truth: the controller returns a typed
 *   `unsupported` result — never a fake success).
 */
export interface BrowserHost {
  /** Open a new isolated host session at `url`. */
  open(url: string, options: BrowserOpenOptions): BrowserSessionHandle;
  /** Close an open session exactly once; stops its navigation events. */
  close(handle: BrowserSessionHandle): void;
  /** Observe completed navigations of an open session. */
  onNavigation(handle: BrowserSessionHandle, cb: (navigation: BrowserNavigation) => void): void;
  /** OPTIONAL script evaluation; absent = unsupported (typed at the controller). */
  evaluate?(handle: BrowserSessionHandle, script: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// FixtureBrowserHost — deterministic scripted navigations for tests
// ---------------------------------------------------------------------------

/**
 * One scripted navigation of the fixture host: when the test pumps the
 * script (`deliverNextNavigation`), the next undelivered entry — in strict
 * script order — is delivered to its target handle's registered navigation
 * listeners.
 */
export interface ScriptedNavigation {
  /** The open handle the navigation belongs to. */
  readonly handleId: string;
  /** The URL the host navigates that handle to. */
  readonly url: string;
}

/** One recorded `open()` call, for contract assertions. */
export interface RecordedBrowserOpen {
  readonly url: string;
  readonly options: BrowserOpenOptions;
}

/**
 * A deterministic `BrowserHost` for tests — NO real webview, NO network, NO
 * timers: navigation events fire ONLY when the test pumps the script.
 *
 * - Handle ids are deterministic: `"fixture-browser-1"`, `"fixture-browser-2"`,
 *   … in open order (tests address script entries through them).
 * - Every `open()` call is recorded (url + options) so tests can assert the
 *   cookie-isolation contract is present in EVERY open options.
 * - `open()` REJECTS options without `restrictCookies: "isolate"` (typed
 *   `ExperienceError`) — the fixture enforces the contract it records.
 * - `evaluate` is deliberately NOT implemented: the fixture cannot run
 *   scripts, and the controller must surface that as a typed `unsupported`
 *   result (capability truth — no fake success paths).
 * - `deliverNextNavigation()` delivers the next scripted entry to its
 *   target's listeners, returns the entry (or `undefined` when the script
 *   is exhausted). A script entry targeting an unknown or closed handle is
 *   a test-authoring bug and throws the typed `ExperienceError`.
 */
export class FixtureBrowserHost implements BrowserHost {
  private readonly script: readonly ScriptedNavigation[];
  private readonly delivered: boolean[];
  private readonly listeners = new Map<string, ((navigation: BrowserNavigation) => void)[]>();
  private readonly openCalls: RecordedBrowserOpen[] = [];
  private readonly closedHandleIds = new Set<string>();
  private readonly openHandleIds = new Set<string>();
  private nextHandleNumber = 1;

  constructor(navigationScript: readonly ScriptedNavigation[] = []) {
    if (!Array.isArray(navigationScript)) {
      throw new ExperienceError(
        "navigationScript: expected an array of ScriptedNavigation entries",
      );
    }
    const problems: string[] = [];
    navigationScript.forEach((entry, index) => {
      if (!isRecord(entry)) {
        problems.push(`navigationScript[${index}]: expected a ScriptedNavigation object`);
        return;
      }
      if (typeof entry.handleId !== "string" || entry.handleId.length === 0) {
        problems.push(
          `navigationScript[${index}].handleId: expected a non-empty string, got ${previewValue(entry.handleId)}`,
        );
      }
      if (typeof entry.url !== "string" || entry.url.length === 0) {
        problems.push(
          `navigationScript[${index}].url: expected a non-empty string, got ${previewValue(entry.url)}`,
        );
      }
    });
    if (problems.length > 0) throw new ExperienceError(problems);
    this.script = navigationScript.map((entry) => ({ ...entry }));
    this.delivered = navigationScript.map(() => false);
  }

  open(url: string, options: BrowserOpenOptions): BrowserSessionHandle {
    if (typeof url !== "string" || url.length === 0) {
      throw new ExperienceError(`open.url: expected a non-empty string, got ${previewValue(url)}`);
    }
    if (!isRecord(options) || options.restrictCookies !== "isolate") {
      throw new ExperienceError(
        `open.options: the cookie-isolation contract is not optional — expected { restrictCookies: "isolate" }, got ${previewValue(options)}`,
      );
    }
    const id = `fixture-browser-${this.nextHandleNumber}`;
    this.nextHandleNumber += 1;
    this.openHandleIds.add(id);
    this.openCalls.push({ url, options: { restrictCookies: options.restrictCookies } });
    return { id, url };
  }

  close(handle: BrowserSessionHandle): void {
    this.assertHandle(handle, "close");
    this.openHandleIds.delete(handle.id);
    this.closedHandleIds.add(handle.id);
    this.listeners.delete(handle.id);
  }

  onNavigation(handle: BrowserSessionHandle, cb: (navigation: BrowserNavigation) => void): void {
    this.assertHandle(handle, "onNavigation");
    if (typeof cb !== "function") {
      throw new ExperienceError(
        `onNavigation.cb: expected a function, got ${previewValue(cb)}`,
      );
    }
    const existing = this.listeners.get(handle.id) ?? [];
    existing.push(cb);
    this.listeners.set(handle.id, existing);
  }

  /**
   * Pump the script: deliver the next undelivered scripted navigation, in
   * script order, to its target handle's listeners. Returns the delivered
   * entry for assertions, or `undefined` when the script is exhausted
   * (a clean no-op — tests use it to prove the sequence was fully consumed).
   */
  deliverNextNavigation(): ScriptedNavigation | undefined {
    for (let index = 0; index < this.script.length; index += 1) {
      if (this.delivered[index]) continue;
      const entry = this.script[index];
      if (entry === undefined) continue; // unreachable (validated in constructor)
      if (!this.openHandleIds.has(entry.handleId)) {
        throw new ExperienceError(
          `navigationScript[${index}]: handle '${entry.handleId}' is not an open fixture session (unknown or closed) — fix the script`,
        );
      }
      this.delivered[index] = true;
      const listeners = this.listeners.get(entry.handleId) ?? [];
      for (const listener of listeners) {
        listener({ url: entry.url });
      }
      return entry;
    }
    return undefined;
  }

  /** Every recorded `open()` call, in order (url + the options received). */
  get recordedOpens(): readonly RecordedBrowserOpen[] {
    return this.openCalls;
  }

  /** Whether a fixture handle exists and is still open. */
  isHandleOpen(handleId: string): boolean {
    return this.openHandleIds.has(handleId);
  }

  /** Whether a fixture handle was closed (and can no longer navigate). */
  isHandleClosed(handleId: string): boolean {
    return this.closedHandleIds.has(handleId);
  }

  private assertHandle(handle: BrowserSessionHandle, operation: string): void {
    if (!isRecord(handle) || typeof handle.id !== "string" || handle.id.length === 0) {
      throw new ExperienceError(
        `${operation}.handle: expected a BrowserSessionHandle, got ${previewValue(handle)}`,
      );
    }
    if (!this.openHandleIds.has(handle.id)) {
      throw new ExperienceError(
        `${operation}.handle: '${handle.id}' is not an open fixture session (unknown or closed)`,
      );
    }
  }
}

/**
 * Build the deterministic fixture host for tests: a `BrowserHost` whose
 * navigation events fire ONLY when the test pumps the scripted sequence
 * (`deliverNextNavigation`), in strict script order. NO real webview.
 */
export function createFixtureBrowserHost(
  navigationScript: readonly ScriptedNavigation[] = [],
): FixtureBrowserHost {
  return new FixtureBrowserHost(navigationScript);
}
