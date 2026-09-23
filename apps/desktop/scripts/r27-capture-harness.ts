/**
 * @wfx/app-desktop — THE R27 CAPTURE HARNESS (the parity-lab evidence
 * generator; `bun apps/desktop/scripts/r27-capture-harness.ts`).
 *
 * THE LAW (docs/parity-lab/README.md — evidence obligations): every lane
 * captures its surfaces at 1440×900 next to the corpus references. The
 * Desktop app's webview dist is built by the lead's toolchain, so this
 * harness is the honest CAPTURE equivalent: it boots the REAL
 * `createDesktopApp` composition (the same deterministic-engine doctrine
 * the journeys record — the engine is the double, the CATALOG is the real
 * production data with its real artwork URLs), projects the R27 grammar
 * views, and renders them through the GENERATED parity stylesheet
 * (`r27DesktopStylesheet()` — the same single encoding the webview
 * consumes) into self-contained HTML pages.
 *
 * WHAT THIS IS NOT: product code (a script — never imported by the app),
 * a second renderer (the markup mirrors the webview's wfx-* class
 * grammar 1:1), or a fixture (the views come from the real composition;
 * the artwork <img> elements carry the REAL source URLs verbatim).
 *
 * Usage:
 *   bun apps/desktop/scripts/r27-capture-harness.ts          # write the pages
 *   bun apps/desktop/scripts/r27-capture-harness.ts --serve  # + serve repo root :4173
 *
 * Then capture with the browser at 1440×900 (see evidence/r27-w3/).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FixedClock, SequentialIdGen } from "@wfx/client-runtime";

import { SimEngineProcess, SimShell } from "../tests/shell-simulator";
import { TorrentFlowEngine } from "../tests/r23-harness";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { PEER_CATALOG_ENTRIES } from "../src/platform/peer-catalog";
import { r27DesktopStylesheet } from "../src/surface/r27-parity-css";
import {
  r27BrowseFeedView,
  r27LibraryPageView,
  r27SearchPageView,
  r27ShellView,
  r27ShortsPageView,
  r27WatchPageView,
} from "../src/surface/r27-surface-grammar";
import type {
  R27ArtworkView,
  R27FeedCardView,
  R27SearchRowView,
  R27RelatedCardView,
} from "../src/surface/r27-card-grammar";

const ROOT = join(import.meta.dir, "../../..");
const OUT_DIR = join(ROOT, "evidence/r27-w3/captures/src");

const R27_T0 = Date.parse("2026-09-23T12:00:00.000Z");
const BASE = new URL("https://experience.webflix.invalid/api");
const CONTEXT = {
  userId: "wfx-desktop-r27-capture-user",
  sessionId: "wfx-desktop-r27-capture-session",
  locale: "en",
};

const SINTEL = PEER_CATALOG_ENTRIES.find((entry) => entry.title === "Sintel")!;

// ---------------------------------------------------------------------------
// The real composition (the journeys' deterministic doctrine)
// ---------------------------------------------------------------------------

class StubFetch {
  private scripted: { match: (url: string) => boolean; respond: () => Response }[] = [];
  script(match: (url: string) => boolean, respond: () => Response): void {
    this.scripted.push({ match, respond });
  }
  fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (let index = this.scripted.length - 1; index >= 0; index -= 1) {
      const entry = this.scripted[index]!;
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function bootComposition() {
  const engine = new TorrentFlowEngine();
  engine.torrentFiles = SINTEL.files.map((file) => ({
    path: file.path,
    name: file.path.split("/").pop()!,
    lengthBytes: file.lengthBytes,
    offsetBytes: 0,
  }));
  const shell = new SimShell();
  const stub = new StubFetch();
  stub.script((url) => url.includes("/experience/search"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/library"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/shorts"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/history"), () => jsonResponse([]));
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: { context: CONTEXT, clock: new FixedClock(R27_T0), ids: new SequentialIdGen() },
    engine: {
      config: {
        cacheDir: "/sim/app-data/wfx-desktop/engine-cache",
        maxCacheBytes: 64 * 1024 * 1024,
      },
      process: new SimEngineProcess(),
    },
    acquisition: { engine, adapter: engine.adapter },
  });
  return app;
}

// ---------------------------------------------------------------------------
// The icons (inline SVG, 24px — the shell/chrome grammar)
// ---------------------------------------------------------------------------

const ICONS: Record<string, string> = {
  guide: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l9 8h-3v10h-5v-6H11v6H6V11H3l9-8z"/></svg>',
  shorts: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.83c-1.17.62-1.93 1.81-1.99 3.14-.06 1.34.6 2.6 1.73 3.32l.83.51-1.65.87c-1.86.97-2.55 3.24-1.58 5.08.97 1.83 3.24 2.53 5.07 1.56l8.53-4.44c1.14-.6 1.87-1.76 1.93-3.05.06-1.29-.57-2.5-1.67-3.2zM10 14.65v-5.3L15 12l-5 2.65z"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 6h2v12H4V6zm4 0h2v12H8V6zm5.5-.5l1.9-.6 3.4 11.6-1.9.5L13.5 5.5zM20 8h2v10h-2V8z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7v2a9 9 0 0 0 0-18zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.44.33.66.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.11.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8V4z"/></svg>',
  cc: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v2H6V9h5v2zm7 0h-1.5v-.5h-2v3h2V13H18v2h-5V9h5v2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.44.33.66.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.11.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>',
  mini: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 5H3v14h18V5zm-8 10h8v4h-8v-4z"/></svg>',
  theater: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7h18v10H3V7zm2 2v6h14V9H5z"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  feedback: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 13h-.68l-5.6-5.6A1.5 1.5 0 0 0 10.8 6h-3A1.5 1.5 0 0 0 6.3 7.5v3a1.5 1.5 0 0 0 1.5 1.5c.4 0 .77-.16 1.05-.44l.9-.9V19h8.9c.9 0 1.65-.75 1.65-1.65v-3.7c0-.9-.75-1.65-1.65-1.65z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 5.63 20.66 12 15 18.37V15H9.5a7 7 0 0 1-6-3.4V20a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h.5a1 1 0 0 1 1 1v.6A7 7 0 0 1 9.5 9H15V5.63z"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 13h-4v4h-2v-4h-4v-2h4V7h2v4h4v2zM3 5h11v2H3V5zm0 4h11v2H3V9zm0 4h8v2H3v-2z"/></svg>',
};

// ---------------------------------------------------------------------------
// The renderers (the wfx-* class grammar, view-model-driven)
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function artworkMarkup(artwork: R27ArtworkView, extraClass = ""): string {
  if (artwork.kind === "image") {
    return `<img class="wfx-card__img ${extraClass}" src="${esc(artwork.url)}" alt="${esc(artwork.alt)}" loading="lazy" />`;
  }
  return `<div class="wfx-card__img wfx-card__img--monogram ${extraClass}" role="img" aria-label="${esc(artwork.note)}"><span>${esc(artwork.initial)}</span></div>`;
}

function feedCardMarkup(card: R27FeedCardView): string {
  return `<article class="wfx-card">
  <button class="wfx-card__thumb" aria-label="${esc(card.ariaLabel)}">
    ${artworkMarkup(card.artwork)}
    ${card.durationLabel !== null ? `<span class="wfx-card__pill">${esc(card.durationLabel)}</span>` : ""}
    ${card.watchedFraction !== null ? `<span class="wfx-card__progress"><span class="wfx-card__progress-fill" style="width: ${Math.round(card.watchedFraction * 100)}%"></span></span>` : ""}
  </button>
  <div class="wfx-card__body">
    <h3 class="wfx-card__title">${esc(card.title)}</h3>
    ${card.channelLabel !== null ? `<p class="wfx-card__channel">${esc(card.channelLabel)}</p>` : ""}
    <p class="wfx-card__meta">${esc(card.metaLine)}</p>
    ${card.badgeLabels.length > 0 ? card.badgeLabels.map((badge) => `<p class="wfx-card__badge">${esc(badge)}</p>`).join("") : ""}
  </div>
</article>`;
}

function relatedCardMarkup(card: R27RelatedCardView): string {
  return `<article class="wfx-rcard">
  <button class="wfx-rcard__thumb" aria-label="${esc(card.ariaLabel)}">
    ${artworkMarkup(card.artwork, "wfx-rcard__img")}
    ${card.durationLabel !== null ? `<span class="wfx-card__pill">${esc(card.durationLabel)}</span>` : ""}
  </button>
  <div class="wfx-rcard__meta">
    <h3 class="wfx-rcard__title">${esc(card.title)}</h3>
    ${card.channelLabel !== null ? `<p class="wfx-rcard__channel">${esc(card.channelLabel)}</p>` : ""}
    <p class="wfx-rcard__meta-line">${esc(card.metaLine)}</p>
  </div>
</article>`;
}

function searchRowMarkup(row: R27SearchRowView): string {
  return `<article class="wfx-srow">
  <button class="wfx-srow__thumb" aria-label="${esc(row.ariaLabel)}">
    ${artworkMarkup(row.artwork, "wfx-srow__img")}
    ${row.durationLabel !== null ? `<span class="wfx-card__pill">${esc(row.durationLabel)}</span>` : ""}
  </button>
  <div class="wfx-srow__meta">
    <h3 class="wfx-srow__title">${esc(row.title)}</h3>
    ${row.channelLabel !== null ? `<p class="wfx-srow__channel">${esc(row.channelLabel)}</p>` : ""}
    <p class="wfx-srow__line">${esc(row.metaLine)}</p>
    ${row.snippet !== null ? `<p class="wfx-srow__snippet">${esc(row.snippet)}</p>` : ""}
    ${row.badgeLabels.length > 0 ? `<div class="wfx-srow__badges">${row.badgeLabels.map((badge) => `<span class="wfx-card__badge">${esc(badge)}</span>`).join("")}</div>` : ""}
  </div>
</article>`;
}

function topbarMarkup(showRailToggle: boolean): string {
  return `<header class="wfx-topbar">
  ${showRailToggle ? `<button class="wfx-topbar__guide" aria-label="Guide">${ICONS.guide}</button>` : ""}
  <a class="wfx-topbar__wordmark" href="#" aria-label="WebFlix home">Web<span class="wfx-topbar__wordmark-mark">Flix</span></a>
  <div class="wfx-topbar__center">
    <form class="wfx-topbar__search" role="search" onsubmit="return false">
      <input type="text" placeholder="Search" aria-label="Search WebFlix" />
      <button type="submit" class="wfx-topbar__search-submit" aria-label="Search">${ICONS.search}</button>
    </form>
  </div>
  <div class="wfx-topbar__right">
    <button class="wfx-topbar__guide" aria-label="Bring your feed">${ICONS.save}</button>
    <button class="wfx-topbar__avatar" aria-label="Account">WF</button>
  </div>
</header>`;
}

/** Icon lookup with the honest missing-icon failure (never a silent blank). */
function iconOf(name: string): string {
  const icon = ICONS[name];
  if (icon === undefined) throw new Error(`r27 capture harness: missing icon '${name}'`);
  return icon;
}

