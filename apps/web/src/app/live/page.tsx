/**
 * @wfx/app-web — R37 — THE LIVE ROUTE (`/live`).
 *
 * The live browse over the ONE runtime: a PRESENTATION ROUTE (the
 * channel-page law — the runtime's navigation `SurfaceId` set is frozen;
 * the live page is a content destination, not a new navigation state).
 * The live view derives through the connector-layer designation over the
 * two honest sources (the search-derived truth + the fixtures' live
 * entries on the fixtures boot); the surface renders, never guessing.
 *
 * Server component, `force-dynamic` for the same environment-law
 * reasons as every feed surface (the bridge status read + the sources
 * read are per-boot truths).
 */

import { AppShell } from "@/components/shell/AppShell";
import { LiveBrowseSurface } from "@/components/live/LiveBrowseSurface";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";

import { loadLiveBrowseView } from "@/components/live/live-views";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const host = await getWebRuntimeHost();
  // The presentation-route law: the live page is a content destination —
  // the runtime's navigation HOLDS the state the user came from (the
  // channel-page's own behavior). `/live` is not in the frozen SurfaceId
  // route table (routing.ts — not this lane's file), so the honest
  // equivalent of the presentation-route sync is to NOT reset the
  // navigation here (a reset to home would misrepresent where the user
  // is; the shell's rail renders no active claim for a destination).
  const [view, account] = await Promise.all([loadLiveBrowseView(host), loadAccountChrome()]);
  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <LiveBrowseSurface view={view} />
    </AppShell>
  );
}
