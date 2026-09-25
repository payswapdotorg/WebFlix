/**
 * @wfx/app-web — the Short Feed route (R07; R21-D controls).
 *
 * The vertical shorts surface over the ONE runtime: the runtime's shorts
 * model projected into the frozen OS short page, and the CLIENT island
 * (`components/shorts/ShortsFeed`) building the stack through the SAME
 * frozen presenter — one law, two runtimes. A typed shorts-read failure
 * renders the ERROR state (never a fake empty feed). The main region
 * renders flush (the vertical feed owns the viewport).
 *
 * R21-D — the compact discovery overlay: the feed-mode + Personalize
 * controls float over the feed's top edge (quiet until invoked; the
 * everyday session changes never force a Settings trip).
 */

import { AppShell } from "@/components/shell/AppShell";
import { ShortsFeed } from "@/components/shorts/ShortsFeed";
import { CompactDiscoveryControls } from "@/components/discovery/DiscoveryHeader";
import { ErrorState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";

import { loadShortsPayload } from "@/host/shorts";
import { loadDiscoveryBundle } from "@/host/discoverability";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function ShortsPage() {
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/shorts", {});
  const [payload, discovery, account] = await Promise.all([
    loadShortsPayload(host),
    loadDiscoveryBundle(host),
    loadAccountChrome(),
  ]);
  return (
    <AppShell mode={host.mode} active="shorts" session={host.session.state} account={account} mainClass="wfx-main--flush">
      {payload.loadError !== null ? (
        <div data-wfx-surface="shorts" data-wfx-shorts-state="error">
          <ErrorState
            title="The short feed could not load"
            detail={`${payload.loadError.kind}: ${payload.loadError.detail} — WebFlix does not fabricate a feed.`}
            retry={
              <a className="wfx-btn" href="/shorts">
                Retry
              </a>
            }
          />
        </div>
      ) : (
        <div className="wfx-shorts-shell">
          <div className="wfx-shorts__discovery" data-wfx-shorts-discovery>
            <CompactDiscoveryControls bundle={discovery} surface="shorts" />
          </div>
          <ShortsFeed payload={payload} />
        </div>
      )}
    </AppShell>
  );
}
