/**
 * @wfx/app-web — the web host boot composition (WFX-050).
 *
 * `bootWebHost()` is the composition root the Next.js App Router consumes:
 * it resolves the host configuration from the environment (the ONE law in
 * `host/config.ts`), selects the ports bundle through the same law
 * (`host/default-ports.ts`), and boots the EXISTING shared client runtime
 * via `bootWebClient` (WFX-040) — the web platform capability profile
 * bound to the shared `ClientRuntime` façade. No domain logic is
 * duplicated here; the host composes, the runtime runs.
 *
 * Boot outcomes (all machine-tested in `tests/host-boot.test.ts`):
 * - fixtures mode (`WFX_DEV_FIXTURES=1`, dev only) → deterministic
 *   fixture content;
 * - service mode → real HTTP ports against `WFX_API_BASE`;
 * - misconfigured → `HostConfigError` naming the offending variables —
 *   loudly, before any content is served.
 */

import { bootWebClient } from "../main";
import type { WebClient } from "../main";
import type { HostEnv, HostMode } from "./config";
import { resolveHostConfig } from "./config";
import { resolveDefaultPorts } from "./default-ports";

/** A booted web host: the mode it booted in plus the shared client. */
export interface WebHost {
  /** The boot mode the environment selected. */
  readonly mode: HostMode;
  /** The booted web client (platform profile + shared runtime). */
  readonly client: WebClient;
}

/**
 * Boot the web host from the environment.
 *
 * @param env the environment to read (defaults to `process.env`).
 * @throws {@link import("./config").HostConfigError} when the environment
 * cannot honestly select a mode — never a silent fixture fallback.
 */
export function bootWebHost(env: HostEnv = process.env): WebHost {
  const config = resolveHostConfig(env);
  const { ports } = resolveDefaultPorts(env);
  const client = bootWebClient({ ports });
  return { mode: config.mode, client };
}
