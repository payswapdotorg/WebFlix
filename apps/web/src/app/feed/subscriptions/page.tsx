/**
 * @wfx/app-web — the subscriptions-feed route (R31 §G2 — GAP-CORPUS.md,
 * docs/parity-lab/r30/gap-captures/20260926-052954: the healthy
 * subscriptions-feed grid, the corpus URL /feed/subscriptions).
 *
 * The feed destination over the ONE runtime: the SAME stored
 * Subscriptions truth the rail's Subscriptions section and the Library's
 * Subscriptions list render (the R30-A `hydrate()` seam's fold, read
 * through the account chrome view — NEVER a new source), projected as
 * the captured browse grid. A PRESENTATION ROUTE (the /player law: the
 * runtime's navigation `SurfaceId` set is frozen — the subscriptions
 * feed is a library-truth content surface, not a new navigation state;
 * the rail's Subscriptions section heading carries the destination).
 *
 * Server component, `force-dynamic` for the same environment-law
 * reasons as every feed surface.
 */

import { AppShell } from "@/components/shell/AppShell";
import { SubscriptionsFeedSurface } from "@/components/discovery/SubscriptionsFeedSurface";
import { getWebRuntimeHost } from "@/host/web-host";
// The SAME loader the shell's account chrome uses — the rail
// subscriptions and this grid are ONE truth (the R30-A hydrate seam).
import { loadAccountChrome } from "@/host/account-chrome";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function SubscriptionsFeedPage() {
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/feed/subscriptions", {});
  const account = await loadAccountChrome();
  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <SubscriptionsFeedSurface entries={account.railSubscriptions} />
    </AppShell>
  );
}
