/**
 * @wfx/app-desktop — the native BrowserHost (R08).
 *
 * The Desktop contained browser surface: a native webview window per
 * surface session (opened by the shell), observed — never steered.
 *
 * SECURITY BOUNDARY (frozen remediation architecture, "Media Surface" —
 * the same law the port contract states):
 *
 * - The webview surface is a UX surface, NEVER a circumvention mechanism.
 *   Provider pages stay PROVIDER-OWNED: their markup, scripts, DRM, access
 *   controls, CAPTCHAs, anti-bot controls, rate limits, and geographic
 *   restrictions are never circumvented, intercepted, or modified.
 * - COOKIE/STORAGE ISOLATION IS MANDATORY: every `open()` must carry
 *   `restrictCookies: "isolate"` (the port contract's single legal value).
 *   The shell gives each surface session its own isolated webview data
 *   directory — separate from the WebFlix app window and from every other
 *   surface session — so provider cookies/storage never leak across
 *   sessions or into the app origin. A request with any other mode is
 *   refused BEFORE reaching the shell (typed `invalid-session` refusal,
 *   mirroring the contract's non-optionality).
 * - NAVIGATION IS OBSERVED, NOT BLOCKED, NOT STEERED: the host reports
 *   where the user went (`navigated` events); provider handoffs are honest
 *   observations. The ONLY refusal path is the shell's own policy, which
 *   surfaces as a typed `blocked` event/error with the reason.
 * - NO script injection, NO credential capture, NO content inspection of
 *   provider pages — this port has no mechanism for any of it, by design.
 */

import {
  BrowserSurfaceError,
  type BrowserHostPort,
  type BrowserSurfaceEvent,
  type BrowserSurfaceRequest,
  type BrowserSurfaceSession,
  type Unsubscribe,
} from "@wfx/platform-contracts";

import { isShellIpcError, type ShellIpc, type ShellSurfaceEvent } from "./shell-ipc";

/** Map a shell surface failure onto the typed `BrowserSurfaceError` (1:1 vocabulary). */
function surfaceFailure(operation: string, thrown: unknown): BrowserSurfaceError {
  if (isShellIpcError(thrown)) {
    switch (thrown.code) {
      case "unavailable":
        return new BrowserSurfaceError("unavailable", thrown.detail);
      case "invalid-url":
        return new BrowserSurfaceError("invalid-url", thrown.detail);
      case "blocked":
        return new BrowserSurfaceError("blocked", thrown.detail);
      case "invalid-session":
        return new BrowserSurfaceError("invalid-session", thrown.detail);
      default:
        // Storage/engine-area codes cannot originate from surface commands.
        return new BrowserSurfaceError(
          "unavailable",
          `unexpected shell code '${thrown.code}' during ${operation}: ${thrown.detail}`,
        );
    }
  }
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return new BrowserSurfaceError("unavailable", `shell browser host failed during ${operation}: ${detail}`);
}

/** Re-emit one shell surface event to the session's listeners (verbatim mapping). */
function toSurfaceEvent(event: ShellSurfaceEvent): BrowserSurfaceEvent {
  return {
    kind: event.kind,
    sessionId: event.sessionId,
    ...(event.url !== undefined ? { url: event.url } : {}),
    occurredAtMs: event.occurredAtMs,
    ...(event.reason !== undefined ? { reason: event.reason } : {}),
  };
}

/**
 * Build the Desktop `BrowserHostPort` over the shell's webview surface
 * commands. Each `open` mints an isolated surface session handle whose
 * events stream from the shell's surface channel.
 */
export function createShellBrowserHostPort(shell: ShellIpc): BrowserHostPort {
  return {
    async open(request: BrowserSurfaceRequest): Promise<BrowserSurfaceSession> {
      // The isolation contract is not optional — refuse anything else
      // before the shell is asked (the port's own law).
      if (request.restrictCookies !== "isolate") {
        throw new BrowserSurfaceError(
          "invalid-session",
          `the cookie-isolation contract is not optional (got '${String(request.restrictCookies)}')`,
        );
      }
      let sessionId: string;
      try {
        const opened = await shell.surfaceOpen({
          url: request.url,
          restrictCookies: "isolate",
          purpose: request.purpose,
        });
        sessionId = opened.sessionId;
      } catch (thrown) {
        throw surfaceFailure("open", thrown);
      }

      const listeners = new Set<(event: BrowserSurfaceEvent) => void>();
      let closed = false;

      const unsubscribe = shell.onSurfaceEvent((shellEvent) => {
        if (shellEvent.sessionId !== sessionId) return;
        const event = toSurfaceEvent(shellEvent);
        if (event.kind === "closed") closed = true;
        for (const listener of listeners) listener(event);
      });

      return {
        id: sessionId,
        url: request.url,
        async navigate(url: string): Promise<void> {
          try {
            await shell.surfaceNavigate(sessionId, url);
          } catch (thrown) {
            throw surfaceFailure("navigate", thrown);
          }
        },
        async close(): Promise<void> {
          if (closed) {
            unsubscribe();
            return; // closing an already-closed surface is a no-op
          }
          try {
            await shell.surfaceClose(sessionId);
          } catch (thrown) {
            // A failed close stops the event stream regardless — the
            // surface is adapter-best-effort at teardown (documented).
            unsubscribe();
            throw surfaceFailure("close", thrown);
          }
          unsubscribe();
        },
        subscribe(listener: (event: BrowserSurfaceEvent) => void): Unsubscribe {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    },
  };
}
