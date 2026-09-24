#!/usr/bin/env bun
// R29-C SECOND-ORDER PROBE — the instrument for the R29 wave: the watch page's
// second act (action row / channel row / description expander / geometry),
// search rows + filters dialog, masthead gear + sign-in anatomy + keyboard set
// + theater/miniplayer modes, rail grammar + duration badge + shorts shelf,
// the O6 raised-gray residual + N29 channel slot + mic verdict.
// Every check pins its corpus citation (A's R28 sheets @ the corpus head).
// A check is VERIFIED only when THIS probe reproduces the claimed behavior.
// Usage: bun evidence/r29-recon/r29-probe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r29-recon/${TAG}.r29probe.json`);

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

// ═══════════════════════════════════════════════════════════════════════════
// A. HOME — rail grammar (N13/D8), duration badge (N19), shorts shelf (N20),
//    channel slot (N29), meta-theme-color
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(900);

report.checks.rail = await evalJS(`(() => {
  const nav = [...document.querySelectorAll('nav a, nav [role=link], nav button')].map(a => (a.textContent || '').trim()).filter(Boolean);
  return {
    items: nav,
    historyCount: nav.filter(l => l === 'History').length,
    hasShorts: nav.includes('Shorts'), hasSubscriptions: nav.includes('Subscriptions'),
    hasExplore: nav.some(l => /^explore/i.test(l)), hasMoreFromYouTube: nav.some(l => /more from youtube/i.test(l)),
    footerLinks: nav.some(l => /^(about|press|copyright|contact us|creators|advertise|developers|terms)$/i.test(l)),
    installEntry: nav.some(l => /install/i.test(l)),
  };
})()`);

report.checks.metaTheme = await evalJS(`(() => ({
  content: document.querySelector('meta[name=theme-color]')?.content || null,
  dataTheme: document.documentElement.getAttribute('data-theme') || null,
  bodyBg: getComputedStyle(document.body).backgroundColor,
}))()`);

// duration badge grammar (N19): corpus = corner badge bottom-right 8px inset,
// text 12/500 #fff on rgba(0,0,0,0.6), r4, pad 1px 4px, format "0:45" —
// NOT a "short45s"-family type+duration text pill.
await ab("scroll", "down", 700);
await sleep(600);
report.checks.durationBadge = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('main a.wfx-card, main [data-wfx-card], main [class*=card]')].filter(e => e.getBoundingClientRect().width > 150);
  const c = cards[0];
  if (!c) return { found: false };
  const thumb = c.querySelector('[class*=thumb]');
  const tb = thumb ? thumb.getBoundingClientRect() : null;
  const badges = [...c.querySelectorAll('[class*=badge],[class*=duration],[class*=pill]')].map(e => {
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { cls: e.className.toString().slice(0, 40), text: (e.textContent || '').trim().slice(0, 16),
      box: Math.round(b.width) + 'x' + Math.round(b.height), pos: tb ? { bottom: Math.round(tb.bottom - b.bottom), right: Math.round(tb.right - b.right) } : null,
      font: s.fontSize + '/' + s.fontWeight, bg: s.backgroundColor, radius: s.borderRadius, pad: s.padding };
  });
  return { found: true, cardCount: cards.length,
    card: Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height),
    thumb: tb ? Math.round(tb.width) + 'x' + Math.round(tb.height) : null, badges: badges.slice(0, 4) };
})()`);

// shorts shelf on home (N20): corpus ytm-shorts-lockup 208×387 card, 208×311 thumb, title below
report.checks.shortsShelf = await evalJS(`(() => {
  const bodies = document.body.innerText;
  const shelfSection = [...document.querySelectorAll('section, div')].find(e => /^shorts$/i.test((e.querySelector('h1,h2,h3')?.textContent || '').trim()));
  const verticalCards = [...document.querySelectorAll('main [class*=card] [class*=thumb], main a [class*=thumb]')].filter(e => {
    const b = e.getBoundingClientRect(); return b.width > 100 && b.height > b.width * 1.2;
  }).map(e => { const b = e.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); }).slice(0, 6);
  return { hasShortsHeading: /\\bshorts\\b/i.test(bodies.slice(0, 3000)), shelfSectionFound: !!shelfSection, verticalThumbCards: verticalCards };
})()`);

// channel slot (N29): what fills the card's channel-name slot?
report.checks.channelSlot = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('main a.wfx-card, main [data-wfx-card], main [class*=card]')].filter(e => e.getBoundingClientRect().width > 150);
  const slots = cards.slice(0, 3).map(c => {
    const row = c.querySelector('[class*=channel],[class*=owner],[class*=source],[class*=meta] [class*=name], [data-wfx-source]');
    return { channelText: row ? (row.textContent || '').trim().slice(0, 40) : null,
      metaText: (c.querySelector('[class*=meta]')?.textContent || '').trim().slice(0, 60) };
  });
  const serviceNames = slots.filter(s => /wfx-experience-service|connector|^\\s*wfx\\b/i.test(s.channelText || '')).length;
  return { slots, connectorIdSlots: serviceNames };
})()`);

