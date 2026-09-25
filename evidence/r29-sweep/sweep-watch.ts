#!/usr/bin/env bun
// R29 PRODUCTION SWEEP — PROBE 2: WATCH (/player?id=...). The action row split
// pill + reactions honesty gate (N9-a/N9-a-h), the channel row + the Subscribe
// REAL-WRITE gate (N9-b/D11), the description inline expander (N9-c), the
// related column (N22), and the watch geometry (N21/D14/F3) — measured against
// PRODUCTION (never a local build).
// Usage: bun evidence/r29-sweep/sweep-watch.ts <base>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "https://webflix-steel.vercel.app";
const OUT = resolve("evidence/r29-sweep/probes/watch.json");

const ab = async (...args: (string | number)[]): Promise<string> => {
  const p = await $`agent-browser ${args.map(String)}`.nothrow().quiet();
  return p.stdout.toString().trim();
};
const evalJS = async (js: string): Promise<unknown> => {
  const out = await ab("eval", js);
  try { return JSON.parse(out); } catch { return out; }
};
const open = async (url: string) => { await ab("open", url); await ab("wait", "--load", "networkidle").catch(() => {}); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Rec = Record<string, unknown>;
const report: { tag: string; base: string; at: string; checks: Rec } = {
  tag: "prod-webflix-steel", base: BASE, at: new Date().toISOString(), checks: {},
};
const save = () => Bun.write(OUT, JSON.stringify(report, null, 2));

await ab("set", "viewport", 1440, 900);
// fresh session state (no residue from earlier probes)
await ab("open", BASE + "/");
await evalJS(`localStorage.removeItem('wfx-reactions-v1'); 'clean'`);

// ── navigate to a watch page (the first card on home) ───────────────────────
await open(`${BASE}/`);
await sleep(1500);
const watchHref = await evalJS(`(() => {
  const a = document.querySelector('main a[href*="/player"]');
  return a ? a.getAttribute('href') : null;
})()`);
report.checks.entry = { watchHref };
const watchUrl = watchHref ? (String(watchHref).startsWith("http") ? watchHref : BASE + String(watchHref)) : `${BASE}/player`;
await open(watchUrl);
await sleep(3000);
await save();

// ═══ S1-1 THE WATCH ACTION ROW (N9-a) + the reactions honesty gate ════════
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
await save();

// THE REACTIONS HONESTY GATE — like → "1"; toggle-off; dislike → NO count; mutual exclusion
if ((report.checks.actionRow as Rec)["found"]) {
  await ab("click", '[data-wfx-action="like"]');
  await sleep(900);
  report.checks.reactionsLike = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    return { reaction: like?.getAttribute('data-wfx-reaction'), pressed: like?.getAttribute('aria-pressed'),
      countText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  await ab("click", '[data-wfx-action="like"]');
  await sleep(800);
  report.checks.reactionsLikeOff = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    return { reaction: like?.getAttribute('data-wfx-reaction'),
      countText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  await ab("click", '[data-wfx-action="dislike"]');
  await sleep(900);
  report.checks.reactionsDislike = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    const dislike = document.querySelector('[data-wfx-action="dislike"]');
    const anyCountInRow = [...document.querySelectorAll('[data-wfx-watch-actions] [data-wfx-like-count]')].map(e => e.textContent);
    return { likeReaction: like?.getAttribute('data-wfx-reaction'), dislikeReaction: dislike?.getAttribute('data-wfx-reaction'),
      dislikePressed: dislike?.getAttribute('aria-pressed'),
      likeCountText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      anyCountInRow, store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  await ab("click", '[data-wfx-action="like"]');
  await sleep(900);
  report.checks.reactionsMutualExclusion = await evalJS(`(() => {
    const like = document.querySelector('[data-wfx-action="like"]');
    const dislike = document.querySelector('[data-wfx-action="dislike"]');
    return { likeReaction: like?.getAttribute('data-wfx-reaction'), dislikeReaction: dislike?.getAttribute('data-wfx-reaction'),
      likeCountText: like?.querySelector('[data-wfx-like-count]')?.textContent ?? null,
      store: localStorage.getItem('wfx-reactions-v1') };
  })()`);
  // cleanup: toggle off, leave no residue
  await ab("click", '[data-wfx-action="like"]');
  await sleep(700);
  report.checks.reactionsCleanup = await evalJS(`(() => ({ store: localStorage.getItem('wfx-reactions-v1') }))()`);
  await save();

  // THE KEBAB — open, read rows, Add-to-queue (a REAL /api/queue write)
  await ab("click", '[data-wfx-watch-kebab-summary]');
  await sleep(900);
  report.checks.kebabOpen = await evalJS(`(() => {
    const k = document.querySelector('[data-wfx-watch-kebab]');
    const menu = document.querySelector('[data-wfx-watch-kebab-menu]');
    return { open: k?.open ?? null, menuVisible: menu ? !!menu.offsetParent || getComputedStyle(menu).display !== 'none' : false,
      rows: [...(menu?.querySelectorAll('button, a') || [])].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 36)).filter(Boolean) };
  })()`);
  const keb = report.checks.kebabOpen as Rec;
  if (keb && keb["menuVisible"]) {
    await ab("click", '[data-wfx-queue-add-btn]');
    await sleep(1100);
    report.checks.kebabQueueAdd = await evalJS(`(() => {
      const btn = document.querySelector('[data-wfx-queue-add-btn]');
      return { label: (btn?.textContent || '').trim().slice(0, 30), added: btn?.getAttribute('data-wfx-queue-added') };
    })()`);
    // the queue's OWN truth (the real GET on production)
    report.checks.queueGetTruth = await evalJS(`fetch('/api/queue').then(r => r.json()).then(j => JSON.stringify(j).slice(0, 400))`);
  }
  await save();
}

// ═══ S1-2 THE CHANNEL ROW (N9-b) + the Subscribe REAL-WRITE gate ══════════
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
await save();

// THE SUBSCRIBE HONESTY GATE — a REAL write on PRODUCTION, then the Library
// renders the Subscriptions named list; durable across reload; cleaned up.
const subBtn = '[data-wfx-subscribe]';
const subPresent = await evalJS(`!!document.querySelector('${subBtn}')`);
if (subPresent) {
  const preState = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
  if (preState === "subscribed") {
    await ab("click", subBtn); await sleep(1100);
  }
  await ab("click", subBtn);
  await sleep(1400);
  report.checks.subscribeClick = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    const status = document.querySelector('[data-wfx-subscribe-status]');
    return { state: s?.getAttribute('data-wfx-subscribe-state'), pressed: s?.getAttribute('aria-pressed'),
      label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44),
      status: (status?.textContent || '').trim().slice(0, 90) };
  })()`);
  await save();
  // THE REAL-WRITE TRUTH: the Library page's Subscriptions named list
  await open(`${BASE}/library`);
  await sleep(2200);
  report.checks.librarySubscriptions = await evalJS(`(() => {
    const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
    const subs = lists.find(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim() === 'Subscriptions');
    const titles = subs ? [...subs.querySelectorAll('li, .wfx-queue__list li')].map(li => (li.textContent || '').trim().slice(0, 60)) : null;
    return { playlistCount: lists.length, subsFound: !!subs,
      subsListTitle: subs ? (subs.querySelector('[data-wfx-playlist-name]')?.textContent || '') : null,
      entryTitles: titles };
  })()`);
  await save();
  // DURABILITY: reload the watch page — the pill must render Subscribed
  await open(watchUrl);
  await sleep(2600);
  report.checks.subscribeDurable = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    return { stateAfterReload: s?.getAttribute('data-wfx-subscribe-state'), label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44) };
  })()`);
  // cleanup: unsubscribe (leave the production library clean)
  const nowState = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
  if (nowState === "subscribed") { await ab("click", subBtn); await sleep(1100); }
  report.checks.subscribeCleanup = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    return { state: s?.getAttribute('data-wfx-subscribe-state') };
  })()`);
  await save();
}

// ═══ S1-3 THE DESCRIPTION INLINE EXPANDER (N9-c) ══════════════════════════
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
  await sleep(800);
  report.checks.descriptionExpanded = await evalJS(`(() => {
    const d = document.querySelector('[data-wfx-player-description], .wfx-desc');
    const toggle = d?.querySelector('[data-wfx-desc-toggle]');
    const body = d?.querySelector('.wfx-desc__body');
    const dialogOpen = !!document.querySelector('dialog[open], [role=dialog][aria-modal=true], .wfx-modal--open');
    return { open: d?.getAttribute('data-wfx-desc-open'), toggleText: (toggle?.textContent || '').trim(),
      bodyVisible: body ? body.getBoundingClientRect().height > 0 : false, expandedH: d ? Math.round(d.getBoundingClientRect().height) : null,
      anyDialogOpened: dialogOpen };
  })()`);
  await ab("click", '[data-wfx-desc-toggle]');
  await sleep(700);
  report.checks.descriptionCollapsed = await evalJS(`(() => {
    const d = document.querySelector('[data-wfx-player-description], .wfx-desc');
    return { open: d?.getAttribute('data-wfx-desc-open'), collapsedH: d ? Math.round(d.getBoundingClientRect().height) : null };
  })()`);
}
await save();

// ═══ S1-4 THE RELATED COLUMN (N22) — autoplay switch + compact rows ═══════
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
  let pitch = null;
  if (rows.length >= 2) {
    const t0 = rows[0].getBoundingClientRect().top, t1 = rows[1].getBoundingClientRect().top;
    const h0 = rows[0].getBoundingClientRect().height;
    pitch = Math.round((t1 - t0 - h0) * 10) / 10;
  }
  const listGap = list ? getComputedStyle(list).rowGap : null;
  const headBeforeList = head && list ? head.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 2 : null;
  return { found: true,
    head: !!head, autoplayRow: !!autoplayRow, autoplayBeforeList: headBeforeList,
    switchRole: toggle ? toggle.getAttribute('role') : null, switchChecked: toggle ? toggle.getAttribute('aria-checked') : null,
    switchClass: toggle ? toggle.className.toString().slice(0, 40) : null, knob: !!rail.querySelector('.wfx-switch__knob'),
    rowCount: rows.length, firstThree, rowPitch: pitch, listRowGap: listGap,
    chips: [...rail.querySelectorAll('[data-wfx-related-chip]')].map(c => (c.textContent || '').trim().slice(0, 20)) };
})()`);
await save();

