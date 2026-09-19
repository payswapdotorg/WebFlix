/**
 * @wfx/app-web — the BYOF host seam (R20-D): one surface, two transports.
 *
 * The single module the settings panel, the Library feed region, and the
 * /api/byof route consume. It resolves the boot mode the SAME law the
 * ServerPort split does (the 050 environment law):
 *
 * - FIXTURES mode (`WFX_DEV_FIXTURES=1`, the loud dev badge): the real
 *   shared BYOF composition (`byof-fixtures.ts` — the REAL FeedImportService
 *   over PGlite + the REAL YouTube connector over its recorded fixtures),
 *   loaded through a dynamic import so the fixtures-only closure (PGlite,
 *   the postgres driver, the persistence migrations) NEVER enters the
 *   service-mode path.
 * - SERVICE mode: the honest typed `unavailable` truth. The BYOF feed
 *   routes on the Experience API (apps/api) are the lead's R20-H
 *   integration step — Worker 1's shared lane shipped the persistence +
 *   the connector capability + the reconciliation service, and the
 *   service-side HTTP surface that would serve them to this adapter has
 *   not been wired yet. This adapter renders that typed truth plainly
 *   (the same ratified precedent as the R03 `readSources` optional-member
 *   gap: the runtime answered "the adapter transport has not implemented
 *   the source read yet" until the lead wired the mapping) — never a fake
 *   import, never a fabricated feed, never a silent empty state. The gap
 *   is ESCALATED in the lane report for lead ratification.
 */

import type { HostMode } from "@/host/config";

import type {
  ByofFeedView,
  ByofFailure,
  ByofPanelView,
} from "./byof-view";

// ---------------------------------------------------------------------------
// The service-mode transport truth (typed, honest — see module doc)
// ---------------------------------------------------------------------------

/**
 * The typed `unavailable` failure the service-mode BYOF surfaces render:
 * the web adapter's BYOF UX is complete; the service-side feed routes it
 * would consume are the lead's integration step. This is the R03-style
 * honest transport gap — never stale "arrives later" copy for a capability
 * this lane shipped: the panel states exactly WHAT is wired and WHAT is
 * missing, in plain language, with the fixtures boot named as the working
 * configuration.
 */
export function byofServiceModeFailure(): ByofFailure {
  return {
    kind: "unavailable",
    detail:
      "Bring Your Own Feed needs the feed-import routes on the configured WebFlix service — " +
      "they are not exposed by this service yet (the R20 lead integration step). " +
      "The import flow runs in full in this host's deterministic fixtures boot (the dev mode badge).",
  };
}

/** The settings panel view in service mode (the honest typed state). */
function serviceModePanelView(): ByofPanelView {
  const failure = byofServiceModeFailure();
  return { state: "unavailable", detail: failure.detail, sources: [], imports: [], preview: null };
}

/** The Library feed region view in service mode (the honest typed state). */
function serviceModeFeedView(): ByofFeedView {
  const failure = byofServiceModeFailure();
  return { state: "unavailable", detail: failure.detail, imports: [], followingCount: 0, relationshipCounts: {} };
}

// ---------------------------------------------------------------------------
// The fixtures boot (dynamic import — the closure law, see module doc)
// ---------------------------------------------------------------------------

/** The fixtures runtime's interface (the type of the module's exported contract). */
type ByofFixturesRuntimeLike = import("./byof-fixtures").ByofFixturesRuntime;

/**
 * The fixtures-mode BYOF runtime (the real shared composition). The
 * dynamic import keeps PGlite/persistence/connectors out of the
 * service-mode closure; the runtime itself is globalThis-cached by the
 * fixtures module (the dev split-module law).
 */
export async function getByofFixturesRuntime(): Promise<ByofFixturesRuntimeLike> {
  const module = await import("./byof-fixtures");
  return module.getByofFixturesRuntime();
}

// ---------------------------------------------------------------------------
// The view loaders (what the pages consume)
// ---------------------------------------------------------------------------

/**
 * The settings panel view for the current boot mode. `previewImportId`
 * addresses the staged preview the `?byof=preview&import=` flow renders.
 */
export async function loadByofPanelView(
  mode: HostMode,
  previewImportId?: string,
): Promise<ByofPanelView> {
  if (mode !== "fixtures") return serviceModePanelView();
  const runtime = await getByofFixturesRuntime();
  return runtime.panelView(
    previewImportId !== undefined && previewImportId.length > 0 ? previewImportId : undefined,
  );
}

/** The Library feed region view for the current boot mode. */
export async function loadByofFeedView(mode: HostMode): Promise<ByofFeedView> {
  if (mode !== "fixtures") return serviceModeFeedView();
  const runtime = await getByofFixturesRuntime();
  return runtime.feedView();
}
