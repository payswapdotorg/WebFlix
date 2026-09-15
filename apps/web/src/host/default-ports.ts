/**
 * @wfx/app-web — the default port selection (WFX-050, THE law).
 *
 * ONE function decides which `Ports` bundle an env-driven boot gets, and
 * it is consumed by every boot path in this app (`host/boot.ts` and the
 * `main.ts` default when ports are omitted):
 *
 * - `WFX_DEV_FIXTURES=1` (or `true`) in non-production → the deterministic
 *   fixture ports from `@wfx/experience` — the ONLY way fixtures can be
 *   reached, and machine-tested to be impossible without the explicit flag.
 * - Otherwise → the real split-runtime service ports against
 *   `WFX_API_BASE` (`host/remote-ports.ts`).
 * - Neither → `HostConfigError` naming `WFX_API_BASE`. NEVER fixtures.
 *
 * See `host/config.ts` for the full law (including the production guard
 * on `WFX_DEV_FIXTURES` and value validation).
 */

import type { Ports } from "@wfx/experience";
import { makeFixturePorts } from "@wfx/experience";

import type { HostConfig, HostEnv } from "./config";
import { resolveHostConfig } from "./config";
import { createRemotePorts } from "./remote-ports";

/** The resolved default ports: the config plus the bundle it selects. */
export interface DefaultPortsSelection {
  /** The resolved host configuration (mode + detail). */
  readonly config: HostConfig;
  /** The ports bundle the mode selects. */
  readonly ports: Ports;
}

/**
 * Select the default `Ports` bundle from the environment.
 *
 * @throws {@link import("./config").HostConfigError} when the environment
 * cannot honestly select a mode (see the module doc — never fixtures).
 */
export function resolveDefaultPorts(env: HostEnv = process.env): DefaultPortsSelection {
  const config = resolveHostConfig(env);
  if (config.mode === "fixtures") {
    return { config, ports: makeFixturePorts() };
  }
  return { config, ports: createRemotePorts({ apiBase: config.apiBase }) };
}
