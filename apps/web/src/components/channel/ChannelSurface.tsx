/**
 * @wfx/app-web — R36 — THE CHANNEL SURFACE (the YouTube channel-page
 * grammar, honestly bound).
 *
 * THE PAGE GRAMMAR (the survey's row 17 — the corpus channel anatomy):
 * the banner strip (or its typed absence) · the avatar + name + the
 * honest meta line · the Subscribe pill + the bell · the tab bar (Home
 * / Videos / Shorts / Playlists / About) + the channel search field ·
 * the tab's content. Every slot honors the honest laws: the banner is
 * the source's own artwork or the typed absence (never a fabricated
 * image); the avatar is the honest monogram; the subscriber-count slot
 * renders the typed absence + the user's OWN subscription truth (never
 * a fabricated number); the verified badge is source-declared only
 * (none is — the honest absence); the tabs carry real data with real
 * sorting (the honest sort availability — an option without a declared
 * backing never renders); the Playlists tab renders the library's own
 * named lists scoped to this channel (the typed-empty state when
 * none); the About tab renders the description/links/join-date truths
 * (each per the honest law).
 *
 * Server component: pure presentational projection of a `ChannelView`
 * (the derivation law's own output).
 */

import type { JSX } from "react";

import type {
  ChannelItemView,
  ChannelSort,
  ChannelTab,
  ChannelView,
} from "@/host/channel-views";
import {
  CHANNEL_TABS,
  channelPageHref,
  channelTabLabel,
} from "@/host/channel-views";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState } from "@/components/ui/StateViews";
import { formatPlaylistDate } from "@/components/ui/format";
import { ArtworkImage } from "@/components/cards/ArtworkImage";
import { ChannelEngagement } from "@/components/channel/ChannelEngagement";
import { Icon } from "@/components/shell/Icon";

/** The channel's honest meta line under the name (the identity truths). */
function channelMetaLine(view: ChannelView): string {
  const parts: string[] = [`@${view.identity.handle}`];
  // The subscriber-count slot: the user's OWN subscription truth + the
  // typed absence (never a fabricated number).
  parts.push(
    view.subscribed
      ? "Subscribed (you)"
      : view.identity.subscriberCount.kind === "declared"
        ? `${view.identity.subscriberCount.count} subscribers`
        : view.identity.subscriberCount.note,
  );
  // The derived video count (real — derived from the channel's own items).
  parts.push(
    view.stats.videoCount === 1 ? "1 video" : `${view.stats.videoCount} videos`,
  );
  return parts.join(" · ");
}

/** One tab bar link (the active tab carries aria-current). */
function TabLink({
  handle,
  tab,
  activeTab,
  query,
}: {
  readonly handle: string;
  readonly tab: ChannelTab;
  readonly activeTab: ChannelTab;
  readonly query: string | null;
}): JSX.Element {
  const active = tab === activeTab;
  return (
    <a
      className={`wfx-channeltab${active ? " wfx-channeltab--active" : ""}`}
      href={channelPageHref(handle, { tab, ...(query !== null ? { query } : {}) })}
      {...(active ? { "aria-current": "page" as const } : {})}
      data-wfx-channel-tab={tab}
    >
      {channelTabLabel(tab)}
    </a>
  );
}

