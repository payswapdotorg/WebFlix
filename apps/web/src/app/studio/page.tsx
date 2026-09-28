/**
 * @wfx/app-web — R38-B — THE STUDIO ROUTE (`/studio` — the content
 * list).
 *
 * The creator-studio surface over the ONE runtime: the managed channel
 * resolves through the studio view loaders (R36's own read seams — the
 * derivation law), and the content list renders the channel's real
 * published items (the catalog truth) beside this device's own studio
 * records (the client island loads them after mount). A PRESENTATION
 * ROUTE (the /player + /channel law: the runtime's navigation
 * `SurfaceId` set is frozen; the studio page never calls
 * `syncNavigationToRoute`, which is the exact semantic the
 * presentation-route class gives the channel route — the runtime's
 * navigation keeps the state the user came from, achieved without
 * editing the frozen routing adapter).
 *
 * Server component, `force-dynamic` for the same environment-law
 * reasons as every feed surface.
 */

import { AppShell } from "@/components/shell/AppShell";
import { StudioChrome } from "@/components/studio/StudioChrome";
import { ContentTable } from "@/components/studio/ContentTable";
import { EmptyState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth).
import { loadAccountChrome } from "@/host/account-chrome";
import { resolveStudioChannel } from "@/host/studio-store/studio-views";
import { channelHrefOf } from "@/app/href";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  const resolution = await resolveStudioChannel(host, params);
  const account = await loadAccountChrome();

  if (!resolution.ok) {
    return (
      <AppShell mode={host.mode} session={host.session.state} account={account}>
        <div className="wfx-channel" data-wfx-studio data-wfx-studio-notfound>
          <EmptyState
            title="No channel to manage"
            detail={`No catalog source owns the handle '${resolution.view.handle}' on this host — the studio manages the catalog's own channel and never fabricates one. Connect a source in Settings ▸ Sources, then return to the studio.`}
          />
        </div>
      </AppShell>
    );
  }

  const view = resolution.view;
  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <StudioChrome view={view} activeSection="content">
        <ContentTable view={view} />
        <p className="wfx-row__reason" data-wfx-studio-channel-page-link-note>
          The viewer-side truth:{" "}
          <a href={channelHrefOf(view.identity.connectorId)} data-wfx-studio-viewer-link>
            the channel page
          </a>{" "}
          renders the same derived identity this studio manages.
        </p>
      </StudioChrome>
    </AppShell>
  );
}
