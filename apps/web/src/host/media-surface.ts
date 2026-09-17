/**
 * @wfx/app-web — the Web adapter's Media Surface resolver wiring (R09).
 *
 * THE PRECEDENCE, WIRED END-TO-END for the Web platform: this module
 * constructs the `SurfaceResolverSeam` the shared runtime consumes — the
 * ADAPTER'S wiring of the FROZEN resolver (`@wfx/experience`'s
 * `resolveSurface`, the pure decision engine behind
 * Native > Embed > Browser > External).
 *
 * The wiring's ONE job is capability TRUTH: it derives the resolver's
 * device capabilities from THIS adapter's truthful `PlatformCapabilities`
 * bundle (never a probe, never aspiration):
 *
 * | Bundle declaration          | Derived device truth                              |
 * |-----------------------------|----------------------------------------------------|
 * | `nativeMedia: "none"`       | native mode NOT declared (Web honestly cannot)      |
 * | `browserHost: "contained"`  | `browser: true` + embed/browser modes declared      |
 * | `browserHost: "none"`       | `browser: false` — no embed, no browser mode        |
 * | `backgroundWork`            | `backgroundPlayback` (web: none ⇒ false)            |
 *
 * The codec list is the documented evergreen web decode set — INFORMATIONAL
 * ONLY: the native codec-demand gate never fires on Web because native is
 * honestly undeclared (`nativeMedia: "none"`); the list exists because the
 * frozen `DeviceCapabilities` shape requires it, and it is never presented
 * as a native-capability claim.
 *
 * Permissions default permissive (`nativePermitted`/`browserAllowed`/
 * `externalAllowed` all default true — the frozen request's law): the Web
 * adapter holds no per-mode restrictions today; the authorized-media
 * boundary and provider restrictions enter through realizations and the
 * capability truth, never through fabricated permission denials.
 *
 * The decision instant comes from the adapter's clock seam (the runtime's
 * own law — never a hidden wall clock). The seam is SYNCHRONOUS and PURE,
 * exactly as the frozen resolver is.
 *
 * INVARIANT 10 (a fixture is never silently presented as production
 * capability): in dev-fixture mode the realizations this seam resolves come
 * from the LOUDLY-NAMED fixture transport (`wfx-dev-fixture-service`, the
 * fake-source connector); in service mode they come from the real
 * `WFX_API_BASE` transport. The seam itself never fabricates a realization.
 */

import type { DeviceCapabilities, EntertainmentItem, PlaybackMode, PlaybackRealization } from "@wfx/domain";
import { resolveSurface, type SurfaceRealization } from "@wfx/experience";
import type { RuntimeClock, SurfaceResolutionOutcome, SurfaceResolverSeam } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";

// ---------------------------------------------------------------------------
// The device-capability derivation (bundle truth -> resolver device truth)
// ---------------------------------------------------------------------------

/**
 * The documented evergreen web decode set (h264/vp9/av1 + aac/opus) —
 * INFORMATIONAL: native is honestly undeclared on Web, so the resolver's
 * native codec-demand gate never consults it. Never a native claim.
 */
const EVERGREEN_WEB_CODECS: readonly string[] = ["h264", "vp9", "av1", "aac", "opus"];

/**
 * Derive the resolver's `DeviceCapabilities` from the truthful web bundle.
 * Pure: the bundle is the declaration the runtime already truth-checked at
 * boot, so the derivation cannot disagree with what the adapter provides.
 */
export function webDeviceCapabilities(
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
    codecs: [...EVERGREEN_WEB_CODECS],
    browser: capabilities.browserHost === "contained",
    backgroundPlayback: capabilities.backgroundWork !== "none",
    casting: false, // the web bundle declares no cast sink — informational
  };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** Options for {@link createWebSurfaceResolver}. */
export interface WebSurfaceResolverOptions {
  /**
   * The truthful web capability declaration (the bundle's own
   * nativeMedia/browserHost/backgroundWork levels — everything the device
   * derivation consumes; a full `PlatformCapabilities` satisfies this).
   */
  readonly capabilities: Pick<
    PlatformCapabilities,
    "nativeMedia" | "browserHost" | "backgroundWork"
  >;
  /** The adapter clock (stamps each resolution's decision instant). */
  readonly clock: RuntimeClock;
}

/**
 * Build the Web adapter's `SurfaceResolverSeam` — the frozen resolver wired
 * to the Web platform's truthful device capabilities. The seam answers the
 * frozen `SurfaceResolution` (which structurally satisfies the runtime's
 * seam contract) for every playback resolution the runtime performs.
 */
export function createWebSurfaceResolver(options: WebSurfaceResolverOptions): SurfaceResolverSeam {
  const device = webDeviceCapabilities(options.capabilities);
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
      // container needs, so this path cannot throw for data reasons.
      return resolveSurface(request);
    },
  };
}
