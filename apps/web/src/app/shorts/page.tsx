/**
 * @wfx/app-web — the Short Feed route (R07).
 *
 * The vertical shorts surface over the ONE runtime: the runtime's shorts
 * model projected into the frozen OS short page, and the CLIENT island
 * (`components/shorts/ShortsFeed`) building the stack through the SAME
 * frozen presenter — one law, two runtimes. A typed shorts-read failure
 * renders the ERROR state (never a fake empty feed). The main region
 * renders flush (the vertical feed owns the viewport).
 */

import { AppShell } from "@/components/shell/AppShell";
import { ShortsFeed } from "@/components/shorts/ShortsFeed";
import { ErrorState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadShortsPayload } from "@/host/shorts";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function ShortsPage() {
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/shorts", {});
  const payload = await loadShortsPayload(host);
  return (
    <AppShell mode={host.mode} active="shorts" session={host.session.state} mainClass="wfx-main--flush">
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
        <ShortsFeed payload={payload} />
      )}
    </AppShell>
  );
}