// ═══════════════════════════════════════════════════════════════════════════
// B. MASTHEAD — gear menu (N24), sign-in pill (N12), mic (D3)
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(700);
report.checks.masthead = await evalJS(`(() => {
  const right = document.querySelector('header [class*=right], header [class*=side--right]') || document.querySelector('header');
  const gear = [...document.querySelectorAll('header button, header [role=button], header a')].find(e => /settings|gear|preferences/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  const signin = [...document.querySelectorAll('header button, header a, header [role=button]')].find(e => /^\\s*sign in\\b/i.test((e.textContent || '').trim()));
  const sb = signin ? signin.getBoundingClientRect() : null; const ss = signin ? getComputedStyle(signin) : null;
  const mic = [...document.querySelectorAll('header button, header [role=button]')].find(e => /mic|voice|microphone/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  const mb = mic ? mic.getBoundingClientRect() : null; const ms = mic ? getComputedStyle(mic) : null;
  return {
    rightClusterText: (right?.textContent || '').trim().slice(0, 120),
    gearButton: gear ? { label: (gear.getAttribute('aria-label') || gear.textContent || '').trim().slice(0, 40) } : null,
    signinPill: sb ? { box: Math.round(sb.width) + 'x' + Math.round(sb.height), radius: ss.borderRadius, color: ss.color, border: ss.border.slice(0, 40), bg: ss.backgroundColor } : null,
    micButton: mb ? { box: Math.round(mb.width) + 'x' + Math.round(mb.height), radius: ms.borderRadius, bg: ms.backgroundColor, label: (mic.getAttribute('aria-label') || '').slice(0, 30) } : null,
  };
})()`);

// gear menu open + row census (honesty: every row a real surface or honestly absent)
const gearOpen = await evalJS(`(() => {
  const g = [...document.querySelectorAll('header button, header [role=button], header a')].find(e => /settings|gear|preferences/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  if (!g) return false;
  g.setAttribute('data-r29c-gear', '1'); return true;
})()`);
report.checks.gearMenu = { opened: false };
if (gearOpen) {
  await ab("click", "[data-r29c-gear='1']");
  await sleep(800);
  report.checks.gearMenu = await evalJS(`(() => {
    const menus = [...document.querySelectorAll('[role=menu], [role=dialog], [class*=menu], [class*=popover], details[open]')].filter(e => e.getBoundingClientRect().width > 50 && e.getBoundingClientRect().height > 40);
    const m = menus.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!m) return { opened: false, menuCount: menus.length };
    const rows = [...m.querySelectorAll('button, a, [role=menuitem], [role=button]')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(t => t && t.length < 40);
    return { opened: true, rows: rows.slice(0, 16),
      hasAppearance: rows.some(r => /appearance|dark|light|theme/i.test(r)),
      hasKeyboardShortcuts: rows.some(r => /keyboard/i.test(r)) };
  })()`);
  await shot("gear-menu");
  await evalJS(`(() => { const g = document.querySelector('[data-r29c-gear]'); if (g) g.click(); return 'closed'; })()`);
  await sleep(300);
}

