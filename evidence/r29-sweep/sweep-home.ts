#!/usr/bin/env bun
// R29 PRODUCTION SWEEP — PROBE 4: HOME. The corner duration badge grammar
// (N19), the shorts shelf 208×311 @4px gutters + the zero-width fix (N20),
// the rail History dedupe + item anatomy + the sign-in promo (D8/N4 + N13) —
// against PRODUCTION.
// Usage: bun evidence/r29-sweep/sweep-home.ts <base>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "https://webflix-steel.vercel.app";
const OUT = resolve("evidence/r29-sweep/probes/home.json");

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

// ── D8/N4 — the History dedupe + N13 — the rail grammar @1440 (labeled) ──
await open(`${BASE}/`);
await sleep(1800);
report.checks.rail = await evalJS(`(() => {
  const nav = document.querySelector('nav.wfx-rail');
  const links = [...(nav ? nav.querySelectorAll('a.wfx-navlink, a[class*=navlink]') : [])];
  const item = links.find(l => /^home$/i.test((l.textContent || '').trim())) || links[0];
  const s = item ? getComputedStyle(item) : null;
  const b = item ? item.getBoundingClientRect() : null;
  const labels = links.map(l => (l.textContent || '').replace(/\\s+/g, ' ').trim());
  const promo = document.querySelector('[data-wfx-rail-signin]');
  const promoLink = promo ? promo.querySelector('[data-wfx-rail-signin-link]') : null;
  const ps = promoLink ? getComputedStyle(promoLink) : null;
  const pb = promoLink ? promoLink.getBoundingClientRect() : null;
  return {
    railW: nav ? Math.round(nav.getBoundingClientRect().width) : null,
    items: labels, historyCount: labels.filter(l => /^history$/i.test(l)).length,
    historyHref: (links.find(l => /^history$/i.test((l.textContent || '').trim())) || {}).href || null,
    itemAnatomy: s ? { h: Math.round(b.height), radius: s.borderRadius, font: s.fontSize + '/' + s.fontWeight + '/' + s.lineHeight } : null,
    promo: promo ? { text: (promo.querySelector('p')?.textContent || '').trim(),
      pillBox: pb ? Math.round(pb.width) + 'x' + Math.round(pb.height) : null,
      pillHref: promoLink?.getAttribute('href') || null,
      pillBg: ps ? ps.backgroundColor : null, pillRadius: ps ? ps.borderRadius : null } : null,
    explore: labels.some(l => /explore|music|movies|live/i.test(l)),
    moreFromYT: labels.some(l => /more from youtube/i.test(l)),
    footer: labels.some(l => /^(about|press|copyright|contact us|creators|advertise|developers|terms)$/i.test(l)),
    locationChip: labels.some(l => /location|country/i.test(l)),
  };
})()`);
await save();

// the active item's 500 weight (the active-pill grammar note)
report.checks.railActive = await evalJS(`(() => {
  const active = document.querySelector('a.wfx-navlink[aria-current], a[class*=navlink][class*=active]');
  if (!active) return { found: false };
  const s = getComputedStyle(active);
  return { found: true, label: (active.textContent || '').trim().slice(0, 20), font: s.fontSize + '/' + s.fontWeight };
})()`);

// an INACTIVE labeled item — the corpus 14/400 measure
report.checks.railInactive = await evalJS(`(() => {
  const links = [...document.querySelectorAll('nav.wfx-rail a.wfx-navlink, nav.wfx-rail a[class*=navlink]')];
  const item = links.find(l => !l.hasAttribute('aria-current') && /^shorts$|^watch$|^library$/i.test((l.textContent || '').trim()));
  if (!item) return { found: false };
  const s = getComputedStyle(item); const b = item.getBoundingClientRect();
  return { found: true, label: (item.textContent || '').trim(), h: Math.round(b.height), radius: s.borderRadius, font: s.fontSize + '/' + s.fontWeight + '/' + s.lineHeight };
})()`);
await save();

// ── N19 — THE CORNER BADGE GRAMMAR (computed, byte-exact) ────────────────
await ab("scroll", "down", 700);
await sleep(1000);
report.checks.badge = await evalJS(`(() => {
  const badges = [...document.querySelectorAll('.wfx-badge--duration, main [class*=badge][class*=duration]')].slice(0, 3);
  if (!badges.length) return { found: false };
  const out = badges.map(e => {
    const s = getComputedStyle(e);
    const thumb = e.closest('[class*=thumb]');
    const tb = thumb ? thumb.getBoundingClientRect() : e.parentElement.getBoundingClientRect();
    const b = e.getBoundingClientRect();
    return { text: (e.textContent || '').trim(),
      font: s.fontSize + '/' + s.fontWeight, color: s.color, bg: s.backgroundColor,
      radius: s.borderRadius, pad: s.padding,
      inset: { right: Math.round(tb.right - b.right), bottom: Math.round(tb.bottom - b.bottom) },
      format: /^\\d{1,2}:\\d{2}(:\\d{2})?$/.test((e.textContent || '').trim()) ? 'm:ss|h:mm:ss' : 'OTHER' };
  });
  const typeBadges = [...document.querySelectorAll('main [class*=badge], main [class*=pill]')]
    .filter(e => /^(short|video|movie|series|episode)$/i.test((e.textContent || '').trim()))
    .map(e => (e.textContent || '').trim());
  return { found: true, sample: out, badgeCount: document.querySelectorAll('.wfx-badge--duration, main [class*=badge][class*=duration]').length,
    typeBadges, ariaKeepsType: [...document.querySelectorAll('main [data-wfx-card]')].slice(0, 2).map(c => (c.getAttribute('aria-label') || '').slice(0, 70)) };
})()`);
await save();