// the autoplay paper-switch — a real policy write via /api/queue
const autoplayToggle = '[data-wfx-autoplay-toggle]';
const toggleFound = await evalJS(`!!document.querySelector('${autoplayToggle}')`);
if (toggleFound) {
  const before = await evalJS(`document.querySelector('${autoplayToggle}')?.getAttribute('aria-checked')`);
  const queueBefore = await evalJS(`fetch('/api/queue').then(r => r.json()).then(j => j.autoplay ?? j.state?.autoplay ?? null)`);
  await ab("click", autoplayToggle);
  await sleep(1100);
  const after = await evalJS(`document.querySelector('${autoplayToggle}')?.getAttribute('aria-checked')`);
  const queueAfter = await evalJS(`fetch('/api/queue').then(r => r.json()).then(j => j.autoplay ?? j.state?.autoplay ?? null)`);
  report.checks.autoplayToggle = { before, after, queueBefore, queueAfter };
  // revert (leave the policy state clean)
  await ab("click", autoplayToggle);
  await sleep(900);
  report.checks.autoplayToggle.reverted = await evalJS(`document.querySelector('${autoplayToggle}')?.getAttribute('aria-checked')`);
  await save();
}

// ═══ S1-5 THE WATCH ROUTE GEOMETRY (N21/D14) ══════════════════════════════
report.checks.watchRouteGeometry = await evalJS(`(() => {
  const shell = document.querySelector('.wfx-shell');
  const rail = document.querySelector('.wfx-rail');
  const player = document.querySelector('.wfx-player');
  const layout = document.querySelector('.wfx-player__layout');
  const stagewrap = document.querySelector('[data-wfx-player-stagewrap], .wfx-player__stagewrap');
  const stage = document.querySelector('.wfx-player__stage, iframe');
  const secondary = document.querySelector('.wfx-upnext, [data-wfx-up-next]');
  const sw = stagewrap ? stagewrap.getBoundingClientRect() : null;
  const sb = stage ? stage.getBoundingClientRect() : null;
  const sec = secondary ? secondary.getBoundingClientRect() : null;
  return {
    shellGuide: shell ? shell.getAttribute('data-wfx-shell-guide') : null,
    railDisplay: rail ? getComputedStyle(rail).display : null,
    railBox: rail && getComputedStyle(rail).display !== 'none' ? Math.round(rail.getBoundingClientRect().width) + 'x' + Math.round(rail.getBoundingClientRect().height) : null,
    playerPadding: player ? getComputedStyle(player).padding : null,
    playerX: sb ? Math.round(sb.x) : null, stageBox: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null,
    stagewrap: sw ? Math.round(sw.width) + 'x' + Math.round(sw.height) + ' @(' + Math.round(sw.x) + ',' + Math.round(sw.y) + ')' : null,
    layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null, layoutGap: layout ? getComputedStyle(layout).gap : null,
    secondaryBox: sec ? Math.round(sec.width) + 'x' + Math.round(sec.height) + ' @(' + Math.round(sec.x) + ',' + Math.round(sec.y) + ')' : null,
    secondaryRightEdgeDelta: sec ? Math.round(window.innerWidth - sec.right) : null,
    viewportW: window.innerWidth,
  };
})()`);
await save();

// HOME regression: the rail must still render on non-watch routes
await open(`${BASE}/`);
await sleep(2200);
report.checks.homeRailRegression = await evalJS(`(() => {
  const rail = document.querySelector('.wfx-rail');
  const shell = document.querySelector('.wfx-shell');
  return { shellGuide: shell ? shell.getAttribute('data-wfx-shell-guide') : null,
    railDisplay: rail ? getComputedStyle(rail).display : null,
    railW: rail ? Math.round(rail.getBoundingClientRect().width) : null };
})()`);
await save();

console.log(`WATCH PROBE -> ${OUT}`);
console.log(JSON.stringify(report.checks, null, 1).slice(0, 5200));
