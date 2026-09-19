/**
 * @wfx/app-web — the BYOF host seam (R20-D + R20-H): one surface, two
 * transports.
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
 * - SERVICE mode: the HTTP transport (`byof-service-transport.ts`) against
 *   the Experience API's feed-import routes (`/feeds/**` — the R20-H
 *   lane). This is THE seam swap the R20-D report escalated and the
 *   R20-H dispatch names: the service-side routes now exist, and this
 *   adapter binds to them over `WFX_API_BASE` with the SAME identity
 *   headers the R07 ServerPort stamps — the SAME operation surface and
 *   typed value shapes the fixtures runtime exposes, so the client
 *   components and view contracts are untouched (one client surface, two
 *   transports). A transport failure composes the honest typed
 *   `unavailable` view (state + detail) — never a fabricated import,
 *   never a silent empty state.
 */

import type { RuntimeContext } from "@wfx/client-runtime";
import type { WebRuntimeHost } from "@/host/web-host";

import { createByofServiceTransport, type ByofServiceTransport } from "./byof-service-transport";
import type { ByofFeedView, ByofPanelView } from "./byof-view";

// ---------------------------------------------------------------------------
// The host binding (what the view loaders need from the booted host)
// ---------------------------------------------------------------------------

/**
 * What the BYOF view loaders need from the booted web host: the boot mode
 * plus, in service mode, the validated API base URL and the identity
 * context every request is stamped with (headers, never URLs). A plain
 * discriminated union so tests can construct either side literally.
 */
export type ByofHostBinding =
  | { readonly mode: "fixtures" }
  | { readonly mode: "service"; readonly apiBase: URL; readonly context: RuntimeContext };

/**
 * Derive the BYOF binding from the booted web host (the composition root
 * resolved the config + session at boot — the ONE resolution law; this
 * only narrows them).
 */
export function byofHostBinding(host: WebRuntimeHost): ByofHostBinding {
  if (host.config.mode === "service") {
    return { mode: "service", apiBase: host.config.apiBase, context: host.session.context };
  }
  return { mode: "fixtures" };
}

/**
 * The service-mode BYOF transport for the booted host. Constructed per
 * call (a stateless binding over the resolved apiBase + context; the
 * fetch seam resolves per request, so a stubbed global fetch is honored).
 */
export function byofServiceTransportFor(host: WebRuntimeHost): ByofServiceTransport {
  const binding = byofHostBinding(host);
  if (binding.mode !== "service") {
    throw new Error("byofServiceTransportFor: the host booted in fixtures mode — use the fixtures runtime");
  }
  return createByofServiceTransport({ apiBase: binding.apiBase, context: binding.context });
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
  binding: ByofHostBinding,
  previewImportId?: string,
): Promise<ByofPanelView> {
  if (binding.mode !== "service") {
    const runtime = await getByofFixturesRuntime();
    return runtime.panelView(
      previewImportId !== undefined && previewImportId.length > 0 ? previewImportId : undefined,
    );
  }
  const transport = createByofServiceTransport({
    apiBase: binding.apiBase,
    context: binding.context,
  });
  return transport.panelView(
    previewImportId !== undefined && previewImportId.length > 0 ? previewImportId : undefined,
  );
}

/** The Library feed region view for the current boot mode. */
export async function loadByofFeedView(binding: ByofHostBinding): Promise<ByofFeedView> {
  if (binding.mode !== "service") {
    const runtime = await getByofFixturesRuntime();
    return runtime.feedView();
  }
  const transport = createByofServiceTransport({
    apiBase: binding.apiBase,
    context: binding.context,
  });
  return transport.feedView();
}
