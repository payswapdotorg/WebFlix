/**
 * @wfx/app-web — the WEB client entry (WFX-040, Lane C).
 *
 * The browser-constrained shell of the frozen cross-platform strategy
 * ("Web is broad but browser-constrained"): it boots the SAME shared client
 * runtime as desktop and mobile, bound to `WebCapabilities` — no native
 * media (honestly undeclared; the resolver rejects `native` with a recorded
 * reason), embed/browser/external modes, localStorage-backed storage, and a
 * background policy of "never" (browsers suspend background video).
 *
 * The ports are FIXTURES here (`makeFixturePorts()` from `@wfx/experience` —
 * the deterministic fake connector, recording sink, fixed clock, sequential
 * ids). Real wiring — a Next.js host (the frozen technology guidance), a real
 * connector, a real event pipeline — is the packaging work, post-MVP per
 * the dispatch packet; the typed seams are the deliverable.
 */

import type { Ports } from "@wfx/experience";
import { makeFixturePorts } from "@wfx/experience";

import type { PlatformProfile } from "./shared/capabilities";
import { createWebPlatform } from "./shared/capabilities";
import type { ClientRuntime } from "./shared/runtime";
import { createClientRuntime } from "./shared/runtime";

/** Options for {@link bootWebClient}. */
export interface WebClientBootOptions {
  /** The ports bundle (defaults to the deterministic fixture ports). */
  readonly ports?: Ports;
}

/** A booted web client: the shared runtime on the web platform profile. */
export interface WebClient {
  readonly platform: "web";
  readonly profile: PlatformProfile<"web">;
  readonly runtime: ClientRuntime;
}

/**
 * Boot the web client: bind the Web capability profile (fresh fixture
 * adapters — no shared mutable state) and the ports into the shared client
 * runtime. The SAME `createClientRuntime` call boots desktop and mobile.
 */
export function bootWebClient(options: WebClientBootOptions = {}): WebClient {
  const profile = createWebPlatform();
  const ports = options.ports ?? makeFixturePorts();
  const runtime = createClientRuntime(profile, ports);
  return { platform: "web", profile, runtime };
}