/** The Videos tab's sort chips (the honest availability — the SearchFilters law). */
function SortChips({
  handle,
  query,
  availability,
  applied,
}: {
  readonly handle: string;
  readonly query: string | null;
  readonly availability: ChannelView["sortAvailability"];
  readonly applied: ChannelSort | null;
}): JSX.Element | null {
  const options: readonly { readonly value: ChannelSort; readonly label: string; readonly backed: boolean }[] = [
    { value: "latest", label: "Latest", backed: availability.latest },
    { value: "popular", label: "Popular", backed: availability.popular },
    { value: "oldest", label: "Oldest", backed: availability.oldest },
  ];
  const anyBacked = options.some((option) => option.backed);
  return (
    <div className="wfx-channelsort" data-wfx-channel-sort>
      {anyBacked ? (
        <div className="wfx-chipbar" data-wfx-channel-sort-chips>
          <div className="wfx-chipbar__track">
            <a
              className={`wfx-chip${applied === null ? " wfx-chip--active" : ""}`}
              href={channelPageHref(handle, { tab: "videos", ...(query !== null ? { query } : {}) })}
              data-wfx-channel-sort-chip="feed"
            >
              Feed order
            </a>
            {options
              .filter((option) => option.backed)
              .map((option) => (
                <a
                  key={option.value}
                  className={`wfx-chip${applied === option.value ? " wfx-chip--active" : ""}`}
                  href={channelPageHref(handle, {
                    tab: "videos",
                    sort: option.value,
                    ...(query !== null ? { query } : {}),
                  })}
                  data-wfx-channel-sort-chip={option.value}
                >
                  {option.label}
                </a>
              ))}
          </div>
        </div>
      ) : null}
      {availability.note.length > 0 ? (
        <p className="wfx-row__reason" data-wfx-channel-sort-note>
          {availability.note}
        </p>
      ) : null}
    </div>
  );
}

/** One tab's item grid (the feed's own card grammar). */
function ChannelItemGrid({
  items,
  variant = "wide",
}: {
  readonly items: readonly ChannelItemView[];
  readonly variant?: "wide" | "short";
}): JSX.Element {
  return (
    <div className="wfx-grid" data-wfx-channel-items>
      {items.map((item) => (
        <ItemCard
          key={item.card.itemId}
          card={item.card}
          {...(variant === "short" ? { variant: "short" } : {})}
          {...(item.resume !== null
            ? {
                resume: {
                  resumePositionMs: item.resume.resumePositionMs,
                  completionRatio: item.resume.completionRatio,
                },
              }
            : {})}
        />
      ))}
    </div>
  );
}