// ═══════════════════════════════════════════════════════════════════════════
// C. SEARCH — row geometry (N3), filters dialog (N23)
// ═══════════════════════════════════════════════════════════════════════════
// query fallbacks: fixtures carry "Neon Rain"; the service catalog answers
// "rain"/"lofi" — the first query with rows wins (both boots measured).
let searchUrl = `${BASE}/search?q=neon`;
report.checks.searchQueryTried = [];
for (const q of ["neon", "rain", "lofi", "a"]) {
  await open(`${BASE}/search?q=${q}`);
  await sleep(1200);
  const n = await evalJS(`document.querySelectorAll('main [class*=card], main [class*=result]').length`);
  report.checks.searchQueryTried.push({ q, rows: n });
  if (n > 0) { searchUrl = `${BASE}/search?q=${q}`; break; }
}
await open(searchUrl);
await sleep(1200);
report.checks.searchRows = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('main [class*=result], main a.wfx-card, main [data-wfx-card], main [class*=card]')].filter(e => e.getBoundingClientRect().width > 150);
  const r = rows[0];
  if (!r) return { found: false, n: rows.length };
  const b = r.getBoundingClientRect();
  const thumb = r.querySelector('[class*=thumb]');
  const t = thumb ? thumb.getBoundingClientRect() : null;
  const title = r.querySelector('[class*=title], h3');
  const ts = title ? getComputedStyle(title) : null;
  return { found: true, n: rows.length,
    row: Math.round(b.width) + 'x' + Math.round(b.height),
    layout: getComputedStyle(r.parentElement).display, gridCols: getComputedStyle(r.parentElement).gridTemplateColumns,
    thumb: t ? Math.round(t.width) + 'x' + Math.round(t.height) : null,
    thumbRadius: thumb ? getComputedStyle(thumb).borderRadius : null,
    titleFont: ts ? ts.fontSize + '/' + ts.fontWeight : null,
    rowClass: r.className.toString().slice(0, 50) };
})()`);

// filters dialog (N23): corpus 696×518 r12 shadow; 5 groups
const filtersBtn = await evalJS(`(() => {
  const b = document.querySelector('[data-wfx-search-filters], button[aria-label*=filter i]') ||
    [...document.querySelectorAll('button, [role=button]')].find(e => /^filters\\b/i.test((e.textContent || '').trim()));
  if (!b) return { found: false };
  b.setAttribute('data-r29c-filters', '1');
  return { found: true, expanded: b.getAttribute('aria-expanded') };
})()`);
report.checks.filters = { button: filtersBtn };
if (filtersBtn?.found) {
  await ab("click", "[data-r29c-filters='1']");
  await sleep(900);
  report.checks.filters.dialog = await evalJS(`(() => {
    const d = [...document.querySelectorAll('[role=dialog], [class*=modal], [class*=dialog], details[open], [class*=filters]')].filter(e => e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().height > 80)
      .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    if (!d) return { found: false };
    const b = d.getBoundingClientRect(); const s = getComputedStyle(d);
    const text = d.innerText || '';
    return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height), radius: s.borderRadius, bg: s.backgroundColor,
      title: (d.querySelector('h1,h2,h3')?.textContent || '').slice(0, 30),
      groups: ['TYPE','DURATION','UPLOAD DATE','FEATURES','PRIORITIZE'].map(g => new RegExp('(^|\\\\n|\\\\s)' + g + '\\\\b').test(text) ? g : null).filter(Boolean),
      checkboxCount: d.querySelectorAll('input[type=checkbox], [role=checkbox], [role=radio], input[type=radio]').length };
  })()`);
  await shot("search-filters");
  // honesty: toggle a control and see whether the result set reacts
  const wiring = await evalJS(`(() => {
    const d = [...document.querySelectorAll('[role=dialog], [class*=modal], [class*=dialog], details[open], [class*=filters]')].filter(e => e.getBoundingClientRect().width > 100).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    if (!d) return { toggled: false };
    const rowsBefore = document.querySelectorAll('main [class*=card], main [class*=result]').length;
    const cb = d.querySelector('input[type=checkbox], [role=checkbox], [role=radio], input[type=radio], [class*=option] button, [class*=row] button');
    if (!cb) return { toggled: false, note: 'no controls found', rowsBefore };
    cb.setAttribute('data-r29c-fctrl', '1');
    return { toggled: true, controlText: (cb.textContent || '').trim().slice(0, 24), rowsBefore };
  })()`);
  report.checks.filters.wiring = wiring;
  if (wiring?.toggled) {
    await ab("click", "[data-r29c-fctrl='1']");
    await sleep(1200);
    report.checks.filters.wiring.rowsAfter = await evalJS(`document.querySelectorAll('main [class*=card], main [class*=result]').length`);
    await shot("search-filters-after-toggle");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// D. WATCH PAGE SECOND ACT — geometry (D14/N21), action row (N9), channel row
//    (D11), description expander, keyboard set (N25), modes (theater/mini)
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
const cardHref = await evalJS(`(() => {
  const c = document.querySelector('main a[href*="/player"], main a.wfx-card, main [class*=card] a');
  return c ? c.getAttribute('href') : null;
})()`);
const watchUrl = cardHref ? (cardHref.startsWith("http") ? cardHref : BASE + cardHref) : `${BASE}/player`;
await open(watchUrl);
await sleep(1800);

report.checks.watchGeometry = await evalJS(`(() => {
  const player = document.querySelector('.wfx-player, [data-wfx-surface=player]');
  const layout = document.querySelector('.wfx-player__layout');
  const stagewrap = document.querySelector('[data-wfx-player-stagewrap], .wfx-player__stagewrap');
  const stage = document.querySelector('.wfx-player__stage, iframe');
  const sb = stage ? stage.getBoundingClientRect() : null;
  const sw = stagewrap ? stagewrap.getBoundingClientRect() : null;
  return {
    playerPadding: player ? getComputedStyle(player).padding : null,
    layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null,
    layoutGap: layout ? getComputedStyle(layout).gap : null,
    stagewrap: sw ? Math.round(sw.width) + 'x' + Math.round(sw.height) + ' @(' + Math.round(sw.x) + ',' + Math.round(sw.y) + ')' : null,
    stageBox: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null,
  };
})()`);

report.checks.watchhead = await evalJS(`(() => {
  const head = document.querySelector('.wfx-watchhead, [class*=watchhead]');
  if (!head) return { found: false };
  const b = head.getBoundingClientRect();
  const owner = head.querySelector('.wfx-owner, [class*=owner]');
  const actions = head.querySelector('.wfx-actions, [class*=actions]');
  const ob = owner ? owner.getBoundingClientRect() : null;
  const ab = actions ? actions.getBoundingClientRect() : null;
  const pills = [...(actions || head).querySelectorAll('button, a, [role=button], span')].map(e => {
    const pb = e.getBoundingClientRect(); if (pb.width < 4) return null;
    return { t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), box: Math.round(pb.width) + 'x' + Math.round(pb.height) };
  }).filter(Boolean).slice(0, 10);
  const split = [...(actions || head).querySelectorAll('[class*=split], [class*=segment], [class*=group]')].map(e => e.className.toString().slice(0, 40));
  return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height),
    ownerText: (owner?.textContent || '').trim().slice(0, 80),
    actionsText: (actions?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140),
    pills, splitPillClasses: split };
})()`);

// like/dislike honest split: does the split pill carry counts, and are they
// only real local user actions? (click like → count changes by exactly 1)
report.checks.likeSplit = await evalJS(`(() => {
  const like = [...document.querySelectorAll('button, [role=button]')].find(e => /^like\\b|^\\s*like/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()) && e.closest('.wfx-watchhead, [class*=watchhead], [class*=actions]'));
  const dislike = [...document.querySelectorAll('button, [role=button]')].find(e => /^dislike\\b/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()) && e.closest('.wfx-watchhead, [class*=watchhead], [class*=actions]'));
  const container = like?.parentElement;
  const cb = container ? container.getBoundingClientRect() : null; const cs = container ? getComputedStyle(container) : null;
  return {
    likePill: like ? { label: (like.getAttribute('aria-label') || '').slice(0, 30), box: Math.round(like.getBoundingClientRect().width) + 'x' + Math.round(like.getBoundingClientRect().height) } : null,
    dislikePill: dislike ? { label: (dislike.getAttribute('aria-label') || '').slice(0, 30) } : null,
    containerBox: cb ? Math.round(cb.width) + 'x' + Math.round(cb.height) : null, containerRadius: cs ? cs.borderRadius : null,
    containerClass: container ? container.className.toString().slice(0, 40) : null,
    likeCountText: like ? (like.textContent || '').replace(/[^0-9]/g, '') || null : null,
    dislikeCountText: dislike ? (dislike.textContent || '').replace(/[^0-9]/g, '') || null : null,
  };
})()`);
if (report.checks.likeSplit?.likePill) {
  await evalJS(`(() => { const l = [...document.querySelectorAll('button, [role=button]')].find(e => /^like\\b|^\\s*like/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()) && e.closest('.wfx-watchhead, [class*=watchhead], [class*=actions]')); if (l) { l.setAttribute('data-r29c-like', '1'); } return 'set'; })()`);
  await ab("click", "[data-r29c-like='1']");
  await sleep(900);
  report.checks.likeSplit.afterClick = await evalJS(`(() => {
    const l = [...document.querySelectorAll('button, [role=button]')].find(e => /^like\\b|^\\s*like/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()) && e.closest('.wfx-watchhead, [class*=watchhead], [class*=actions]'));
    const d = [...document.querySelectorAll('button, [role=button]')].find(e => /^dislike\\b/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()) && e.closest('.wfx-watchhead, [class*=watchhead], [class*=actions]'));
    return { likeText: (l?.textContent || '').trim().slice(0, 30), dislikeText: (d?.textContent || '').trim().slice(0, 30),
      localStorage: Object.fromEntries(Object.entries({ ...localStorage }).filter(([k]) => /like|wfx/i.test(k)).map(([k, v]) => [k, String(v).slice(0, 80)])) };
  })()`);
}

// subscribe pill (D11): corpus h≈36 r18 red; HONESTY — click → real save/follow?
report.checks.subscribe = await evalJS(`(() => {
  const s = [...document.querySelectorAll('button, a, [role=button]')].find(e => /^subscribe\\b|^\\s*subscribe/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()));
  if (!s) return { found: false };
  const b = s.getBoundingClientRect(); const st = getComputedStyle(s);
  return { found: true, label: (s.getAttribute('aria-label') || s.textContent || '').trim().slice(0, 30),
    box: Math.round(b.width) + 'x' + Math.round(b.height), radius: st.borderRadius, bg: st.backgroundColor, color: st.color };
})()`);
if (report.checks.subscribe?.found) {
  await evalJS(`(() => { [...document.querySelectorAll('button, a, [role=button]')].find(e => /^subscribe\\b/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()))?.setAttribute('data-r29c-sub', '1'); return 'set'; })()`);
  await ab("click", "[data-r29c-sub='1']");
  await sleep(1000);
  report.checks.subscribe.afterClick = await evalJS(`(() => {
    const s = [...document.querySelectorAll('button, a, [role=button]')].find(e => /^(subscribe|subscribed)\\b/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()));
    return { labelNow: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 30),
      pressed: s?.getAttribute('aria-pressed'), subscribeKeys: Object.keys(localStorage).filter(k => /subscri|follow|channel/i.test(k)),
      toast: (document.body.innerText.match(/(subscribed|saved|following)[^\\n]{0,40}/i) || [null])[0] };
  })()`);
  await shot("subscribe-after-click");
}

// description expander (N9/N10): corpus "...more" inline expander 14px/400
report.checks.description = await evalJS(`(() => {
  const d = document.querySelector('[data-wfx-player-description], .wfx-desc, [class*=desc]');
  if (!d) return { found: false };
  const body = d.querySelector('p, [class*=body], [class*=collapsed]');
  const bs = body ? getComputedStyle(body) : null;
  return { found: true, tag: d.tagName, open: d.open !== undefined ? d.open : null,
    expanderText: (d.textContent || '').match(/(\\.\\.\\.|more|show less)/i)?.[0] || null,
    bodyFont: bs ? bs.fontSize + '/' + bs.fontWeight + '/' + bs.lineHeight : null,
    collapsedHeight: Math.round(d.getBoundingClientRect().height) };
})()`);

// keyboard set (N25) — probe each key's OBSERVABLE effect
report.checks.keyboard = { preState: await evalJS(`(() => ({ url: location.pathname,
  muteLabel: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /^mute|^unmute/i.test(l || ''))[0] || null,
  playLabel: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /^(play|pause)/i.test(l || ''))[0] || null }))()`) };
const snapAfterKey = () => evalJS(`(() => ({
  url: location.pathname,
  theater: !!document.querySelector('.wfx-player--theater, [data-wfx-theater=true]'),
  stagewrapW: (() => { const s = document.querySelector('[data-wfx-player-stagewrap], .wfx-player__stagewrap'); return s ? Math.round(s.getBoundingClientRect().width) : null; })(),
  floatingMini: !!document.querySelector('[data-wfx-miniplayer], [class*=miniplayer][class*=floating], [class*=miniplayer][class*=open]'),
  fullscreen: !!document.fullscreenElement,
  muteLabel: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /^mute|^unmute/i.test(l || ''))[0] || null,
  playLabel: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /^(play|pause)/i.test(l || ''))[0] || null,
  captionsOverlay: !!document.querySelector('[class*=caption][class*=overlay], [data-wfx-captions], [class*=livecaption]'),
  commandStatus: (document.querySelector('[data-wfx-chrome-command], [class*=command], [class*=statusline]')?.textContent || '').trim().slice(0, 80) || null,
  position: (() => { const t = document.querySelector('[class*=time]'); return t ? (t.textContent || '').slice(0, 20) : null; })(),
}))()`);
for (const key of ["m", "k", "t", "i", "f", "c", "j", "l", "0"]) {
  await ab("press", key);
  await sleep(700);
  report.checks.keyboard[`press_${key}`] = await snapAfterKey();
  // revert toggles so probes stay independent (t toggles the theater class;
  // Escape exits fullscreen; m toggles back — a second press is the honest
  // revert for a toggle key; the corpus chrome is press-to-toggle)
  if (key === "t") { await ab("press", "t"); await sleep(600); }
  if (key === "m") { await ab("press", "m"); await sleep(400); }
  if (key === "f") { await ab("press", "Escape"); await sleep(500); }
}
report.checks.keyboard.postRevert = await snapAfterKey();
await shot("watch-keyboard-after");

// theater geometry (N25): corpus = 1296px full-content-width player
report.checks.theater = await evalJS(`(() => {
  const t = document.querySelector('[data-wfx-chrome-theater], button[aria-label*=theater i]');
  return { control: t ? (t.getAttribute('aria-label') || '').slice(0, 40) : null, on: t ? t.getAttribute('aria-pressed') : null };
})()`);
if (report.checks.theater?.control) {
  await ab("mouse", "move", 700, 500);  // reveal the chrome (3s idle fade law)
  await sleep(300);
  await evalJS(`(() => { document.querySelector('[data-wfx-chrome-theater]')?.setAttribute('data-r29c-theater', '1'); return 'set'; })()`);
  await ab("click", "[data-r29c-theater='1']");
  await sleep(900);
  report.checks.theater.after = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-player-stagewrap], .wfx-player__stagewrap');
    const layout = document.querySelector('.wfx-player__layout');
    return { theaterClass: !!document.querySelector('.wfx-player--theater, [data-wfx-theater=true]'),
      stagewrapW: s ? Math.round(s.getBoundingClientRect().width) : null, stagewrapX: s ? Math.round(s.getBoundingClientRect().x) : null,
      layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null };
  })()`);
  await shot("watch-theater");
  await evalJS(`(() => { const b = document.querySelector('[data-wfx-chrome-theater]'); if (b) b.click(); return 'reverted'; })()`);
  await sleep(500);
}

