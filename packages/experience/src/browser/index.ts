/**
 * @wfx/experience — in-app browser surface (WFX-026, Lane C).
 *
 * The CONTAINED browser session model: a typed, host-embeddable
 * specification of the in-app browser surface — frozen-architecture step 3
 * of playback resolution ("In-app browser when provider web playback is
 * permitted"), built ON the merged Lane-C work (WFX-025 resolver) via
 * `@wfx/experience`'s own modules. Browser mode is a UX surface, NOT a
 * mechanism for defeating provider security — that law shapes every
 * module here.
 *
 * - `host.ts`        — the `BrowserHost` platform seam (Tauri WebView /
 *                      Android WebView / iOS WKWebView adapters implement
 *                      it; NO real webview here) + the deterministic
 *                      scripted `FixtureBrowserHost` for tests
 * - `session.ts`     — `BrowserSurfaceSession`: the FSM
 *                      (closed -> opening -> ready -> navigating -> ready ->
 *                      ... -> closed) with typed illegal-transition errors,
 *                      the auditable session trail, the OBSERVED-never-
 *                      blocked provider handoff events, and the persistent
 *                      shelf
 * - `isolation.ts`   — the security isolation POLICY (pure): file:// and
 *                      private/loopback IP literals always rejected (SSRF
 *                      guard, pure IP parsing), per-connector origin
 *                      allow-lists, the cookie-isolation assertion hosts
 *                      MUST honor
 * - `shell.ts`       — the persistent WebFlix shell: `SurfaceChromeState`
 *                      (compact/expanded/hidden), the resume heartbeat
 *                      payload, typed `ShellCommands` — pure state +
 *                      reducers, navigation-proof
 * - `component.ts`   — `createBrowserSurface(deps)`: the framework-neutral
 *                      controller binding host + session + shell + policy,
 *                      with the thin React wrapper documented in comment
 *                      form (no react in this workspace — lane rules)
 *
 * NO real browser engine control, no randomness, no hidden globals, no new
 * runtime dependencies. Everything is typed; unsupported behavior is a
 * typed result, never a fake success.
 */

export * from "./host";
export * from "./isolation";
export * from "./shell";
export * from "./session";
export * from "./component";