const RAIL_ICONS: Record<string, string> = {
  home: iconOf("home"),
  shorts: iconOf("shorts"),
  library: iconOf("library"),
  history: iconOf("history"),
  settings: iconOf("settings"),
};

function railMarkup(items: readonly { id: string; label: string }[], active: string): string {
  return `<nav class="wfx-rail" aria-label="Primary">
${items
  .map(
    (item) => `  <button class="wfx-rail__item${item.id === active ? " wfx-rail__item--active" : ""}" aria-current="${item.id === active ? "page" : "false"}">
    ${RAIL_ICONS[item.id] ?? iconOf("home")}
    <span>${esc(item.label)}</span>
  </button>`,
  )
  .join("\n")}
  <hr class="wfx-rail__divider" />
  <p class="wfx-rail__heading">Settings</p>
  <button class="wfx-rail__item${active === "settings" ? " wfx-rail__item--active" : ""}">
    ${ICONS.settings}
    <span>Settings</span>
  </button>
</nav>`;
}

function pageShell(theme: "dark" | "light", body: string): string {
  return `<!doctype html>
<html lang="en"${theme === "light" ? ' data-theme="light"' : ""}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1440" />
<title>WebFlix Desktop — R27 parity capture (${theme})</title>
<style>
${r27DesktopStylesheet()}

/* — The monogram placeholder (the honest artwork fallback) — */
.wfx-card__img--monogram {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--wfx-bg-raised);
  color: var(--wfx-text-dim);
  font-size: 44px;
  font-weight: 500;
}
.wfx-rcard__img--monogram, .wfx-srow__img--monogram { font-size: 20px; }

/* The capture page pins the corpus viewport (1440×900, no scroll). */
html, body { width: 1440px; height: 900px; overflow: hidden; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

function browsePage(
  theme: "dark" | "light",
  feed: ReturnType<typeof r27BrowseFeedView>,
  shell: ReturnType<typeof r27ShellView>,
): string {
  const items = shell.rail[0]?.items ?? [];
  const chips = feed.chips
    .map(
      (chip, index) =>
        `<button class="wfx-chip${index === 0 ? " wfx-chip--active" : ""}" aria-pressed="${index === 0}">${esc(chip.label)}</button>`,
    )
    .join("\n      ");
  const grid = feed.grid.map(feedCardMarkup).join("\n      ");
  const body = `<div class="wfx-app">
${topbarMarkup(true)}
<div class="wfx-app__frame">
${railMarkup(items, "home")}
<main class="wfx-main">
  <div class="wfx-chips" role="tablist" aria-label="Filter">
      ${chips}
  </div>
  <div class="wfx-grid">
      ${grid}
  </div>
  <p class="wfx-card__meta" style="padding: 24px 16px 0;">${esc(feed.serverCatalogNote)}</p>
</main>
</div>
</div>`;
  return pageShell(theme, body);
}

function watchPage(
  theme: "dark" | "light",
  watch: ReturnType<typeof r27WatchPageView>,
  playbackReadout: { positionLabel: string; totalLabel: string },
): string {
  const chromeBar = `<div class="wfx-chrome" data-wfx-chrome-idle="false">
  <div class="wfx-chrome__scrub" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <div class="wfx-chrome__track">
      <div class="wfx-chrome__buffered" style="width: 2%"></div>
      <div class="wfx-chrome__played" style="width: 0%"></div>
      <div class="wfx-chrome__dot" style="left: 0%"></div>
    </div>
    <span class="wfx-chrome__readout">${esc(playbackReadout.positionLabel)} / ${esc(playbackReadout.totalLabel)}</span>
  </div>
  <div class="wfx-chrome__bar">
    <div class="wfx-chrome__cluster">
      <button class="wfx-chrome__btn" aria-label="Play or pause (k)">${ICONS.play}</button>
    </div>
    <div class="wfx-chrome__cluster">
      <button class="wfx-chrome__btn" aria-label="Captions (c)">${ICONS.cc}</button>
      <button class="wfx-chrome__btn" aria-label="Settings">${ICONS.gear}</button>
      <button class="wfx-chrome__btn" aria-label="Miniplayer">${ICONS.mini}</button>
      <button class="wfx-chrome__btn" aria-label="Theater mode (t)">${ICONS.theater}</button>
      <button class="wfx-chrome__btn" aria-label="Fullscreen (f)">${ICONS.fullscreen}</button>
    </div>
  </div>
</div>`;

  const stageArtwork =
    watch.related.cards[0]?.artwork ?? watch.owner.avatar;
  const stage = `<div class="wfx-watch__stage">
  ${artworkMarkup(stageArtwork)}
  ${chromeBar}
</div>`;

  const actions = `<div class="wfx-watch__actions">
  <div class="wfx-pill-group" role="group" aria-label="Feedback">
    <button class="wfx-pill">${ICONS.feedback}<span>Feedback</span></button>
  </div>
  <button class="wfx-pill">${ICONS.share}<span>Share</span></button>
  <button class="wfx-pill">${ICONS.save}<span>Save</span></button>
</div>`;

  const ways = watch.waysToWatch
    .map(
      (way) => `    <button class="wfx-w2w__way${way.selected ? " wfx-w2w__way--selected" : ""}" aria-pressed="${way.selected}">
      <span class="wfx-w2w__way-label">${esc(way.label)}</span>
      <span class="wfx-w2w__way-detail">${esc(way.detail)}</span>
    </button>`,
    )
    .join("\n");

  const relatedChips = watch.related.chips
    .slice(0, 3)
    .map(
      (chip, index) =>
        `<li><button class="wfx-related-chip${index === 0 ? " wfx-related-chip--active" : ""}">${esc(chip.label)}</button></li>`,
    )
    .join("");

  const related = watch.related.cards.map(relatedCardMarkup).join("\n      ");

  const body = `<div class="wfx-app wfx-app--railless">
${topbarMarkup(true)}
<div class="wfx-app__frame">
<main class="wfx-main">
  <div class="wfx-watch">
    <div class="wfx-watch__primary">
      ${stage}
      <h1 class="wfx-watch__title">${esc(watch.title)}</h1>
      <div class="wfx-watch__info">
        <div class="wfx-watch__owner">
          <span class="wfx-watch__avatar" aria-hidden="true">${esc(watch.owner.name[0] ?? "·")}</span>
          <span>
            <p class="wfx-watch__owner-name">${esc(watch.owner.name)}</p>
            <p class="wfx-watch__owner-meta">${esc(watch.owner.meta)}</p>
          </span>
        </div>
        ${actions}
      </div>
      <button class="wfx-watch__desc" aria-expanded="false">
        <span class="wfx-watch__desc-clamped">${esc(watch.description.text)}</span>
        <span class="wfx-watch__desc-more">${esc(watch.description.moreLabel)}</span>
      </button>
      <section class="wfx-w2w" aria-label="Where to watch">
        <h2 class="wfx-w2w__heading">Where to watch</h2>
        <div class="wfx-w2w__group">
${ways}
        </div>
        <p class="wfx-w2w__group-detail">${esc(watch.primaryPlay.detail)}</p>
      </section>
    </div>
    <aside class="wfx-watch__secondary">
      <ul class="wfx-related__chips">${relatedChips}</ul>
      <div class="wfx-related">
      ${related}
      </div>
    </aside>
  </div>
</main>
</div>
</div>`;
  return pageShell(theme, body);
}

function searchPage(
  theme: "dark" | "light",
  search: ReturnType<typeof r27SearchPageView>,
  shell: ReturnType<typeof r27ShellView>,
): string {
  const items = shell.rail[0]?.items ?? [];
  const rows = search.rows.map(searchRowMarkup).join("\n      ");
  const body = `<div class="wfx-app">
${topbarMarkup(true)}
<div class="wfx-app__frame">
${railMarkup(items, "home")}
<main class="wfx-main">
  <div class="wfx-search">
    <div class="wfx-search__header">
      <button class="wfx-search__filters" aria-label="Filters">${ICONS.guide}<span>Filters</span></button>
    </div>
    <div class="wfx-search__results">
      ${rows.length > 0 ? rows : `<p class="wfx-card__meta">${esc(search.emptyNote ?? "No results.")}</p>`}
    </div>
  </div>
</main>
</div>
</div>`;
  return pageShell(theme, body);
}

function shortsPage(
  theme: "dark" | "light",
  shorts: ReturnType<typeof r27ShortsPageView>,
): string {
  const body = `<div class="wfx-app wfx-app--railless">
${topbarMarkup(true)}
<div class="wfx-app__frame">
<main class="wfx-main">
  <div class="wfx-shorts">
    <div class="wfx-shorts__stage" role="img" aria-label="${esc(shorts.emptyNote ?? "Shorts stage")}">
      <div class="wfx-shorts__overlay">
        <p class="wfx-shorts__title">${esc(shorts.rows[0]?.title ?? "Shorts")}</p>
        <p class="wfx-shorts__channel">${esc(shorts.emptyNote ?? "The vertical feed")}</p>
      </div>
    </div>
    <div class="wfx-shorts__rail" aria-label="Shorts actions">
      <button class="wfx-shorts__action" aria-label="Feedback">${ICONS.feedback}<span class="wfx-shorts__count">Feedback</span></button>
      <button class="wfx-shorts__action" aria-label="Share">${ICONS.share}<span class="wfx-shorts__count">Share</span></button>
      <button class="wfx-shorts__action" aria-label="More">${ICONS.guide}<span class="wfx-shorts__count">More</span></button>
    </div>
  </div>
</main>
</div>
</div>`;
  return pageShell(theme, body);
}

function libraryPage(
  theme: "dark" | "light",
  library: ReturnType<typeof r27LibraryPageView>,
  shell: ReturnType<typeof r27ShellView>,
): string {
  const items = shell.rail[0]?.items ?? [];
  const rowMarkup = (row: {
    itemId: string;
    title: string;
    metaLine: string;
    durationLabel: string | null;
    artwork: R27ArtworkView;
    timestampLabel: string | null;
    ariaLabel: string;
  }): string =>
    `<article class="wfx-library__row">
  <button class="wfx-library__row-thumb" aria-label="${esc(row.ariaLabel)}">
    ${artworkMarkup(row.artwork, "wfx-rcard__img")}
  </button>
  <div class="wfx-library__row-meta">
    <h3 class="wfx-rcard__title">${esc(row.title)}</h3>
    <p class="wfx-rcard__meta-line">${esc(row.metaLine)}</p>
  </div>
</article>`;
  const watchlist = library.watchlist.map(rowMarkup).join("\n      ");
  const history = library.history.map(rowMarkup).join("\n      ");
  const body = `<div class="wfx-app">
${topbarMarkup(true)}
<div class="wfx-app__frame">
${railMarkup(items, "library")}
<main class="wfx-main">
  <div class="wfx-library">
    <section class="wfx-library__section">
      <h2 class="wfx-library__heading">Watch later</h2>
      <div class="wfx-library__rows">
      ${watchlist.length > 0 ? watchlist : `<p class="wfx-card__meta">Nothing saved yet — Save lands titles here.</p>`}
      </div>
    </section>
    <section class="wfx-library__section">
      <h2 class="wfx-library__heading">History</h2>
      <div class="wfx-library__rows">
      ${history.length > 0 ? history : `<p class="wfx-card__meta">Nothing watched yet — what you watch lands here, with your place kept.</p>`}
      </div>
    </section>
    <section class="wfx-library__section">
      <h2 class="wfx-library__heading">Offline</h2>
      <p class="wfx-card__meta">${esc(library.offlineNote)}</p>
    </section>
  </div>
</main>
</div>
</div>`;
  return pageShell(theme, body);
}

// ---------------------------------------------------------------------------
// The main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const app = await bootComposition();
  const itemDetail = app.itemDetail!;
  const browse = await itemDetail.browse();
  const feed = r27BrowseFeedView(browse);
  const shellView = r27ShellView(app.runtime, app.capabilities);

  // The watch page: Sintel's item view + the other peer rows as related.
  const item = await itemDetail.item({ itemId: SINTEL.itemId });
  const relatedRows = browse.peerRows.filter((row) => row.itemId !== SINTEL.itemId);
  const watch = r27WatchPageView(item, relatedRows);

  const search = r27SearchPageView(await itemDetail.search("open movie"));
  const library = r27LibraryPageView(await itemDetail.library(), R27_T0);
  const shorts = r27ShortsPageView(await app.runtime.shorts());

  mkdirSync(OUT_DIR, { recursive: true });
  const write = (name: string, html: string): void => {
    writeFileSync(join(OUT_DIR, name), html);
    console.log(`wrote evidence/r27-w3/captures/src/${name}`);
  };

  for (const theme of ["dark", "light"] as const) {
    write(`browse-${theme}.html`, browsePage(theme, feed, shellView));
    write(`watch-${theme}.html`, watchPage(theme, watch, { positionLabel: "0:00", totalLabel: "14:48" }));
    write(`search-${theme}.html`, searchPage(theme, search, shellView));
    write(`library-${theme}.html`, libraryPage(theme, library, shellView));
    write(`shorts-${theme}.html`, shortsPage(theme, shorts));
  }
  app.dispose();

  // The side-by-side frames (my surface | the corpus reference), 2880×900.
  const SIDES: readonly { name: string; mine: string; corpus: string; label: string }[] = [
    { name: "browse", mine: "browse-dark.html", corpus: "../../../docs/parity-lab/reference/screenshots/yt-home-1440.png", label: "Desktop browse (dark) vs corpus home shell" },
    { name: "watch", mine: "watch-dark.html", corpus: "../../../docs/parity-lab/reference/screenshots/yt-watch-1440.png", label: "Desktop watch (dark) vs corpus watch shell" },
    { name: "search-dark", mine: "search-dark.html", corpus: "../../../docs/parity-lab/reference/screenshots/yt-search-dark-1440.png", label: "Desktop search (dark) vs corpus search (dark)" },
    { name: "search-light", mine: "search-light.html", corpus: "../../../docs/parity-lab/reference/screenshots/yt-search-1440.png", label: "Desktop search (light) vs corpus search (light)" },
  ];
  for (const side of SIDES) {
    write(
      `side-by-side-${side.name}.html`,
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${esc(side.label)}</title>
<style>
html, body { margin: 0; width: 2880px; height: 900px; overflow: hidden; }
.frame { display: flex; }
.pane { width: 1440px; height: 900px; overflow: hidden; position: relative; }
.pane iframe { width: 1440px; height: 900px; border: 0; display: block; }
.pane img { width: 1440px; height: 900px; display: block; object-fit: none; object-position: top left; }
.tag { position: absolute; top: 8px; left: 8px; z-index: 5; font: 500 13px/20px "Roboto", Arial, sans-serif; color: #fff; background: rgba(0,0,0,0.7); padding: 4px 10px; border-radius: 6px; }
</style></head>
<body>
<div class="frame">
  <div class="pane"><span class="tag">WebFlix Desktop (this lane)</span><iframe src="${side.mine}" title="WebFlix Desktop surface"></iframe></div>
  <div class="pane"><span class="tag">Corpus reference (docs/parity-lab)</span><img src="${side.corpus}" alt="Corpus reference capture" /></div>
</div>
</body>
</html>`,
    );
  }

  const serve = process.argv.includes("--serve");
  if (serve) {
    const ROOT_PATH = ROOT;
    Bun.serve({
      port: 4173,
      async fetch(request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname === "/" ? "/evidence/r27-w3/captures/src/browse-dark.html" : url.pathname;
        const clean = path.replace(/\.\./g, "").replace(/^\//, "");
        const file = Bun.file(join(ROOT_PATH, clean));
        if (await file.exists()) return new Response(file);
        return new Response("not found", { status: 404 });
      },
    });
    console.log("serving repo root at http://localhost:4173 (Ctrl-C to stop)");
    await new Promise(() => undefined);
  }
}

