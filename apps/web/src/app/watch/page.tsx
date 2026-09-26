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
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";

import { loadWatchBrowseView } from "@/host/view-models";
import { loadDiscoveryBundle } from "@/host/discoverability";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/watch", {});
  const [view, discovery, account] = await Promise.all([
    loadWatchBrowseView(host),
    loadDiscoveryBundle(host),
    loadAccountChrome(),
  ]);
  return (
    <AppShell mode={host.mode} active="watch" session={host.session.state} account={account}>
      <WatchBrowseSurface view={view} discovery={discovery} />
    </AppShell>
  );
}
