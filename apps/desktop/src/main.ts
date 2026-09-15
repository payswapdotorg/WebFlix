/**
 * @wfx/app-desktop — the DESKTOP client entry (WFX-040, Lane C).
 *
 * The REFERENCE full-power native client of the frozen cross-platform
 * strategy ("Desktop is the reference full-power native client"): it boots
 * the SAME shared client runtime as web and mobile, bound to
 * `DesktopCapabilities` — all four playback modes including NATIVE (the
 * WebFlix-controlled media path), background completion while unfocused,
 * filesystem-backed storage, and a contained in-app browser surface
 * (the WFX-026 BrowserHost port).
 *
 * Native mode honesty: the desktop profile DECLARES native, and a runtime
 * only KEEPS that declaration when a native media engine port is bound
 * (`createClientRuntime(profile, ports, { engine })`). This entry binds
 * the WFX-014 `stubEngine()` TEST FIXTURE by default — an in-memory,
 * no-I/O double of the frozen `NativeMediaEngine` interface from
 * `@wfx/native-media` (never wired as production). The real desktop shell
 * binds the native media engine process at packaging time (post-MVP, per
 * the dispatch packet: typed entries + smoke tests only).
 *
 * No Tauri build tooling here — the typed shell is the deliverable.
 */

import type { NativeMediaEngine } from "@wfx/domain";
import type { Ports } from "@wfx/experience";
import { makeFixturePorts } from "@wfx/experience";
import { stubEngine } from "@wfx/native-media";

import type { PlatformProfile } from "@wfx/app-web";
import { createDesktopPlatform } from "@wfx/app-web";
import type { ClientRuntime } from "@wfx/app-web";
import { createClientRuntime } from "@wfx/app-web";

/** Options for {@link bootDesktopClient}. */
export interface DesktopClientBootOptions {
  /**
   * The native media engine port. Defaults to the WFX-014 `stubEngine()`
   * TEST FIXTURE (in-memory, no I/O — never production). When omitted the
   * fixture is used; pass an explicit engine to bind a real one.
   */
  readonly engine?: NativeMediaEngine;
  /** The ports bundle (defaults to the deterministic fixture ports). */
  readonly ports?: Ports;
}

/** A booted desktop client: the shared runtime on the desktop platform profile. */
export interface DesktopClient {
  readonly platform: "desktop";
  readonly profile: PlatformProfile<"desktop">;
  readonly engine: NativeMediaEngine;
  readonly runtime: ClientRuntime;
}

/**
 * Boot the reference desktop client: bind the Desktop capability profile,
 * the ports, and the native media engine port into the shared client
 * runtime. With the engine bound, native-mode realizations are SELECTABLE
 * (the resolver's precedence trace records `native: accepted`); an
 * engine-less desktop runtime resolves with native honestly removed.
 */
export function bootDesktopClient(options: DesktopClientBootOptions = {}): DesktopClient {
  const profile = createDesktopPlatform();
  const ports = options.ports ?? makeFixturePorts();
  // FIXTURE — the real engine process binding is post-MVP packaging.
  const engine = options.engine ?? stubEngine();
  const runtime = createClientRuntime(profile, ports, { engine });
  return { platform: "desktop", profile, engine, runtime };
}
