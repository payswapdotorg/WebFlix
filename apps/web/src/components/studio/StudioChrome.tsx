/**
 * @wfx/app-web — R38-B — THE STUDIO CHROME (the studio header + the
 * section tab bar — a server component, pure presentational).
 *
 * THE STUDIO'S CHANNEL BINDING (the honest framing): the studio manages
 * THE CATALOG'S OWN CHANNEL — the channel R36's page renders (the
 * packet: "Depends on: R36 (the channel the studio customizes + the
 * content list hangs on)"). The header renders the managed channel's
 * derived identity (through the studio view's projection of R36's own
 * derivation) and links to the channel page (the viewer-side truth);
 * the honest note names the binding ("the one channel this WebFlix
 * host's catalog carries" on the fixtures boot) — never a fabricated
 * "your account's channel" claim (no server-side creator identity
 * exists at this base).
 *
 * The tab bar follows the channel page's tab grammar (real links,
 * aria-current on the active section — the corpus active-item law).
 */

import type { JSX } from "react";

import type { StudioChannelView } from "@/host/studio-store/studio-views";
import {
  STUDIO_SECTIONS,
  studioSectionHref,
  studioSectionLabel,
  type StudioSection,
} from "@/app/studio/href";
import { Icon } from "@/components/shell/Icon";

/** One tab bar link (the active section carries aria-current). */
function StudioTabLink({
  section,
  activeSection,
  channelHandle,
}: {
  readonly section: StudioSection;
  readonly activeSection: StudioSection;
  readonly channelHandle: string;
}): JSX.Element {
  const active = section === activeSection;
  return (
    <a
      className={`wfx-channeltab${active ? " wfx-channeltab--active" : ""}`}
      href={studioSectionHref(section, { channel: channelHandle })}
      {...(active ? { "aria-current": "page" as const } : {})}
      data-wfx-studio-tab={section}
    >
      {studioSectionLabel(section)}
    </a>
  );
}

/** The studio chrome: the managed channel's header + the section tabs. */
export function StudioChrome({
  view,
  activeSection,
  children,
}: {
  /** The managed channel's studio view (R36's derivation, projected). */
  readonly view: StudioChannelView;
  /** The active studio section (the tab bar's aria-current truth). */
  readonly activeSection: StudioSection;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="wfx-channel" data-wfx-studio data-wfx-studio-channel={view.identity.handle}>
      {/* THE STUDIO HEADER (the managed channel's derived identity + the viewer-side link). */}
      <div className="wfx-channel__header" data-wfx-studio-header>
        <span
          className="wfx-channel__avatar"
          aria-hidden="true"
          data-wfx-studio-avatar
          title={view.identity.avatarNote}
        >
          {view.identity.avatarMark}
        </span>
        <div className="wfx-channel__ident">
          <h1 className="wfx-channel__name" data-wfx-studio-channel-name>
            Studio
          </h1>
          <p className="wfx-channel__meta" data-wfx-studio-channel-meta>
            <span data-wfx-studio-channel-display-name>{view.identity.displayName}</span>
            {" · "}
            <a
              href={`/channel/${view.identity.handle}`}
              data-wfx-studio-channel-link
              data-wfx-studio-channel-handle-text
            >
              @{view.identity.handle}
            </a>
            {" · "}
            {view.stats.videoCount === 1 ? "1 video" : `${view.stats.videoCount} videos`}
            {" · "}
            {view.stats.shortsCount === 1 ? "1 short" : `${view.stats.shortsCount} shorts`}
          </p>
          <p className="wfx-row__reason" data-wfx-studio-binding-note>
            The studio manages the catalog&apos;s own channel — the one channel this WebFlix
            host&apos;s catalog carries. Studio state (drafts, edits, moderation, customization)
            is WebFlix&apos;s own, stored locally on this device.
          </p>
        </div>
        <span className="wfx-channeleng" data-wfx-studio-badge>
          <span className="wfx-channelbell__button" style={{ cursor: "default" }} aria-hidden="true">
            <Icon name="settings" size={18} />
          </span>
          <span className="wfx-detail__meta">Creator Studio</span>
        </span>
      </div>

      {/* THE SECTION TABS (the channel page's tab grammar). */}
      <div className="wfx-channel__tabsrow">
        <nav className="wfx-channel__tabs" aria-label="Studio sections" data-wfx-studio-tabs>
          {STUDIO_SECTIONS.map((section) => (
            <StudioTabLink
              key={section}
              section={section}
              activeSection={activeSection}
              channelHandle={view.identity.handle}
            />
          ))}
        </nav>
      </div>

      {/* THE SECTION CONTENT. */}
      {children}
    </div>
  );
}
