/**
 * @wfx/app-web — the WEB ADAPTER entry (R07).
 *
 * The Universal Entertainment OS's web adapter: `bootWebAdapter` composes
 * the truthful platform bundle (`src/platform/`) with the anonymous-mode
 * session (`host/session.ts` — the R02 seam) and constructs the ONE
 * shared client runtime (`@wfx/client-runtime` `createRuntime`). The app
 * RENDERS RUNTIME STATE; it owns no product business logic (the frozen
 * layering law — this module is the adapter's composition surface, not a
 * second runtime).
 *
 * The Next.js App Router host consumes the SAME law through
 * `host/web-host.ts` (`getWebRuntimeHost` — the per-process singleton);
 * this entry is the package-level composition for hosts that boot the
 * adapter directly (tests, alternative shells).
 */

import type { ClientRuntime } from "@wfx/client-runtime";

import type { WebPlatformBundle } from "./platform/capabilities";
import { createWebPlatformCapabilities } from "./platform/capabilities";
import type { WebBrowserHostPort } from "./platform/browser-host";
import type { WebEnvironment } from "./platform/environment";
import { WebClock } from "./platform/lifecycle";
import { bootWebRuntimeHost, CryptoUlidGen } from "./host/web-host";
import type { WebRuntimeHost } from "./host/web-host";
import type { HostEnv } from "./host/config";

/** Options for {@link bootWebAdapter}. */
export interface WebAdapterBootOptions {
  /** The environment to read (default: `process.env` — the 050 boot law). */
  readonly env?: HostEnv;
  /** The browser environment override (default: the real detected one). */
  readonly environment?: WebEnvironment;
}

/** A booted web adapter: the platform bundle + the ONE runtime. */
export interface WebAdapter {
  readonly platform: "web";
  readonly bundle: WebPlatformBundle;
  readonly runtime: ClientRuntime;
  readonly browserHost: WebBrowserHostPort;
}

/**
 * Boot the web adapter: the truthful bundle + the anonymous session + the
 * runtime, through the SAME composition root the app host uses.
 *
 * @throws {@link import("./host/config").HostConfigError} when the
 * environment cannot honestly select a transport (the 050 law — never a
 * silent fixture fallback).
 */
export async function bootWebAdapter(options: WebAdapterBootOptions = {}): Promise<WebAdapter> {
  const host: WebRuntimeHost = await bootWebRuntimeHost(
    options.env ?? process.env,
    options.environment !== undefined ? { environment: options.environment } : {},
  );
  return {
    platform: "web",
    bundle: host.capabilities,
    runtime: host.runtime,
    browserHost: host.browserHost,
  };
}

// Re-exported for host composition convenience (the seams the adapter owns).
export { createWebPlatformCapabilities, WebClock, CryptoUlidGen };
