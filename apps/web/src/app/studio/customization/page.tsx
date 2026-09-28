/**
 * @wfx/app-web — R38-B — THE STUDIO CUSTOMIZATION ROUTE
 * (`/studio/customization` — the banner/avatar/handle/description
 * editors).
 *
 * The server renders R36's derived base identity (the studio view's
 * projection of `loadChannelView` — the same read surface the channel
 * page renders); the island loads this device's persisted profile edit
 * after mount and composes the live preview through the domain-graph
 * seam's pure overlay. The writes persist through the studio profile
 * store (the graph seam's own records).
 *
 * A PRESENTATION ROUTE (the /studio law — see /studio/page.tsx).
 */

import { AppShell } from "@/components/shell/AppShell";
import { StudioChrome } from "@/components/studio/StudioChrome";
import { ChannelCustomization } from "@/components/studio/ChannelCustomization";
import { EmptyState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadAccountChrome } from "@/host/account-chrome";
import { resolveStudioChannel } from "@/host/studio-store/studio-views";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

export default async function StudioCustomizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  const [resolution, account] = await Promise.all([
    resolveStudioChannel(host, params),
    loadAccountChrome(),
  ]);

  if (!resolution.ok) {
    return (
      <AppShell mode={host.mode} session={host.session.state} account={account}>
        <div className="wfx-channel" data-wfx-studio data-wfx-studio-notfound>
          <EmptyState
            title="No channel to manage"
            detail={`No catalog source owns the handle '${resolution.view.handle}' on this host — the studio manages the catalog's own channel and never fabricates one.`}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <StudioChrome view={resolution.view} activeSection="customization">
        <ChannelCustomization view={resolution.view} />
      </StudioChrome>
    </AppShell>
  );
}
