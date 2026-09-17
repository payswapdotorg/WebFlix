/**
 * @wfx/app-desktop — the Desktop adapter's Media Surface resolver wiring (R09).
 *
 * THE PRECEDENCE, WIRED END-TO-END for the Desktop platform: this module
 * constructs the `SurfaceResolverSeam` the shared runtime consumes — the
 * ADAPTER'S wiring of the FROZEN resolver (`@wfx/experience`'s
 * `resolveSurface`, the pure decision engine behind
 * Native > Embed > Browser > External).
 *
 * The Desktop adapter is the FULL-POWER reference client, and the wiring's
 * ONE job is capability TRUTH derived from the truthful bundle:
 *
 * | Bundle declaration               | Derived device truth                          |
 * |----------------------------------|-----------------------------------------------|
 * | `nativeMedia: "native-service"`  | native mode declared (the R10 engine binding) |
 * | `browserHost: "contained"`       | `browser: true` + embed/browser modes         |
 * | `backgroundWork: "full"`         | `backgroundPlayback: true`                    |
 *
 * The codec list is the WFX-002 `DESKTOP_NATIVE` reference decode set
 * (h264/hevc/vp9/av1 + aac/opus/flac) — the documented reference values the
 * surface matrix itself uses for the "desktop-full" profile. It is the
 * native codec-demand gate's device side: a native realization whose media
 * demands the reference desktop pipeline cannot decode is honestly
 * rejected by the resolver (named in the trace), never attempted.
 *
 * Permissions default permissive (`nativePermitted`/`browserAllowed`/
 * `externalAllowed` all default true — the frozen request's law): the
 * authorized-media boundary itself is enforced upstream (authorized media
 * only — invariant 5; the native-media engine refuses unauthorized
 * sources), not by fabricating permission denials here.
 *
 * The decision instant comes from the adapter's clock seam. The seam is
 * SYNCHRONOUS and PURE, exactly as the frozen resolver is.
 */

import type { DeviceCapabilities, EntertainmentItem, PlaybackMode, PlaybackRealization } from "@wfx/domain";
import { DESKTOP_NATIVE } from "@wfx/domain";
import { resolveSurface, type SurfaceRealization } from "@wfx/experience";
import type { RuntimeClock, SurfaceResolutionOutcome, SurfaceResolverSeam } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";

// ---------------------------------------------------------------------------
// The device-capability derivation (bundle truth -> resolver device truth)
// ---------------------------------------------------------------------------

/**
 * Derive the resolver's `DeviceCapabilities` from the truthful Desktop
 * bundle. Pure: the bundle is the declaration the runtime already
 * truth-checked at boot (native-service media + contained webview surface +
 * full background work), so the derivation cannot disagree with what the
 * adapter provides.
 */
export function desktopDeviceCapabilities(
  capabilities: Pick<PlatformCapabilities, "nativeMedia" | "browserHost" | "backgroundWork">,
): DeviceCapabilities {
  const playbackModes: PlaybackMode[] = [];
  if (capabilities.nativeMedia !== "none") {
    playbackModes.push("native");
  }
  if (capabilities.browserHost === "contained") {
    playbackModes.push("embed");
    playbackModes.push("browser");
  }
  playbackModes.push("external");
  return {
    playbackModes,
    // The WFX-002 reference desktop decode set (the surface matrix's own
    // "desktop-full" profile values) — the native codec-demand gate's
    // device side.
    codecs: [...DESKTOP_NATIVE.codecs],
    browser: capabilities.browserHost === "contained",
    backgroundPlayback: capabilities.backgroundWork === "full",
    casting: false, // the reference desktop declares no cast sink
    ...(DESKTOP_NATIVE.storageBytes !== undefined
      ? { storageBytes: DESKTOP_NATIVE.storageBytes }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopSurfaceResolver}. */
export interface DesktopSurfaceResolverOptions {
  /** The truthful Desktop capability bundle (the runtime's own boot truth). */
  readonly capabilities: PlatformCapabilities;
  /** The adapter clock (stamps each resolution's decision instant). */
  readonly clock: RuntimeClock;
}

/**
 * Build the Desktop adapter's `SurfaceResolverSeam` — the frozen resolver
 * wired to the Desktop platform's truthful device capabilities (native
 * included: the R10 engine binding backs the NATIVE rung). The seam answers
 * the frozen `SurfaceResolution` for every playback resolution the runtime
 * performs.
 */
export function createDesktopSurfaceResolver(
  options: DesktopSurfaceResolverOptions,
): SurfaceResolverSeam {
  const device = desktopDeviceCapabilities(options.capabilities);
  return {
    resolve(input: {
      readonly itemId: string;
      readonly item?: EntertainmentItem;
      readonly realizations: readonly PlaybackRealization[];
    }): SurfaceResolutionOutcome {
      // The frozen resolver validates the item's SHAPE; the runtime's
      // registry record is the truthful carrier, and an unregistered item
      // resolves through the minimal canonical carrier (the canonicalType
      // never influences the precedence walk).
      const item: EntertainmentItem =
        input.item !== undefined ? input.item : { id: input.itemId, canonicalType: "video" };
      const request = {
        item,
        realizations: input.realizations as readonly SurfaceRealization[],
        device,
        permissions: {}, // permissive defaults (the frozen request's law)
        now: new Date(options.clock.now()).toISOString(),
      };
      // resolveSurface's own laws apply verbatim: per-realization problems
      // are typed exclusions INSIDE the resolution; only a malformed request
      // CONTAINER throws — and the runtime pre-validated everything the
      // container needs.
      return resolveSurface(request);
    },
  };
}
