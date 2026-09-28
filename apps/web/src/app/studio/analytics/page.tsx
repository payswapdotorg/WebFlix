/**
 * @wfx/app-web — R38-B — THE STUDIO ANALYTICS ROUTE
 * (`/studio/analytics` — the reach/engagement/audience panels, per
 * video + channel).
 *
 * The server loads the per-item truths its own seams carry (the
 * channel view + the library saves — the runtime's own read); the
 * island loads this device's local truths (comments, reactions) after
 * mount and composes the honest panels (the honest-analytics law —
 * every metric without real backing renders its typed absence).
 *
 * A PRESENTATION ROUTE (the /studio law — see /studio/page.tsx).
 */

import { AppShell } from "@/components/shell/AppShell";
import { StudioChrome } from "@/components/studio/StudioChrome";
import { AnalyticsPanels } from "@/components/studio/AnalyticsPanels";
import { EmptyState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadAccountChrome } from "@/host/account-chrome";
import { loadStudioAnalyticsTruths } from "@/host/studio-store/studio-views";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

export default async function StudioAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  const [loaded, account] = await Promise.all([
    loadStudioAnalyticsTruths(host, params),
    loadAccountChrome(),
  ]);

  if (!loaded.ok) {
    return (
      <AppShell mode={host.mode} session={host.session.state} account={account}>
        <div className="wfx-channel" data-wfx-studio data-wfx-studio-notfound>
          <EmptyState
            title="No channel to manage"
            detail={`No catalog source owns the handle '${loaded.view.handle}' on this host — the studio manages the catalog's own channel and never fabricates one.`}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <StudioChrome view={loaded.truths.channel} activeSection="analytics">
        <AnalyticsPanels channel={loaded.truths.channel} saves={loaded.truths.saves} />
      </StudioChrome>
    </AppShell>
  );
}
