/**
 * @wfx/app-web — the Bring Your Feed route (R20-D): the BYOF destination.
 *
 * `/library/bring-feed?mode=<byof|following|webflix|hybrid>` — the BYOF
 * onboarding and feed surface, living in the LIBRARY context of the
 * existing product IA (the frozen UX law: no new navigation system; the
 * entries are the Library surface's section link and the Settings sources
 * entry). A presentation route (the player/offline law): the runtime's
 * navigation holds the state the user came from.
 *
 * Server component over the ONE runtime + the BYOF host service's typed
 * results (the mode-truth, freshness, and failure laws render verbatim —
 * never a fake empty list, never a silent error).
 */

import { AppShell } from "@/components/shell/AppShell";
import { BringYourFeedSurface } from "@/components/byof/BringYourFeedSurface";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadByofFeedView } from "@/host/byof/view-models";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function BringYourFeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/library/bring-feed", params);
  const mode = firstParam(params.mode);
  const view = await loadByofFeedView(host, mode.length > 0 ? mode : undefined);
  return (
    <AppShell mode={host.mode} active="library" session={host.session.state}>
      <BringYourFeedSurface view={view} />
    </AppShell>
  );
}
