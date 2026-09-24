#!/usr/bin/env bun
// R29-C STAGE-4 PROBE — B's rail/badge/shelf claims (D8/N4 History dedupe,
// N13 rail item anatomy 40h r10 14/400/20 + the sign-in promo, N19 the
// corner duration badge grammar 8px-inset 12/500 #fff on rgba(0,0,0,0.6) r4
// pad 1px 4px m:ss|h:mm:ss + the type badge's departure, N20 the shorts
// shelf 208×311 @4px gutters + the zero-width-track bug's fix).
// Corpus: home-anatomy.md / shorts-anatomy.md / search-anatomy.md.
// A check is VERIFIED only when THIS probe reproduces the claimed behavior.
// Usage: bun evidence/r29-recon/r29-s4probe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r29-recon/${TAG}.s4probe.json`);

const ab = async (...args: (string | number)[]): Promise<string> => {
  const p = await $`agent-browser ${args.map(String)}`.nothrow().quiet();
  return p.stdout.toString().trim();
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const evalJS = async (js: string): Promise<any> => {
  const out = await ab("eval", js);
  try { return JSON.parse(out); } catch { return out; }
};
const open = async (url: string) => { await ab("open", url); await ab("wait", "--load", "networkidle"); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const shot = (name: string) => ab("screenshot", resolve(`evidence/r29-recon/${TAG}-${name}.png`));

await ab("set", "viewport", 1440, 900);
const report: any = { tag: TAG, base: BASE, at: new Date().toISOString(), checks: {} };

// ── D8/N4 — the History dedupe + N13 — the rail grammar @1440 (labeled) ──
await open(`${BASE}/`);
await sleep(1200);
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
    items: labels, historyCount: labels.filter(l => /^history$/i.test(l)).join('|').length ? labels.filter(l => /^history$/i.test(l)).length : 0,
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
await shot("s4-rail");

// the active item's 500 weight (the active-pill grammar note)
report.checks.railActive = await evalJS(`(() => {
  const active = document.querySelector('a.wfx-navlink[aria-current], a[class*=navlink][class*=active]');
  if (!active) return { found: false };
  const s = getComputedStyle(active);
  return { found: true, label: (active.textContent || '').trim().slice(0, 20), font: s.fontSize + '/' + s.fontWeight };
})()`);

// the drawer form (the open guide) — the same corpus measure carries there
await evalJS(`(() => { const t = document.querySelector('[data-wfx-guidetoggle], [aria-label*=guide i], [aria-label*=menu i]'); if (t) { t.setAttribute('data-r29c-guide', '1'); return 'set'; } return 'no-toggle'; })()`);
const guideSet = await evalJS(`!!document.querySelector('[data-r29c-guide]')`);
if (guideSet) {
  await ab("click", "[data-r29c-guide='1']");
  await sleep(900);
  report.checks.railDrawer = await evalJS(`(() => {
    const nav = document.querySelector('nav.wfx-rail');
    const links = [...(nav ? nav.querySelectorAll('a.wfx-navlink, a[class*=navlink]') : [])];
    const item = links.find(l => /^home$/i.test((l.textContent || '').trim())) || links[0];
    const s = item ? getComputedStyle(item) : null;
    const b = item ? item.getBoundingClientRect() : null;
    const promo = document.querySelector('[data-wfx-rail-signin]');
    return { drawerRailW: nav ? Math.round(nav.getBoundingClientRect().width) : null,
      itemAnatomy: s ? { h: Math.round(b.height), radius: s.borderRadius, font: s.fontSize + '/' + s.fontWeight + '/' + s.lineHeight } : null,
      promoInDrawer: !!promo };
  })()`);
  await shot("s4-rail-drawer");
  await ab("press", "Escape");
}

// ── N19 — THE CORNER BADGE GRAMMAR (computed, byte-exact) ────────────────
await open(`${BASE}/`);
await sleep(1000);
await ab("scroll", "down", 700);
await sleep(700);
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
  // the type badge's departure: any visible pill whose text is a bare type word?
  const typeBadges = [...document.querySelectorAll('main [class*=badge], main [class*=pill]')]
    .filter(e => /^(short|video|movie|series|episode)$/i.test((e.textContent || '').trim()))
    .map(e => (e.textContent || '').trim());
  return { found: true, sample: out, badgeCount: document.querySelectorAll('.wfx-badge--duration, main [class*=badge][class*=duration]').length,
    typeBadges, ariaKeepsType: [...document.querySelectorAll('main [data-wfx-card]')].slice(0, 2).map(c => (c.getAttribute('aria-label') || '').slice(0, 70)) };
})()`);
await shot("s4-badges");

// the search row's variant (the badge inside the 500×281 thumb)
await open(`${BASE}/search?q=the`);
await sleep(1600);
report.checks.badgeSearchRow = await evalJS(`(() => {
  const row = document.querySelector('main a.wfx-result, main [data-wfx-card]');
  if (!row) return { found: false };
  const thumb = row.querySelector('[class*=thumb]');
  const badge = row.querySelector('.wfx-badge--duration, [class*=badge][class*=duration]');
  if (!badge || !thumb) return { found: false, hasBadge: !!badge, thumbBox: thumb ? Math.round(thumb.getBoundingClientRect().width) + 'x' + Math.round(thumb.getBoundingClientRect().height) : null };
  const tb = thumb.getBoundingClientRect(); const b = badge.getBoundingClientRect();
  const s = getComputedStyle(badge);
  return { found: true, text: (badge.textContent || '').trim(),
    thumbBox: Math.round(tb.width) + 'x' + Math.round(tb.height),
    inset: { right: Math.round(tb.right - b.right), bottom: Math.round(tb.bottom - b.bottom) },
    font: s.fontSize + '/' + s.fontWeight, bg: s.backgroundColor };
})()`);

// ── N20 — THE SHORTS SHELF 208×311 @4px GUTTERS (the zero-width fix) ─────
await open(`${BASE}/`);
await sleep(1000);
await ab("scroll", "down", 900);
await sleep(800);
report.checks.shortsShelf = await evalJS(`(() => {
  // the shelf: the section whose heading is exactly "Shorts"
  const headings = [...document.querySelectorAll('h1, h2, h3, [class*=heading], [class*=section]')].filter(h => /^shorts$/i.test((h.textContent || '').trim()));
  const section = headings.map(h => h.closest('section, div[class*=shelf], div[class*=row]') || h.parentElement).find(e => e && e.querySelectorAll('[class*=card], a').length > 2);
  if (!section) return { found: false, headings: headings.length };
  const cards = [...section.querySelectorAll('a')].filter(a => a.querySelector('[class*=thumb], img'));
  const thumbs = cards.map(a => { const t = a.querySelector('[class*=thumb]') || a; const b = t.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); });
  const widths = cards.map(a => Math.round(a.getBoundingClientRect().width));
  const gaps = cards.slice(0, 5).map((a, i) => cards[i + 1] ? Math.round(cards[i + 1].getBoundingClientRect().left - a.getBoundingClientRect().right) : null).filter(g => g !== null);
  const first = cards[0];
  const firstTitle = first ? (first.querySelector('[class*=title], h3, p')?.textContent || '').trim().slice(0, 40) : null;
  const titleBelow = first ? (() => { const t = first.querySelector('[class*=title], h3, p'); const th = first.querySelector('[class*=thumb]'); if (!t || !th) return null; return t.getBoundingClientRect().top > th.getBoundingClientRect().bottom - 2; })() : null;
  const channelRow = first ? !!first.querySelector('[class*=channel], [class*=meta]') : null;
  const badgeInShelf = cards.some(a => a.querySelector('[class*=badge]'));
  const s = getComputedStyle(section.querySelector('[class*=track], [class*=grid], [class*=scroller]') || section);
  return { found: true, cardCount: cards.length, cardWidths: widths.slice(0, 8), zeroWidthCards: widths.filter(w => w < 100).length,
    thumbs: thumbs.slice(0, 6), gutters: gaps.slice(0, 4), gridCols: s.gridTemplateColumns.slice(0, 80),
    titleBelow, firstTitle, channelRow, badgeInShelf,
    columns: Math.max(...widths) > 0 ? Math.round(section.getBoundingClientRect().width / (Math.max(...widths.filter(w => w > 0)) + (gaps[0] || 0))) : null };
})()`);
await shot("s4-shorts-shelf");

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`S4 PROBE -> ${OUT}`);
console.log(JSON.stringify({
  rail: report.checks.rail,
  railActive: report.checks.railActive,
  railDrawer: report.checks.railDrawer,
  badge: report.checks.badge,
  badgeSearchRow: report.checks.badgeSearchRow,
  shortsShelf: report.checks.shortsShelf,
}, null, 1).slice(0, 4600));
