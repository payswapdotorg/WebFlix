/**
 * @wfx/app-web — the long-form Watch browse route (R07).
 *
 * The watch surface over the ONE runtime: the navigation state synced to
 * `/watch`, the browse rows from the runtime's search models (typed
 * statuses), rendered server-side. `force-dynamic` for the same
 * environment-law reasons as home.
 */

import { AppShell } from "@/components/shell/AppShell";
import { WatchBrowseSurface } from "@/components/watch/WatchBrowseSurface";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadWatchBrowseView } from "@/host/view-models";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/watch", {});
  const view = await loadWatchBrowseView(host);
  return (
    <AppShell mode={host.mode} active="watch" session={host.session.state}>
      <WatchBrowseSurface view={view} />
    </AppShell>
  );
}
