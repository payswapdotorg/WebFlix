/**
 * @wfx/app-web — R38-B — THE STUDIO COMMENTS ROUTE
 * (`/studio/comments` — the comments management).
 *
 * The per-video moderation surface: the video picker (the managed
 * channel's own items — the same discovery-derived feed the channel
 * page renders) + the selected video's comment list with
 * hold/review/pin/reply (the CommentsModeration island — the SAME
 * `wfx-comments-v1` store the watch surface renders). The reply
 * composer's gate carries the request's own session truth (the corpus
 * logged-out law — the same input the watch page's comments section
 * consumes).
 *
 * A PRESENTATION ROUTE (the /studio law — see /studio/page.tsx).
 */

import { AppShell } from "@/components/shell/AppShell";
import { StudioChrome } from "@/components/studio/StudioChrome";
import { CommentsModeration } from "@/components/studio/CommentsModeration";
import { EmptyState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadAccountChrome } from "@/host/account-chrome";
import { readRequestSessionView } from "@/host/request-session-view";
import { findStudioItem, resolveStudioChannel } from "@/host/studio-store/studio-views";
import { studioCommentsHref } from "@/app/studio/href";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

/** Read the first value of one route param. */
function firstParam(params: Record<string, string | string[] | undefined>, name: string): string {
  const raw = params[name];
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

export default async function StudioCommentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  const [resolution, account, session] = await Promise.all([
    resolveStudioChannel(host, params),
    loadAccountChrome(),
    readRequestSessionView(host.config),
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

  const view = resolution.view;
  const itemId = firstParam(params, "id");
  const item = findStudioItem(view, itemId);

  return (
    <AppShell mode={host.mode} session={host.session.state} account={account}>
      <StudioChrome view={view} activeSection="comments">
        {/* THE VIDEO PICKER (the channel's own items — real links). */}
        <nav className="wfx-chipbar" aria-label="Videos" data-wfx-studio-comments-picker style={{ marginBottom: "12px" }}>
          <div className="wfx-chipbar__track">
            {view.items.map((candidate) => (
              <a
                key={candidate.itemId}
                className={`wfx-chip${item !== null && item.itemId === candidate.itemId ? " wfx-chip--active" : ""}`}
                href={studioCommentsHref({ channel: view.identity.handle, itemId: candidate.itemId })}
                {...(item !== null && item.itemId === candidate.itemId ? { "aria-current": "page" as const } : {})}
                data-wfx-studio-comments-pick={candidate.itemId}
              >
                {candidate.title}
              </a>
            ))}
          </div>
        </nav>

        {item === null ? (
          <section className="wfx-channel__section" data-wfx-studio-comments-novideo>
            <EmptyState
              title="Pick a video"
              detail="Choose one of the channel's videos above to manage its comments — the list renders this device's own comment record (the same truth the watch surface renders)."
            />
          </section>
        ) : (
          <CommentsModeration
            item={item}
            signedIn={session.signedIn}
            {...(session.profileName !== undefined ? { profileName: session.profileName } : {})}
          />
        )}
      </StudioChrome>
    </AppShell>
  );
}