/** The channel surface (one tab's page). */
export function ChannelSurface({ view }: { readonly view: ChannelView }): JSX.Element {
  const identity = view.identity;
  const handle = identity.handle;
  return (
    <div data-wfx-surface="channel" data-wfx-channel={handle} data-wfx-channel-tab={view.tab}>
      {/* THE BANNER STRIP: the source's own artwork (derived art) or the
          typed absence — never a fabricated image. */}
      <div className="wfx-channel__bannerwrap" data-wfx-channel-banner={identity.banner.kind}>
        {identity.banner.kind === "derived-art" ? (
          <>
            <span className="wfx-channel__bannerart" aria-hidden="true">
              <ArtworkImage artwork={identity.banner.artwork} className="wfx-channel__bannerimg" />
            </span>
            <p className="wfx-channel__bannernote">{identity.banner.note}</p>
          </>
        ) : (
          <p className="wfx-channel__bannerabsent" data-wfx-channel-banner-absent>
            {identity.banner.note}
          </p>
        )}
      </div>

      {/* THE HEADER: the monogram avatar + the name + the honest meta
          line + the Subscribe pill + the bell. */}
      <div className="wfx-channel__header">
        <span className="wfx-channel__avatar" aria-hidden="true" data-wfx-channel-avatar title={identity.avatar.note}>
          {identity.avatar.mark}
        </span>
        <div className="wfx-channel__ident">
          <h1 className="wfx-channel__name" data-wfx-channel-name>
            {identity.displayName}
          </h1>
          {/* The verified badge: source-declared only — none is (the
              honest absence, never a fabricated checkmark). */}
          <p className="wfx-channel__meta" data-wfx-channel-meta>
            {channelMetaLine(view)}
          </p>
        </div>
        <ChannelEngagement
          channelName={identity.displayName}
          representative={view.representative}
          initiallySubscribed={view.subscribed}
          subscribedItemIds={view.subscribedItemIds}
        />
      </div>

      {/* THE TAB BAR + THE CHANNEL SEARCH FIELD (the in-channel filter). */}
      <div className="wfx-channel__tabsrow">
        <nav className="wfx-channel__tabs" aria-label="Channel sections" data-wfx-channel-tabs>
          {CHANNEL_TABS.map((tab) => (
            <TabLink key={tab} handle={handle} tab={tab} activeTab={view.tab} query={view.query} />
          ))}
        </nav>
        <form
          className="wfx-channel__search"
          role="search"
          action={`/channel/${handle}`}
          method="get"
          data-wfx-channel-search
        >
          <input type="hidden" name="tab" value={view.tab} />
          <input
            className="wfx-channel__searchinput"
            type="search"
            name="q"
            defaultValue={view.query ?? ""}
            placeholder={`Search ${identity.displayName}`}
            aria-label={`Search this channel (${identity.displayName})`}
            data-wfx-channel-search-input
          />
          <button className="wfx-channel__searchbtn" type="submit" aria-label="Search this channel" data-wfx-channel-search-button>
            <Icon name="search" size={18} />
          </button>
        </form>
      </div>

      {/* The in-channel search disclosure (the honest filtered truth). */}
      {view.query !== null ? (
        <p className="wfx-row__reason" data-wfx-channel-search-note>
          {view.items.length === 0
            ? `Nothing in this channel matches “${view.query}” — WebFlix does not fabricate results.`
            : `${view.items.length} ${view.items.length === 1 ? "match" : "matches"} for “${view.query}” in this channel.`}
          {" "}
          <a href={channelPageHref(handle, { tab: view.tab })}>Clear</a>
        </p>
      ) : null}

      {/* THE TAB CONTENT (real data, real sorting, typed empty states). */}
      {view.tab === "home" ? (
        <section className="wfx-channel__section" aria-label="Channel home" data-wfx-channel-home>
          {view.items.length === 0 ? (
            <EmptyState
              title="No content surfaced yet"
              detail="This channel's items arrive through the same discovery feed every surface reads — nothing is fabricated. Check back after browsing, or open the Videos and Shorts tabs."
            />
          ) : (
            <ChannelItemGrid items={view.items} />
          )}
        </section>
      ) : null}

      {view.tab === "videos" ? (
        <section className="wfx-channel__section" aria-label="Channel videos" data-wfx-channel-videos>
          <SortChips handle={handle} query={view.query} availability={view.sortAvailability} applied={view.sort} />
          {view.items.length === 0 ? (
            <EmptyState
              title="No videos yet"
              detail="This channel surfaces no long-form item in this session — WebFlix does not fabricate a catalog."
            />
          ) : (
            <ChannelItemGrid items={view.items} />
          )}
        </section>
      ) : null}

      {view.tab === "shorts" ? (
        <section className="wfx-channel__section" aria-label="Channel shorts" data-wfx-channel-shorts>
          {view.items.length === 0 ? (
            <EmptyState
              title="No shorts yet"
              detail="This channel surfaces no short-form item in this session — WebFlix does not fabricate a catalog."
            />
          ) : (
            <div className="wfx-shelf" data-wfx-channel-shorts-shelf>
              <ChannelItemGrid items={view.items} variant="short" />
            </div>
          )}
        </section>
      ) : null}

      {view.tab === "playlists" ? (
        <section className="wfx-channel__section" aria-label="Channel playlists" data-wfx-channel-playlists>
          {view.playlists.length === 0 ? (
            <EmptyState
              title="No playlists for this channel yet"
              detail="Your library's named lists land here the moment you save one of this channel's items into them — the same lists the Library page renders (WebFlix does not fabricate playlists)."
            />
          ) : (
            view.playlists.map((list) => (
              <div key={list.name} className="wfx-playlist" data-wfx-channel-playlist={list.name}>
                <div className="wfx-playlist__head">
                  <h3 data-wfx-playlist-name>{list.name}</h3>
                  <p className="wfx-playlist__meta" data-wfx-playlist-meta>
                    {list.entries.length === 1 ? "1 video" : `${list.entries.length} videos`} from this channel ·{" "}
                    <a href="/library">Open in Library</a>
                  </p>
                </div>
                <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
                  {list.entries.map((entry) => (
                    <li key={`${list.name}-${entry.itemId}`} className="wfx-queue__item" data-wfx-watchlist-entry={entry.itemId}>
                      {entry.joined !== null ? (
                        <ItemCard
                          card={{
                            itemId: entry.itemId,
                            title: entry.title,
                            canonicalType: entry.joined.canonicalType,
                            ...(entry.joined.durationMs !== undefined
                              ? { durationMs: entry.joined.durationMs }
                              : {}),
                            connectorId: entry.joined.connectorId,
                            externalRef: entry.joined.externalRef,
                          }}
                        />
                      ) : (
                        <span className="wfx-card" data-wfx-card={entry.itemId}>
                          <span>
                            <p className="wfx-card__title">{entry.title}</p>
                            <p className="wfx-card__meta">Source unknown in this session</p>
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ) : null}

      {view.tab === "about" ? (
        <section className="wfx-channel__section" aria-label="About this channel" data-wfx-channel-about>
          <dl className="wfx-channel__about" data-wfx-channel-about-stats>
            <div className="wfx-channel__aboutrow">
              <dt>Description</dt>
              <dd data-wfx-channel-about-description>
                {identity.description.kind === "declared"
                  ? identity.description.text
                  : identity.description.note}
              </dd>
            </div>
            <div className="wfx-channel__aboutrow">
              <dt>Subscriber count</dt>
              <dd data-wfx-channel-about-subs>
                {identity.subscriberCount.kind === "declared"
                  ? `${identity.subscriberCount.count} subscribers (the source's own declared count)`
                  : identity.subscriberCount.note}
                {view.subscribed ? " You are subscribed (your own truth)." : ""}
              </dd>
            </div>
            <div className="wfx-channel__aboutrow">
              <dt>Connected since</dt>
              <dd data-wfx-channel-about-joined>
                {identity.connectedSince.kind === "declared"
                  ? `${formatPlaylistDate(identity.connectedSince.iso) ?? identity.connectedSince.iso} (this source's own connection date — never a fabricated "Joined" claim)`
                  : identity.connectedSince.note}
              </dd>
            </div>
            <div className="wfx-channel__aboutrow">
              <dt>Links</dt>
              <dd data-wfx-channel-about-links>{identity.links.note}</dd>
            </div>
            <div className="wfx-channel__aboutrow">
              <dt>Verified</dt>
              <dd data-wfx-channel-about-verified>{identity.verifiedBadge.note}</dd>
            </div>
            <div className="wfx-channel__aboutrow">
              <dt>Content</dt>
              <dd data-wfx-channel-about-content>
                {view.stats.videoCount === 1 ? "1 video" : `${view.stats.videoCount} videos`} ·{" "}
                {view.stats.shortsCount === 1 ? "1 short" : `${view.stats.shortsCount} shorts`} ·{" "}
                {view.stats.playlistCount === 1
                  ? "1 playlist in your library"
                  : `${view.stats.playlistCount} playlists in your library`}
                {" "}— counts derived from this channel's own surfaced items (never fabricated).
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/** The honest not-found state (a handle no source owns). */
export function ChannelNotFound({ view }: { readonly view: { readonly handle: string } }): JSX.Element {
  return (
    <div data-wfx-surface="channel" data-wfx-channel-state="not-found">
      <h1 className="wfx-page-title">Channel</h1>
      <EmptyState
        title="No channel owns this handle"
        detail={`No connected source derives the handle “${view.handle}” — WebFlix does not fabricate a channel. Browse the catalog or search for a creator by name.`}
        action={
          <a className="wfx-btn" href="/">
            Browse content
          </a>
        }
      />
    </div>
  );
}