// the search row's variant (the badge inside the 500×281 thumb)
let badgeQuery = "the";
for (const q of ["the", "neon", "rain", "lofi", "a"]) {
  await open(`${BASE}/search?q=${encodeURIComponent(q)}`);
  await sleep(2000);
  const has = await evalJS(`(() => { const r = document.querySelector('main a.wfx-result, main [data-wfx-card]'); return !!r && !!r.querySelector('.wfx-badge--duration, [class*=badge][class*=duration]'); })()`);
  if (has) { badgeQuery = q; break; }
}
report.checks.badgeSearchRow = await evalJS(`(() => {
  const row = document.querySelector('main a.wfx-result, main [data-wfx-card]');
  if (!row) return { found: false, query: '${badgeQuery}' };
  const thumb = row.querySelector('[class*=thumb]');
  const badge = row.querySelector('.wfx-badge--duration, [class*=badge][class*=duration]');
  if (!badge || !thumb) return { found: false, query: '${badgeQuery}', hasBadge: !!badge, thumbBox: thumb ? Math.round(thumb.getBoundingClientRect().width) + 'x' + Math.round(thumb.getBoundingClientRect().height) : null };
  const tb = thumb.getBoundingClientRect(); const b = badge.getBoundingClientRect();
  const s = getComputedStyle(badge);
  return { found: true, query: '${badgeQuery}', text: (badge.textContent || '').trim(),
    thumbBox: Math.round(tb.width) + 'x' + Math.round(tb.height),
    inset: { right: Math.round(tb.right - b.right), bottom: Math.round(tb.bottom - b.bottom) },
    font: s.fontSize + '/' + s.fontWeight, bg: s.backgroundColor };
})()`);
await save();

// ── N20 — THE SHORTS SHELF 208×311 @4px GUTTERS (the zero-width fix) ─────
await open(`${BASE}/`);
await sleep(1600);
await ab("scroll", "down", 900);
await sleep(1100);
report.checks.shortsShelf = await evalJS(`(() => {
  const section = document.querySelector('[data-wfx-row="shorts"]');
  const scroller = document.querySelector('.wfx-row__scroller--shorts');
  if (!section || !scroller) return { found: false, hasSection: !!section, hasScroller: !!scroller };
  const cards = [...scroller.querySelectorAll('a')].filter(a => a.getBoundingClientRect().height > 100);
  const thumbs = cards.map(a => { const t = a.querySelector('.wfx-card__thumb--vertical, [class*=thumb]'); const b = (t || a).getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); });
  const widths = cards.map(a => Math.round(a.getBoundingClientRect().width));
  const gaps = cards.slice(0, 5).map((a, i) => cards[i + 1] ? Math.round(cards[i + 1].getBoundingClientRect().left - a.getBoundingClientRect().right) : null).filter(g => g !== null);
  const first = cards[0];
  const firstTitle = first ? (first.querySelector('[class*=title], h3, p')?.textContent || '').trim().slice(0, 40) : null;
  const titleBelow = first ? (() => { const t = first.querySelector('[class*=title], h3, p'); const th = first.querySelector('[class*=thumb]'); if (!t || !th) return null; return t.getBoundingClientRect().top > th.getBoundingClientRect().bottom - 2; })() : null;
  const channelRow = first ? !!first.querySelector('[class*=channel], [class*=meta]:not([class*=thumb])') : null;
  const badgeInShelf = cards.some(a => a.querySelector('[class*=badge]'));
  const s = getComputedStyle(scroller);
  const usedCols = s.gridTemplateColumns.split(' ').filter(Boolean);
  return { found: true, cardCount: cards.length, cardWidths: widths.slice(0, 8), zeroWidthCards: widths.filter(w => w < 100).length,
    thumbs: thumbs.slice(0, 6), gutters: gaps.slice(0, 4),
    computedTrackWidths: [...new Set(usedCols.map(c => c.replace(/\\s/g, '')))],
    autoColumns: s.gridAutoColumns, gap: s.gap, flow: s.gridAutoFlow,
    titleBelow, firstTitle, channelRow, badgeInShelf,
    columns: Math.max(...widths, 1) > 0 ? Math.round(scroller.getBoundingClientRect().width / (Math.max(...widths.filter(w => w > 0)) + (gaps[0] || 0))) : null };
})()`);
await save();

await save();
console.log(`HOME PROBE -> ${OUT}`);
console.log(JSON.stringify(report.checks, null, 1).slice(0, 4600));