// miniplayer (N25): corpus = bottom-right floating persistent player
report.checks.miniplayer = await evalJS(`(() => {
  const m = document.querySelector('[data-wfx-chrome-miniplayer], button[aria-label*=miniplayer i]');
  return { control: m ? (m.getAttribute('aria-label') || '').slice(0, 40) : null };
})()`);
if (report.checks.miniplayer?.control) {
  await ab("mouse", "move", 700, 500);
  await sleep(300);
  await evalJS(`(() => { document.querySelector('[data-wfx-chrome-miniplayer]')?.setAttribute('data-r29c-mini', '1'); return 'set'; })()`);
  await ab("click", "[data-r29c-mini='1']");
  await sleep(1100);
  report.checks.miniplayer.after = await evalJS(`(() => ({
    floatingMini: !!document.querySelector('[data-wfx-miniplayer], [class*=miniplayer][class*=floating], [class*=miniplayer][class*=open]'),
    bodyChanged: !!document.querySelector('[class*=pip], [class*=miniplayer]'),
    commandToast: (document.body.innerText.match(/(picture-in-picture|miniplayer|refused)[^\\n]{0,50}/i) || [null])[0],
  }))()`);
  await shot("watch-miniplayer");
}

// ═══════════════════════════════════════════════════════════════════════════
// E. home field capture for the raised-gray pixel survey (run off-browser)
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(900);
await shot("home-field");

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`R29 PROBE -> ${OUT}`);
console.log(JSON.stringify({
  rail: { historyCount: report.checks.rail?.historyCount, items: report.checks.rail?.items },
  metaTheme: report.checks.metaTheme,
  durationBadge: report.checks.durationBadge,
  shortsShelf: report.checks.shortsShelf,
  channelSlot: report.checks.channelSlot,
  masthead: report.checks.masthead,
  gearMenu: report.checks.gearMenu,
  searchRows: report.checks.searchRows,
  filters: report.checks.filters,
  watchGeometry: report.checks.watchGeometry,
  watchhead: report.checks.watchhead,
  likeSplit: report.checks.likeSplit,
  subscribe: report.checks.subscribe,
  description: report.checks.description,
  keyboard: report.checks.keyboard,
  theater: report.checks.theater,
  miniplayer: report.checks.miniplayer,
}, null, 1).slice(0, 5000));