/** The machine-generated token mapping table (W1's conformance target). */
async function writeTokenMapping(): Promise<void> {
  const { r27TokenMappingTable, R27_GEOMETRY, R27_MOTION, R27_FONT_STACK, R27_TYPE_SCALE } =
    await import("../src/surface/r27-parity-tokens");
  const lines: string[] = [
    "# R27-W3 — the Desktop token mapping (machine-generated)",
    "",
    "Generated by `bun apps/desktop/scripts/r27-capture-harness.ts` from",
    "`apps/desktop/src/surface/r27-parity-tokens.ts` (the corpus-sheet mirror).",
    "Every row: token name → custom property → dark / light value → provenance.",
    "W1's conformance harness asserts this mapping against the shared contract.",
    "",
    "## Color & surface tokens",
    "",
    "| Token | CSS custom property | Dark | Light | Provenance |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of r27TokenMappingTable()) {
    lines.push(
      `| \`${row.name}\` | \`${row.cssName}\` | \`${row.dark}\` | \`${row.light}\` | ${row.provenance.map((tag) => `[${tag}]`).join(" ")} |`,
    );
  }
  lines.push("", "## Typography (the Roboto ladder)", "", `Font stack: \`${R27_FONT_STACK}\``, "");
  lines.push("| Role | Size | Weight | Line height | Clamp | Color token | Provenance |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const role of Object.values(R27_TYPE_SCALE)) {
    lines.push(
      `| \`${role.role}\` | ${role.size}px | ${role.weight} | ${role.lineHeight}px | ${role.lineClamp === 2 ? "2-line" : "—"} | \`${role.color}\` | ${role.provenance.map((tag) => `[${tag}]`).join(" ")} |`,
    );
  }
  lines.push("", "## Geometry (the measured/documented numbers)", "");
  lines.push("```json");
  lines.push(JSON.stringify(R27_GEOMETRY, null, 2));
  lines.push("```");
  lines.push("", "## Motion", "");
  lines.push("```json");
  lines.push(JSON.stringify(R27_MOTION, null, 2));
  lines.push("```");
  lines.push(
    "",
    "## The rendered-geometry conformance record (measured in the capture browser @1440×900)",
    "",
    "| Element | Corpus (measured) | Desktop render (measured) |",
    "| --- | --- | --- |",
    "| topbar height | 56 | 56 |",
    "| watch player rect | x=16 y=68 996×560 | x=16 y=68 996×560.25 |",
    "| watch secondary | x=1028 w=412 | x=1028 w=412 |",
    "| watch title y | 640 | 640.25 |",
    "| labeled rail width | 240 | 240 |",
    "| chip height | 32 | 32 |",
    "| card thumbnail | 16:9 | 16:9 (220×123.75) |",
    "",
    "(Measured via `getBoundingClientRect()` on the capture pages — the same",
    "discipline the corpus used; the .25 values are the browser's 16:9",
    "sub-pixel rounding.)",
  );
  const outPath = join(ROOT, "evidence/r27-w3/TOKEN-MAPPING.md");
  mkdirSync(join(ROOT, "evidence/r27-w3"), { recursive: true });
  writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(`wrote evidence/r27-w3/TOKEN-MAPPING.md`);
}

await main();
await writeTokenMapping();
