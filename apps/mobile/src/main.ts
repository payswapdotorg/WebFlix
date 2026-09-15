/**
 * @wfx/app-mobile — the MOBILE client entry (WFX-040, Lane C).
 *
 * The OS-constrained shell of the frozen cross-platform strategy ("Mobile
 * uses native media/platform facilities and OS-constrained background
 * behavior"): it boots the SAME shared client runtime as web and desktop,
 * bound to `MobileCapabilities` — native media via OS platform players
 * (the NativeMediaEngine port is the DESKTOP seam; binding it here is
 * rejected as the capability lie it would be), restricted codecs,
 * reduced cache ceilings, and a typed `os-constrained` background policy
 * that honors the injected network-class / charging inputs.
 *
 * Background wiring: at boot the client registers a lifecycle listener —
 * when the host reports `background` (the platform lifecycle seam), the
 * runtime's typed background decision is evaluated and SURFACED through
 * `backgroundDecisions()` (typed, never executed: pause is a decision the
 * host acts on, not media control this scaffold fabricates). On the
 * wifi-only + charging-required fixture constraints, a cellular /
 * not-charging report yields the typed PAUSE decision.
 *
 * No Android/iOS build tooling here — the typed shell is the deliverable.
 */

import type { Ports } from "@wfx/experience";
import { makeFixturePorts } from "@wfx/experience";

import type { BackgroundDecision, MobileBackgroundInputs, PlatformProfile } from "@wfx/app-web";
import { createMobilePlatform } from "@wfx/app-web";
import type { ClientRuntime } from "@wfx/app-web";
import { createClientRuntime } from "@wfx/app-web";

/**
 * The default injected OS background inputs — an explicit FIXTURE (cellular,
 * not charging): the constrained case, so the unconfigured mobile client
 * surfaces the safe-side pause decision rather than an optimistic continue.
 * Real wiring reads the OS network/battery state at packaging time.
 */
export const MOBILE_BACKGROUND_INPUTS_FIXTURE: Readonly<MobileBackgroundInputs> = Object.freeze({
  networkClass: "cellular",
  charging: false,
});

/** Options for {@link bootMobileClient}. */
export interface MobileClientBootOptions {
  /**
   * The injected OS background inputs (network class / charging) honored by
   * the os-constrained background policy. Defaults to
   * {@link MOBILE_BACKGROUND_INPUTS_FIXTURE}.
   */
  readonly backgroundInputs?: MobileBackgroundInputs;
  /** The ports bundle (defaults to the deterministic fixture ports). */
  readonly ports?: Ports;
}

/** A booted mobile client: the shared runtime on the mobile platform profile. */
export interface MobileClient {
  readonly platform: "mobile";
  readonly profile: PlatformProfile<"mobile">;
  readonly backgroundInputs: Readonly<MobileBackgroundInputs>;
  readonly runtime: ClientRuntime;
  /**
   * The typed background decisions surfaced on OS background transitions
   * (the lifecycle-port wiring), in transition order. Read-only view.
   */
  backgroundDecisions(): readonly BackgroundDecision[];
}

/**
 * Boot the mobile client: bind the Mobile capability profile, the ports,
 * and the injected OS background inputs into the shared client runtime,
 * wiring the background-transition lifecycle seam to the typed decision.
 */
export function bootMobileClient(options: MobileClientBootOptions = {}): MobileClient {
  const profile = createMobilePlatform();
  const ports = options.ports ?? makeFixturePorts();
  const backgroundInputs = options.backgroundInputs ?? MOBILE_BACKGROUND_INPUTS_FIXTURE;
  const runtime = createClientRuntime(profile, ports, { backgroundInputs });

  const decisions: BackgroundDecision[] = [];
  profile.adapter.lifecycle.on("background", () => {
    decisions.push(runtime.background());
  });

  return {
    platform: "mobile",
    profile,
    backgroundInputs,
    runtime,
    backgroundDecisions: () => [...decisions],
  };
}
