/**
 * @wfx/app-web — the long-form Watch Feed browse route (WFX-051).
 *
 * The WFX-027 experience mode as a browse page: the continue-watching row
 * first (resume beats everything), then the composed browse rows. Server
 * component; `force-dynamic` for the same environment-law reasons as home.
 */

import { AppShell } from "@/components/shell/AppShell";
import { WatchBrowseSurface } from "@/components/watch/WatchBrowseSurface";
import { bootExperienceHost } from "@/host/experience";
import { loadWatchBrowseView } from "@/host/views";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const host = bootExperienceHost();
  const view = await loadWatchBrowseView(host);
  return (
    <AppShell mode={host.mode} active="/watch">
      <WatchBrowseSurface view={view} />
    </AppShell>
  );
}
