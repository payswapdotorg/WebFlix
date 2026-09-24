#!/usr/bin/env bun
// R29-C STAGE-1 CLAIM PROBE — the dedicated instrument for B's first push
// (wfx/r29/web @ 7ade74e: "the watch page's second act"). Every check is
// keyed to B's OWN data-attribute hooks (the shipped instrumentation) and
// to the corpus citations in docs/parity-lab/r28/youtube/watch-page-anatomy.md.
// A claim is VERIFIED only when THIS probe reproduces it LIVE; honesty
// gates (the reactions local-truth law, the Subscribe real-write law) are
// checked by INTERACTION, not by presence.
// Usage: bun evidence/r29-recon/r29-s1probe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r29-recon/${TAG}.s1probe.json`);

const ab = async (...args: (string | number)[]): Promise<string> => {
  const p = await $`agent-browser ${args.map(String)}`.nothrow().quiet();
  return p.stdout.toString().trim();
};
const evalJS = async (js: string): Promise<any> => {
  const out = await ab("eval", js);
  try { return JSON.parse(out); } catch { return out; }
};
const open = async (url: string) => { await ab("open", url); await ab("wait", "--load", "networkidle"); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const shot = (name: string) => ab("screenshot", resolve(`evidence/r29-recon/${TAG}-${name}.png`));

await ab("set", "viewport", 1440, 900);
const report: any = { tag: TAG, base: BASE, at: new Date().toISOString(), checks: {} };

// ── navigate to a watch page (the first card on home) ──────────────────────
await open(`${BASE}/`);
const watchHref = await evalJS(`(() => {
  const a = document.querySelector('main a[href*="/player"]');
  return a ? a.getAttribute('href') : null;
})()`);
report.checks.entry = { watchHref };
const watchUrl = watchHref ? (watchHref.startsWith("http") ? watchHref : BASE + watchHref) : `${BASE}/player`;
await open(watchUrl);
await sleep(2000);
await shot("watch-second-act");

// ═══════════════════════════════════════════════════════════════════════════
// S1-1 THE WATCH ACTION ROW (N9-a) — the split pill + Share + Save + kebab
//     + the REACTIONS LOCAL-TRANSPORT HONESTY GATE
// ═══════════════════════════════════════════════════════════════════════════
report.checks.actionRow = await evalJS(`(() => {
  const row = document.querySelector('[data-wfx-watch-actions], .wfx-actions');
  if (!row) return { found: false };
  const rb = row.getBoundingClientRect();
  const seg = row.querySelector('.wfx-actions__segmented');
  const sb = seg ? seg.getBoundingClientRect() : null;
  const ss = seg ? getComputedStyle(seg) : null;
  const divider = row.querySelector('.wfx-actions__divider');
  const like = row.querySelector('[data-wfx-action="like"]');
  const dislike = row.querySelector('[data-wfx-action="dislike"]');
  const share = [...row.querySelectorAll('button, [role=button], a')].find(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  const save = [...row.querySelectorAll('button, [role=button], a')].find(e => /^save\\b|watchlist/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  const kebab = row.querySelector('[data-wfx-watch-kebab]');
  const download = [...row.querySelectorAll('button, [role=button], a, summary')].find(e => /download/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  return {
    found: true,
    rowBox: Math.round(rb.width) + 'x' + Math.round(rb.height),
    splitPill: sb ? { box: Math.round(sb.width) + 'x' + Math.round(sb.height), radius: ss.borderRadius, height: Math.round(sb.height) } : null,
    divider: !!divider,
    likeBtn: like ? { box: Math.round(like.getBoundingClientRect().width) + 'x' + Math.round(like.getBoundingClientRect().height), reaction: like.getAttribute('data-wfx-reaction'), pressed: like.getAttribute('aria-pressed') } : null,
    dislikeBtn: dislike ? { reaction: dislike.getAttribute('data-wfx-reaction') } : null,
    sharePill: share ? { label: (share.getAttribute('aria-label') || share.textContent || '').trim().slice(0, 40) } : null,
    savePill: save ? { label: (save.getAttribute('aria-label') || save.textContent || '').trim().slice(0, 40) } : null,
    kebab: kebab ? { open: kebab.open } : null,
    downloadControl: download ? (download.getAttribute('aria-label') || download.textContent || '').trim().slice(0, 40) : null,
    freshLikeCount: like ? like.querySelector('[data-wfx-like-count]')?.textContent ?? null : null,
    preExistingStore: localStorage.getItem('wfx-reactions-v1'),
  };
})()`);

// THE REACTIONS HONESTY GATE — click LIKE: count must show EXACTLY the
// browser's own record (1), the store must write wfx-reactions-v1, and a
// fresh browser state never shows a fabricated count.
if (report.checks.actionRow?.found) {
  // like → expect count "1" + store write
  await ab("click", '[data-wfx-action="like"]');
  await sleep(700);
  report.checks.reactionsLike = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    return { reaction: like?.getAttribute('data-wfx-reaction'), pressed: like?.getAttribute('aria-pressed'),
      countText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  await shot("watch-like-clicked");
  // like again → toggle OFF (count gone, store entry removed)
  await ab("click", '[data-wfx-action="like"]');
  await sleep(600);
  report.checks.reactionsLikeOff = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    return { reaction: like?.getAttribute('data-wfx-reaction'),
      countText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  // dislike → the corpus truth: a dislike NEVER renders a count
  await ab("click", '[data-wfx-action="dislike"]');
  await sleep(700);
  report.checks.reactionsDislike = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    const dislike = document.querySelector('[data-wfx-action="dislike"]');
    const anyCountInRow = [...document.querySelectorAll('[data-wfx-watch-actions] [data-wfx-like-count]')].map(e => e.textContent);
    return { likeReaction: like?.getAttribute('data-wfx-reaction'), dislikeReaction: dislike?.getAttribute('data-wfx-reaction'),
      dislikePressed: dislike?.getAttribute('aria-pressed'),
      likeCountText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      anyCountInRow, store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  await shot("watch-dislike-clicked");
  // like again → MUTUAL EXCLUSION: dislike replaced by like, count back to 1
  await ab("click", '[data-wfx-action="like"]');
  await sleep(700);
  report.checks.reactionsMutualExclusion = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    const dislike = document.querySelector('[data-wfx-action="dislike"]');
    return { likeReaction: like?.getAttribute('data-wfx-reaction'), dislikeReaction: dislike?.getAttribute('data-wfx-reaction'),
      likeCountText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  // cleanup: leave no residue for later probes (toggle off)
  await ab("click", '[data-wfx-action="like"]');
  await sleep(500);
  report.checks.reactionsCleanup = await evalJS(`(() => ({ store: localStorage.getItem('wfx-reactions-v1') }))()`);

  // THE KEBAB — open it, read its rows, click Add-to-queue (a REAL write
  // through /api/queue), verify the session queue's GET truth.
  await ab("click", '[data-wfx-watch-kebab-summary]');
  await sleep(600);
  report.checks.kebabOpen = await evalJS(`(() => {
    const k = document.querySelector('[data-wfx-watch-kebab]');
    const menu = document.querySelector('[data-wfx-watch-kebab-menu]');
    return { open: k?.open ?? null, menuVisible: menu ? !!menu.offsetParent || getComputedStyle(menu).display !== 'none' : false,
      rows: [...(menu?.querySelectorAll('button, a') || [])].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 36)).filter(Boolean) };
  })()`);
  if (report.checks.kebabOpen?.menuVisible) {
    await shot("watch-kebab-open");
    const itemId = await evalJS(`(() => document.querySelector('[data-wfx-action="like"]')?.closest('[data-wfx-watch-actions]')?.querySelector('[data-wfx-queue-add-btn]')?.getAttribute('data-wfx-queue-add-btn') ?? 'n/a')()`);
    await ab("click", '[data-wfx-queue-add-btn]');
    await sleep(900);
    report.checks.kebabQueueAdd = await evalJS(`(() => {
      const btn = document.querySelector('[data-wfx-queue-add-btn]');
      return { label: (btn?.textContent || '').trim().slice(0, 30), added: btn?.getAttribute('data-wfx-queue-added') };
    })()`);
    // the queue's OWN truth (the real GET) — the item must be in the session queue
    report.checks.queueGetTruth = await evalJS(`fetch('/api/queue').then(r => r.json()).then(j => JSON.stringify(j).slice(0, 400))`);
    await shot("watch-kebab-queue-added");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// S1-2 THE CHANNEL ROW (N9-b/D11/N29) — displayName + THE SUBSCRIBE
//     REAL-WRITE HONESTY GATE (click → the Library's Subscriptions list)
// ═══════════════════════════════════════════════════════════════════════════
report.checks.channelRow = await evalJS(`(() => {
  const ch = document.querySelector('[data-wfx-watch-channel], .wfx-channel');
  if (!ch) return { found: false };
  const name = ch.querySelector('[data-wfx-watch-channel-name], .wfx-channel__name');
  const avatar = ch.querySelector('.wfx-channel__avatar');
  const av = avatar ? avatar.getBoundingClientRect() : null;
  const avs = avatar ? getComputedStyle(avatar) : null;
  const meta = ch.querySelector('[data-wfx-watch-channel-meta]');
  const sub = ch.querySelector('[data-wfx-subscribe]');
  const subText = (ch.textContent || '');
  const subCountMatch = subText.match(/\\d[\\d.,]*\\s*(subscriber|sub\\b|subscribing)/i);
  return {
    found: true,
    name: (name?.textContent || '').trim().slice(0, 40),
    nameFont: name ? getComputedStyle(name).fontSize + '/' + getComputedStyle(name).fontWeight : null,
    avatar: av ? Math.round(av.width) + 'x' + Math.round(av.height) + ' r' + (avs ? avs.borderRadius : '?') : null,
    metaLine: (meta?.textContent || '').trim().slice(0, 60),
    subCountText: subCountMatch ? subCountMatch[0] : null,
    subscribe: sub ? { label: (sub.getAttribute('aria-label') || '').slice(0, 40), state: sub.getAttribute('data-wfx-subscribe-state'),
      pressed: sub.getAttribute('aria-pressed'),
      box: Math.round(sub.getBoundingClientRect().width) + 'x' + Math.round(sub.getBoundingClientRect().height),
      radius: getComputedStyle(sub).borderRadius, bg: getComputedStyle(sub).backgroundColor, color: getComputedStyle(sub).color } : null,
  };
})()`);

// cross-check the channel name against the sources model's OWN truth
report.checks.sourcesModel = await evalJS(`fetch('/api/sources').then(r => r.json()).then(j => {
  const s = (j.sources || j || []);
  return JSON.stringify((Array.isArray(s) ? s : []).map(x => ({ connectorId: x.connectorId, displayName: x.displayName })).slice(0, 8));
}).catch(e => 'ERR ' + e)`);

// THE SUBSCRIBE HONESTY GATE — the click must perform the REAL library
// write; the Library page must show the Subscriptions named list with
// THIS item; a reload must carry the state (durable, not view-local).
const subBtn = '[data-wfx-subscribe]';
const subPresent = await evalJS(`!!document.querySelector('${subBtn}')`);
if (subPresent) {
  // normalize to idle first (a prior probe may have subscribed)
  const preState = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
  if (preState === "subscribed") {
    await ab("click", subBtn); await sleep(900);
  }
  await ab("click", subBtn);
  await sleep(1100);
  report.checks.subscribeClick = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    const status = document.querySelector('[data-wfx-subscribe-status]');
    return { state: s?.getAttribute('data-wfx-subscribe-state'), pressed: s?.getAttribute('aria-pressed'),
      label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44),
      status: (status?.textContent || '').trim().slice(0, 90) };
  })()`);
  await shot("watch-subscribed");
  // THE REAL-WRITE TRUTH: the Library page's Subscriptions named list
  await open(`${BASE}/library`);
  await sleep(1500);
  report.checks.librarySubscriptions = await evalJS(`(() => {
    const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
    const subs = lists.find(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim() === 'Subscriptions');
    const titles = subs ? [...subs.querySelectorAll('li, .wfx-queue__list li')].map(li => (li.textContent || '').trim().slice(0, 60)) : null;
    return { playlistCount: lists.length, subsFound: !!subs,
      subsListTitle: subs ? (subs.querySelector('[data-wfx-playlist-name]')?.textContent || '') : null,
      entryTitles: titles };
  })()`);
  await shot("library-subscriptions-list");
  // DURABILITY: reload the watch page — the pill must render Subscribed
  await open(watchUrl);
  await sleep(1800);
  report.checks.subscribeDurable = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    return { stateAfterReload: s?.getAttribute('data-wfx-subscribe-state'), label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44) };
  })()`);
  // cleanup: unsubscribe (leave the library clean for later probes)
  const nowState = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
  if (nowState === "subscribed") { await ab("click", subBtn); await sleep(900); }
  report.checks.subscribeCleanup = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    return { state: s?.getAttribute('data-wfx-subscribe-state') };
  })()`);
}

// ═══════════════════════════════════════════════════════════════════════════
// S1-3 THE DESCRIPTION INLINE EXPANDER (N9-c) — "...more" / "Show less",
//     INLINE expansion (no dialog), 2-line collapsed clamp
// ═══════════════════════════════════════════════════════════════════════════
report.checks.description = await evalJS(`(() => {
  const d = document.querySelector('[data-wfx-player-description], .wfx-desc');
  if (!d) return { found: false };
  const text = d.querySelector('.wfx-desc__text');
  const ts = text ? getComputedStyle(text) : null;
  const toggle = d.querySelector('[data-wfx-desc-toggle]');
  return { found: true, open: d.getAttribute('data-wfx-desc-open'),
    clamp: ts ? ts.webkitLineClamp : null, textFont: ts ? ts.fontSize + '/' + ts.fontWeight : null,
    collapsedH: Math.round(d.getBoundingClientRect().height),
    toggleText: (toggle?.textContent || '').trim(), toggleType: toggle ? toggle.tagName : null,
    isDetails: d.tagName === 'DETAILS' };
})()`);
const togglePresent = await evalJS(`!!document.querySelector('[data-wfx-desc-toggle]')`);
if (togglePresent) {
  await ab("click", '[data-wfx-desc-toggle]');
  await sleep(600);
  report.checks.descriptionExpanded = await evalJS(`(() => {
    const d = document.querySelector('[data-wfx-player-description], .wfx-desc');
    const toggle = d?.querySelector('[data-wfx-desc-toggle]');
    const body = d?.querySelector('.wfx-desc__body');
    const dialogOpen = !!document.querySelector('dialog[open], [role=dialog][aria-modal=true], .wfx-modal--open');
    return { open: d?.getAttribute('data-wfx-desc-open'), toggleText: (toggle?.textContent || '').trim(),
      bodyVisible: body ? body.getBoundingClientRect().height > 0 : false, expandedH: d ? Math.round(d.getBoundingClientRect().height) : null,
      anyDialogOpened: dialogOpen };
  })()`);
  await shot("watch-desc-expanded");
  await ab("click", '[data-wfx-desc-toggle]');
  await sleep(500);
  report.checks.descriptionCollapsed = await evalJS(`(() => {
    const d = document.querySelector('[data-wfx-player-description], .wfx-desc');
    return { open: d?.getAttribute('data-wfx-desc-open'), collapsedH: d ? Math.round(d.getBoundingClientRect().height) : null };
  })()`);
}

// ═══════════════════════════════════════════════════════════════════════════
// S1-4 THE RELATED COLUMN GRAMMAR (N22) — paper-switch Autoplay at the
//     section head, compact 168x94 rows at 4px pitch, one-click play,
//     dwell-preview wiring
// ═══════════════════════════════════════════════════════════════════════════
report.checks.relatedColumn = await evalJS(`(() => {
  const rail = document.querySelector('.wfx-upnext, [data-wfx-up-next]');
  if (!rail) return { found: false };
  const head = rail.querySelector('.wfx-upnext__head');
  const autoplayRow = rail.querySelector('[data-wfx-autoplay-row]');
  const toggle = rail.querySelector('[data-wfx-autoplay-toggle]');
  const list = rail.querySelector('.wfx-upnext__relatedlist, [data-wfx-up-next-related]');
  const rows = list ? [...list.children] : [];
  const firstThree = rows.slice(0, 3).map(li => {
    const link = li.querySelector('a.wfx-upnext__link');
    const thumb = li.querySelector('.wfx-card__thumb--rail');
    const tb = thumb ? thumb.getBoundingClientRect() : null;
    const title = li.querySelector('.wfx-upnext__itemtitle');
    const tis = title ? getComputedStyle(title) : null;
    return { href: link ? link.getAttribute('href') : null,
      thumbBox: tb ? Math.round(tb.width) + 'x' + Math.round(tb.height) : null,
      titleFont: tis ? tis.fontSize + '/' + tis.fontWeight : null,
      titleClamp: tis ? tis.webkitLineClamp : null,
      top: li.getBoundingClientRect().top, h: li.getBoundingClientRect().height };
  });
  // row pitch: consecutive tops delta minus row height (the gap law)
  let pitch = null;
  if (rows.length >= 2) {
    const t0 = rows[0].getBoundingClientRect().top, t1 = rows[1].getBoundingClientRect().top;
    const h0 = rows[0].getBoundingClientRect().height;
    pitch = Math.round((t1 - t0 - h0) * 10) / 10;
  }
  const listGap = list ? getComputedStyle(list).rowGap : null;
  // head placement: the autoplay row must sit ABOVE the list (the section head)
  const headBeforeList = head && list ? head.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 2 : null;
  return { found: true,
    head: !!head, autoplayRow: !!autoplayRow, autoplayBeforeList: headBeforeList,
    switchRole: toggle ? toggle.getAttribute('role') : null, switchChecked: toggle ? toggle.getAttribute('aria-checked') : null,
    switchClass: toggle ? toggle.className.toString().slice(0, 40) : null, knob: !!rail.querySelector('.wfx-switch__knob'),
    rowCount: rows.length, firstThree, rowPitch: pitch, listRowGap: listGap,
    chips: [...rail.querySelectorAll('[data-wfx-related-chip]')].map(c => (c.textContent || '').trim().slice(0, 20)) };
})()`);

// the autoplay paper-switch — click → aria-checked flips + the queue's
// autoplay state changes (the real policy write)
const autoplayToggle = '[data-wfx-autoplay-toggle]';
const toggleFound = await evalJS(`!!document.querySelector('${autoplayToggle}')`);
if (toggleFound) {
  const before = await evalJS(`document.querySelector('${autoplayToggle}')?.getAttribute('aria-checked')`);
  const queueBefore = await evalJS(`fetch('/api/queue').then(r => r.json()).then(j => j.autoplay ?? j.state?.autoplay ?? null)`);
  await ab("click", autoplayToggle);
  await sleep(900);
  const after = await evalJS(`document.querySelector('${autoplayToggle}')?.getAttribute('aria-checked')`);
  const queueAfter = await evalJS(`fetch('/api/queue').then(r => r.json()).then(j => j.autoplay ?? j.state?.autoplay ?? null)`);
  report.checks.autoplayToggle = { before, after, queueBefore, queueAfter };
  // revert (leave the policy state clean)
  await ab("click", autoplayToggle);
  await sleep(700);
  report.checks.autoplayToggle.reverted = await evalJS(`document.querySelector('${autoplayToggle}')?.getAttribute('aria-checked')`);
}

// dwell-preview WIRING: the compact rows must be wrapped in the preview
// trigger (the same dwell-gated system the cards use) — hover one row and
// observe the singleton layer's resolve (or its honest absence)
const rowForHover = await evalJS(`(() => {
  const li = document.querySelector('.wfx-upnext__relatedlist li, [data-wfx-up-next-related] li');
  if (!li) return null;
  const trigger = li.querySelector('[data-wfx-previewable]');
  const thumb = li.querySelector('.wfx-card__thumb--rail');
  const tb = thumb ? thumb.getBoundingClientRect() : null;
  return { hasTrigger: !!trigger, previewable: trigger ? trigger.getAttribute('data-wfx-previewable') : null,
    hoverX: tb ? Math.round(tb.x + tb.width / 2) : null, hoverY: tb ? Math.round(tb.y + tb.height / 2) : null };
})()`);
report.checks.dwellPreviewWiring = rowForHover;
if (rowForHover?.hoverX) {
  await ab("mouse", "move", rowForHover.hoverX, rowForHover.hoverY);
  await sleep(1400); // balanced mode: ~150ms dwell + resolve latency
  report.checks.dwellPreviewResult = await evalJS(`(() => {
    const layer = document.querySelector('[data-wfx-hover-preview], .wfx-hover-preview, [class*=preview][class*=singleton], iframe[class*=preview]');
    const anyIframe = [...document.querySelectorAll('iframe')].map(f => f.className.toString().slice(0, 50));
    return { layerFound: !!layer, layerClass: layer ? layer.className.toString().slice(0, 60) : null,
      iframes: anyIframe.slice(0, 6) };
  })()`);
  await shot("watch-related-dwell");
}

// ═══════════════════════════════════════════════════════════════════════════
// S1-5 THE WATCH ROUTE GEOMETRY (N21/D14) — guide hidden, 16px margins
//     @1440, secondary flush-right, 24px @>=1600, home rail regression
// ═══════════════════════════════════════════════════════════════════════════
report.checks.watchRouteGeometry = await evalJS(`(() => {
  const shell = document.querySelector('.wfx-shell');
  const rail = document.querySelector('.wfx-rail');
  const player = document.querySelector('.wfx-player');
  const layout = document.querySelector('.wfx-player__layout');
  const stagewrap = document.querySelector('[data-wfx-player-stagewrap], .wfx-player__stagewrap');
  const stage = document.querySelector('.wfx-player__stage, iframe');
  const secondary = document.querySelector('.wfx-upnext, [data-wfx-up-next]');
  const sb = stage ? stage.getBoundingClientRect() : null;
  const sec = secondary ? secondary.getBoundingClientRect() : null;
  return {
    shellGuide: shell ? shell.getAttribute('data-wfx-shell-guide') : null,
    railDisplay: rail ? getComputedStyle(rail).display : null,
    railBox: rail && getComputedStyle(rail).display !== 'none' ? Math.round(rail.getBoundingClientRect().width) + 'x' + Math.round(rail.getBoundingClientRect().height) : null,
    playerPadding: player ? getComputedStyle(player).padding : null,
    playerX: sb ? Math.round(sb.x) : null, stageBox: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null,
    layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null, layoutGap: layout ? getComputedStyle(layout).gap : null,
    secondaryBox: sec ? Math.round(sec.width) + 'x' + Math.round(sec.height) + ' @(' + Math.round(sec.x) + ',' + Math.round(sec.y) + ')' : null,
    secondaryRightEdgeDelta: sec ? Math.round(window.innerWidth - sec.right) : null,
    viewportW: window.innerWidth,
  };
})()`);
await shot("watch-geometry-guide-hidden");

// the hamburger on a hidden-guide shell must open the DRAWER (any width)
const hamburger = await evalJS(`(() => {
  const b = document.querySelector('[aria-label*=uide i], [aria-label*=amburger i], .wfx-guide-toggle, button[class*=guide]');
  return b ? { label: (b.getAttribute('aria-label') || '').slice(0, 30), cls: b.className.toString().slice(0, 30) } : null;
})()`);
if (hamburger) {
  await ab("click", ".wfx-guide-toggle, [aria-label*='uide'], [aria-label*='amburger']");
  await sleep(700);
  report.checks.hiddenGuideDrawer = await evalJS(`(() => {
    const rail = document.querySelector('.wfx-rail');
    const state = document.documentElement.getAttribute('data-wfx-guide');
    const rb = rail ? rail.getBoundingClientRect() : null;
    return { guideState: state, railDisplay: rail ? getComputedStyle(rail).display : null,
      railBox: rb ? Math.round(rb.width) + 'x' + Math.round(rb.height) : null, railX: rb ? Math.round(rb.x) : null };
  })()`);
  await shot("watch-guide-drawer-open");
  await ab("press", "Escape");
  await sleep(500);
  report.checks.hiddenGuideDrawerClosed = await evalJS(`(() => ({ guideState: document.documentElement.getAttribute('data-wfx-guide'), railDisplay: document.querySelector('.wfx-rail') ? getComputedStyle(document.querySelector('.wfx-rail')).display : null }))()`);
}

// the >=1600 band: 24px margins (the corpus wide-band law)
await ab("set", "viewport", 1600, 900);
await sleep(900);
report.checks.geometry1600 = await evalJS(`(() => {
  const player = document.querySelector('.wfx-player');
  const stage = document.querySelector('.wfx-player__stage, iframe');
  return { viewportW: window.innerWidth,
    playerPadding: player ? getComputedStyle(player).padding : null,
    playerX: stage ? Math.round(stage.getBoundingClientRect().x) : null };
})()`);
await ab("set", "viewport", 1440, 900);
await sleep(600);

// HOME regression: the rail must still render on non-watch routes
await open(`${BASE}/`);
await sleep(1500);
report.checks.homeRailRegression = await evalJS(`(() => {
  const rail = document.querySelector('.wfx-rail');
  const shell = document.querySelector('.wfx-shell');
  return { shellGuide: shell ? shell.getAttribute('data-wfx-shell-guide') : null,
    railDisplay: rail ? getComputedStyle(rail).display : null,
    railW: rail ? Math.round(rail.getBoundingClientRect().width) : null };
})()`);

// ── write the report ───────────────────────────────────────────────────────
const summary = {
  actionRow: report.checks.actionRow,
  reactionsHonesty: {
    like: report.checks.reactionsLike, likeOff: report.checks.reactionsLikeOff,
    dislike: report.checks.reactionsDislike, mutualExclusion: report.checks.reactionsMutualExclusion,
  },
  kebab: report.checks.kebabOpen, queueAdd: report.checks.kebabQueueAdd, queueGetTruth: report.checks.queueGetTruth,
  channelRow: report.checks.channelRow, sourcesModel: report.checks.sourcesModel,
  subscribe: { click: report.checks.subscribeClick, library: report.checks.librarySubscriptions, durable: report.checks.subscribeDurable },
  description: { collapsed: report.checks.description, expanded: report.checks.descriptionExpanded, reCollapsed: report.checks.descriptionCollapsed },
  relatedColumn: report.checks.relatedColumn, autoplayToggle: report.checks.autoplayToggle,
  dwellPreview: { wiring: report.checks.dwellPreviewWiring, result: report.checks.dwellPreviewResult },
  geometry: { watch: report.checks.watchRouteGeometry, w1600: report.checks.geometry1600, drawer: report.checks.hiddenGuideDrawer, home: report.checks.homeRailRegression },
};
report.summary = summary;
await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("WROTE " + OUT);
