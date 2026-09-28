/**
 * @wfx/app-web — the long-form Watch browse route (R07).
 *
 * The watch surface over the ONE runtime: the navigation state synced to
 * `/watch`, the browse rows from the runtime's search models (typed
 * statuses), rendered server-side. `force-dynamic` for the same
 * environment-law reasons as home.
 *
 * R37 — THE LIVE MODE (the additive branch): when the URL names an item
 * (`?connector&ref&title&type` — the /item param grammar), the page
 * loads the LIVE WATCH VIEW instead: an item whose connector metadata
 * declares a live designation renders the live watch composition (the
 * stage + the current live chat over the WS seam, or the chat replay on
 * an archived live VOD); a non-live item renders the honest not-live
 * state with the one-click player link (the no-dead-end law). WITHOUT
 * item params the DEFAULT BROWSE renders — byte-compatible for
 * non-live visits (the branch is a param-gated early return before the
 * browse loads).
 */

import { AppShell } from "@/components/shell/AppShell";
import { WatchBrowseSurface } from "@/components/watch/WatchBrowseSurface";
import { LiveWatchSurface } from "@/components/watch/LiveWatchSurface";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";

import { loadWatchBrowseView } from "@/host/view-models";
// R37 — the live watch view (the live-mode composition's truth).
import { loadLiveWatchView } from "@/components/live/live-views";
import { loadDiscoveryBundle } from "@/host/discoverability";
// R35 (C2) — the request's carried session-intent objectives (the
// session-intent cookie; the discovery read merges them so the SSR
// bundle reflects the session intent on this cold instance too).
import { readRequestSessionIntents } from "@/host/request-session-intents";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  // R30-B — the account chrome view (every branch's shell carries the
  // corpus logged-in chrome; the request's sign-in truth).
  const account = await loadAccountChrome();

  // ---- R37 — THE LIVE MODE BRANCH (param-gated; the default browse is
  //      byte-compatible when no item params name an item). ---------------
  const liveConnector = firstParam(params.connector);
  const liveRef = firstParam(params.ref);
  if (liveConnector.length > 0 && liveRef.length > 0) {
    // The navigation sync (the watch surface — the route's own state).
    syncNavigationToRoute(host.runtime, "/watch", {});
    const view = await loadLiveWatchView(host, {
      connectorId: liveConnector,
      externalRef: liveRef,
      ...(firstParam(params.title).length > 0 ? { title: firstParam(params.title) } : {}),
      ...(firstParam(params.type).length > 0 ? { canonicalType: firstParam(params.type) } : {}),
    });
    return (
      <AppShell mode={host.mode} active="watch" session={host.session.state} account={account}>
        <LiveWatchSurface view={view} />
      </AppShell>
    );
  }

  // ---- THE DEFAULT BROWSE (unchanged — the byte-compatible branch). -----
  syncNavigationToRoute(host.runtime, "/watch", {});
  const [view, discovery] = await Promise.all([
    loadWatchBrowseView(host),
    loadDiscoveryBundle(host, { requestCarriedIntents: await readRequestSessionIntents() }),
  ]);
  return (
    <AppShell mode={host.mode} active="watch" session={host.session.state} account={account}>
      <WatchBrowseSurface view={view} discovery={discovery} />
    </AppShell>
  );
}
