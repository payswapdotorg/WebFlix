/**
 * @wfx/app-web — R38-B — THE STUDIO VIDEO ROUTE (`/studio/video` — the
 * details editor).
 *
 * The route carries the /player parameterized grammar (`id`/`connector`/
 * `ref`/`title`/`type` — the ItemRouteTarget law) plus the managed
 * channel. The item resolves among the channel's OWN items (the studio
 * view's published set — the same discovery-derived feed the channel
 * page renders); a video that is not one of the managed channel's items
 * answers the honest typed state — never a guessed edit target.
 *
 * A PRESENTATION ROUTE (the /studio law — see /studio/page.tsx).
 */

import { AppShell } from "@/components/shell/AppShell";
import { StudioChrome } from "@/components/studio/StudioChrome";
import { DetailsEditor } from "@/components/studio/DetailsEditor";
import { EmptyState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadAccountChrome } from "@/host/account-chrome";
import { findStudioItem, resolveStudioChannel } from "@/host/studio-store/studio-views";
import { studioSectionHref } from "@/app/studio/href";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

/** Read the first value of one route param. */
function firstParam(params: Record<string, string | string[] | undefined>, name: string): string {
  const raw = params[name];
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

export default async function StudioVideoPage({
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
            detail={`No catalog source owns the handle '${resolution.view.handle}' on this host — the studio manages the catalog's own channel and never fabricates one.`}
          />
        </div>
      </AppShell>
    );
  }

  const view = resolution.view;
  const itemId = firstParam(params, "id");
  const item = findStudioItem(view, itemId);

  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <StudioChrome view={view} activeSection="content">
        {item === null ? (
          <section className="wfx-channel__section" data-wfx-studio-video-notfound>
            <EmptyState
              title="Not one of this channel's items"
              detail={`The video id '${itemId.slice(0, 40)}' is not in ${view.identity.displayName}'s surfaced items on this host — the studio edits only the managed channel's own catalog items and never fabricates an edit target.`}
            />
            <p className="wfx-row__reason">
              <a href={studioSectionHref("content", { channel: view.identity.handle })} data-wfx-studio-back-to-content>
                Back to the content list
              </a>
            </p>
          </section>
        ) : (
          <DetailsEditor item={item} channelHandle={view.identity.handle} />
        )}
      </StudioChrome>
    </AppShell>
  );
}
