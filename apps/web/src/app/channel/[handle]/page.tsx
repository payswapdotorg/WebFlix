/**
 * @wfx/app-web — R36 — THE CHANNEL ROUTE (`/channel/[handle]`).
 *
 * The creator-channel surface over the ONE runtime: the handle resolves
 * through the channel directory (the sources model's own rows — the
 * derivation law), the page renders the channel identity + the tab's
 * real content, and the Subscribe pill writes the SAME Subscriptions
 * library list every subscribe surface uses. A PRESENTATION ROUTE (the
 * /player + /feed/subscriptions law: the runtime's navigation
 * `SurfaceId` set is frozen; the channel page is a content destination,
 * not a new navigation state).
 *
 * Server component, `force-dynamic` for the same environment-law
 * reasons as every feed surface.
 */

import { AppShell } from "@/components/shell/AppShell";
import { ChannelSurface, ChannelNotFound } from "@/components/channel/ChannelSurface";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";

import { loadChannelView, type ChannelSort, type ChannelTab } from "@/host/channel-views";
import { syncNavigationToRoute } from "@/app/routing";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

/** The tab vocabulary's honest read (anything else keeps the Home tab). */
function tabOf(raw: string | string[] | undefined): ChannelTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "videos" || value === "shorts" || value === "playlists" || value === "about"
    ? value
    : "home";
}

/** The sort vocabulary's honest read (anything else keeps the feed order). */
function sortOf(raw: string | string[] | undefined): ChannelSort | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "latest" || value === "popular" || value === "oldest" ? value : undefined;
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ readonly handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  const host = await getWebRuntimeHost();
  // The presentation-route law: the channel page is a content
  // destination (the runtime's navigation holds the state the user came
  // from — exactly the /player law).
  syncNavigationToRoute(host.runtime, `/channel/${handle}`, {});
  const rawQuery = Array.isArray(query.q) ? query.q[0] : query.q;
  const sort = sortOf(query.sort);
  const view = await loadChannelView(host, handle, {
    tab: tabOf(query.tab),
    ...(rawQuery !== undefined && rawQuery.trim().length > 0 ? { query: rawQuery } : {}),
    ...(sort !== undefined ? { sort } : {}),
  });
  const account = await loadAccountChrome();
  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      {"identity" in view ? <ChannelSurface view={view} /> : <ChannelNotFound view={view} />}
    </AppShell>
  );
}
