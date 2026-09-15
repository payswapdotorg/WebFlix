/**
 * @wfx/app-web — the WEB client entry (WFX-040, Lane C; WFX-050 productionized).
 *
 * The browser-constrained shell of the frozen cross-platform strategy
 * ("Web is broad but browser-constrained"): it boots the SAME shared client
 * runtime as desktop and mobile, bound to `WebCapabilities` — no native
 * media (honestly undeclared; the resolver rejects `native` with a recorded
 * reason), embed/browser/external modes, localStorage-backed storage, and a
 * background policy of "never" (browsers suspend background video).
 *
 * WFX-050 — the production boot law. Ports are selected by ENVIRONMENT,
 * never by silent fallback:
 *
 * - Omitted `ports` resolve through the host config law
 *   (`host/default-ports.ts`): `WFX_DEV_FIXTURES=1` (dev only) yields the
 *   deterministic fixture ports; otherwise the real split-runtime service
 *   ports against `WFX_API_BASE`; neither set throws the typed
 *   `HostConfigError` naming the missing variables. There is NO code path
 *   in this package that reaches fixture ports without the explicit flag.
 * - Explicit `ports` are used verbatim (tests, alternative hosts).
 *
 * The Next.js App Router host composes through `src/host/boot.ts`, which
 * funnels into this same law.
 */

import type { Ports } from "@wfx/experience";

import type { PlatformProfile } from "./shared/capabilities";
import { createWebPlatform } from "./shared/capabilities";
import type { ClientRuntime } from "./shared/runtime";
import { createClientRuntime } from "./shared/runtime";
import { resolveDefaultPorts } from "./host/default-ports";

/** Options for {@link bootWebClient}. */
export interface WebClientBootOptions {
  /**
   * The ports bundle. When omitted, the ENVIRONMENT selects it through the
   * host config law (`WFX_DEV_FIXTURES=1` ⇒ fixtures, dev only; otherwise
   * the `WFX_API_BASE` service ports) — or throws the typed
   * `HostConfigError` when neither is honestly configured.
   */
  readonly ports?: Ports;
}

/** A booted web client: the shared runtime on the web platform profile. */
export interface WebClient {
  readonly platform: "web";
  readonly profile: PlatformProfile<"web">;
  readonly runtime: ClientRuntime;
}

/**
 * Boot the web client: bind the Web capability profile (fresh adapters —
 * no shared mutable state) and the ports into the shared client runtime.
 * The SAME `createClientRuntime` call boots desktop and mobile.
 *
 * @throws {@link import("./host/config").HostConfigError} when ports are
 * omitted and the environment cannot honestly select a mode (see the
 * module doc — never a silent fixture fallback).
 */
export function bootWebClient(options: WebClientBootOptions = {}): WebClient {
  const profile = createWebPlatform();
  const ports = options.ports ?? resolveDefaultPorts().ports;
  const runtime = createClientRuntime(profile, ports);
  return { platform: "web", profile, runtime };
}
