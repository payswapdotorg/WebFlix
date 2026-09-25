#!/usr/bin/env bun
// R29-C STAGE-2 PROBE — B's search-surface claims (N3 anatomy + N23 chips/
// filters-dialog/URL-state) measured against the corpus sheets.
// Corpus: search-anatomy.md — row 1152 grid, thumb 500×281 r12, title
// 18/400/26 clamp-2, meta 12/400/18, avatar 24×24; dialog 696px paper,
// shadow rgba(0,0,0,0.15) 0 0 24px 12px, r12; groups TYPE/DURATION
// (+ UPLOAD DATE/FEATURES/PRIORITIZE honestly absent, named in-dialog).
// A check is VERIFIED only when THIS probe reproduces the claimed behavior.
// Usage: bun evidence/r29-recon/r29-s2probe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r29-recon/${TAG}.s2probe.json`);

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

// pick the query that answers on this boot (fixtures: neon; service: the)
let query = "the";
let n = 0;
for (const q of ["the", "neon", "rain", "lofi", "a"]) {
  await open(`${BASE}/search?q=${encodeURIComponent(q)}`);
  await sleep(1200);
  n = await evalJS(`document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length`);
  if (n > 0) { query = q; break; }
}
report.checks.query = { query, rows: n };

// ── N3 — the result-row anatomy (byte-exact) ─────────────────────────────
await open(`${BASE}/search?q=${encodeURIComponent(query)}`);
await sleep(1200);
report.checks.rowAnatomy = await evalJS(`(() => {
  const row = document.querySelector('main a.wfx-result, main [data-wfx-card]');
  if (!row) return { found: false };
  const grid = row.parentElement;
  const gs = getComputedStyle(grid);
  const b = row.getBoundingClientRect();
  const thumb = row.querySelector('.wfx-result__thumb, [class*=thumb]');
  const tb = thumb ? thumb.getBoundingClientRect() : null;
  const ts = thumb ? getComputedStyle(thumb) : null;
  const title = row.querySelector('.wfx-result__title, [class*=title], h3');
  const tSt = title ? getComputedStyle(title) : null;
  const meta = row.querySelector('.wfx-result__metainfo, [class*=metainfo], [class*=meta]');
  const mSt = meta ? getComputedStyle(meta) : null;
  const avatar = row.querySelector('.wfx-result__avatar, [class*=avatar], [class*=monogram]');
  const ab = avatar ? avatar.getBoundingClientRect() : null;
  const aSt = avatar ? getComputedStyle(avatar) : null;
  return {
    found: true, rowCount: document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length,
    row: Math.round(b.width) + 'x' + Math.round(b.height),
    grid: { display: gs.display, cols: gs.gridTemplateColumns, gap: gs.gap, maxWidth: gs.maxWidth,
            gridBox: Math.round(grid.getBoundingClientRect().width) },
    thumb: tb ? Math.round(tb.width) + 'x' + Math.round(tb.height) : null,
    thumbRadius: ts ? ts.borderRadius : null, thumbOverflow: ts ? ts.overflow : null,
    title: tSt ? { font: tSt.fontSize + '/' + tSt.fontWeight + '/' + tSt.lineHeight,
      clamp: tSt.webkitLineClamp, overflow: tSt.overflow, display: tSt.display } : null,
    meta: mSt ? { font: mSt.fontSize + '/' + mSt.fontWeight + '/' + mSt.lineHeight, color: mSt.color } : null,
    metaLine: (() => { const m = row.querySelector('.wfx-result__metainfo'); return m ? { font: getComputedStyle(m).fontSize + '/' + getComputedStyle(m).fontWeight + '/' + getComputedStyle(m).lineHeight, color: getComputedStyle(m).color } : null; })(),
    avatar: ab ? Math.round(ab.width) + 'x' + Math.round(ab.height) : null,
    avatarRadius: aSt ? aSt.borderRadius : null,
    avatarText: avatar ? (avatar.textContent || '').trim().slice(0, 8) : null,
    channelFont: (() => { const c = row.querySelector('[class*=channel], [class*=source]');
      return c ? getComputedStyle(c).fontSize + '/' + getComputedStyle(c).fontWeight : null; })(),
  };
})()`);
await shot("s2-search-row");

// ── N23 — the contextual chips (only the types really present) ───────────
report.checks.chips = await evalJS(`(() => {
  const chips = [...document.querySelectorAll('[data-wfx-search-chip]')].map(c => ({
    text: (c.textContent || '').trim(), href: c.getAttribute('href'),
    active: c.className.includes('active') }));
  const allChips = [...document.querySelectorAll('.wfx-chipbar a, .wfx-chipbar button')].map(c => (c.textContent || '').trim());
  return { chips, unbackedChips: allChips.filter(t => /unwatched|watched|recently|live/i.test(t)) };
})()`);
await shot("s2-chips");

// ── N23 — the filters dialog (the 696px paper anatomy) ───────────────────
const filtersBtn = await evalJS(`(() => {
  const b = document.querySelector('[data-wfx-search-filters]');
  if (!b) return null;
  b.setAttribute('data-r29c-f', '1');
  return { found: true, expanded: b.getAttribute('aria-expanded'), box: Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height) };
})()`);
report.checks.filtersButton = filtersBtn;
if (filtersBtn?.found) {
  await ab("click", "[data-r29c-f='1']");
  await sleep(900);
  report.checks.filtersDialog = await evalJS(`(() => {
    const d = document.querySelector('[data-wfx-filters-dialog]');
    if (!d) return { found: false };
    const b = d.getBoundingClientRect(); const s = getComputedStyle(d);
    const options = [...d.querySelectorAll('[data-wfx-filter-option]')].map(o => ({
      text: (o.textContent || '').trim().slice(0, 24), wfx: o.getAttribute('data-wfx-filter-option'),
      href: o.getAttribute('href'), active: o.getAttribute('aria-current') === 'true' }));
    const close = d.querySelector('[data-wfx-filters-close]');
    const cb = close ? close.getBoundingClientRect() : null;
    const absent = d.querySelector('[data-wfx-filters-absent]');
    return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height),
      radius: s.borderRadius, bg: s.backgroundColor, shadow: s.boxShadow.slice(0, 80),
      title: (d.querySelector('h2, h3, [class*=title]')?.textContent || '').trim().slice(0, 30),
      groups: [...d.querySelectorAll('[data-wfx-filter-group]')].map(g => g.getAttribute('data-wfx-filter-group')),
      groupHeadings: [...d.querySelectorAll('h3, [class*=group] h4')].map(h => (h.textContent || '').trim()).slice(0, 8),
      options, absenceNote: absent ? absent.textContent.trim().slice(0, 200) : null,
      absenceNamesGroups: ['UPLOAD DATE','FEATURES','PRIORITIZE'].filter(g => (absent?.textContent || '').toUpperCase().includes(g)),
      closeButton: cb ? Math.round(cb.width) + 'x' + Math.round(cb.height) : null,
      checkboxCount: d.querySelectorAll('input[type=checkbox], [role=checkbox], [role=radio]').length };
  })()`);
  await shot("s2-filters-dialog");
  // the X closes honestly
  await evalJS(`document.querySelector('[data-wfx-filters-close]')?.setAttribute('data-r29c-close', '1'); 'ok'`);
  await ab("click", "[data-r29c-close='1']");
  await sleep(600);
  report.checks.dialogCloses = await evalJS(`!document.querySelector('[data-wfx-filters-dialog]')`);
}

// ── N23 — the URL is the filter state (server-side truth over the real set) ──
const countAt = async (suffix: string): Promise<any> => {
  await open(`${BASE}/search?q=${encodeURIComponent(query)}${suffix}`);
  await sleep(1300);
  return evalJS(`(() => ({
    rows: document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length,
    subtitle: (document.querySelector('main p, main [class*=count], main [class*=results]')?.textContent || '').trim().slice(0, 90),
    filtered: !!document.querySelector('main') && /\\(filtered\\)/.test(document.querySelector('main').innerText.slice(0, 3000)),
    emptyFiltered: /nothing matches this filter/i.test(document.body.innerText),
    emptyText: (document.body.innerText.match(/Nothing matches this filter[^\\n]{0,80}/i) || [null])[0],
    chips: [...document.querySelectorAll('[data-wfx-search-chip]')].map(c => (c.textContent || '').trim()),
  }))()`);
};
report.checks.urlState = {
  all: await countAt(""),
  typeVideo: await countAt("&type=video"),
  typeShort: await countAt("&type=short"),
  typeBogus: await countAt("&type=bogus"),
  durUnder3: await countAt("&duration=under-3"),
  dur3to20: await countAt("&duration=3-20"),
  durOver20: await countAt("&duration=over-20"),
  durBogus: await countAt("&duration=bogus"),
};
await shot("s2-filtered-empty");

// the no-matches state keeps its own truth (a different empty than filtered)
report.checks.noMatchesState = await (async () => {
  await open(`${BASE}/search?q=zzzznotathing`);
  await sleep(1300);
  return evalJS(`(() => ({
    rows: document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length,
    nothingMatches: /nothing matches this filter/i.test(document.body.innerText),
    bodyHead: (document.querySelector('main')?.innerText || '').trim().slice(0, 160) }))()`);
})();

// the wiring proof: click a dialog option -> the URL + result set react
await open(`${BASE}/search?q=${encodeURIComponent(query)}`);
await sleep(1200);
const wired = await evalJS(`(() => {
  const b = document.querySelector('[data-wfx-search-filters]');
  if (!b) return { ok: false };
  b.setAttribute('data-r29c-w', '1'); return { ok: true };
})()`);
if (wired?.ok) {
  await ab("click", "[data-r29c-w='1']");
  await sleep(800);
  const target = await evalJS(`(() => {
    const opts = [...document.querySelectorAll('[data-wfx-filter-option]')];
    const o = opts.find(x => /(&|\\?)type=|(&|\\?)duration=/.test(x.getAttribute('href') || '')) || opts[0];
    if (!o) return null;
    o.setAttribute('data-r29c-opt', '1');
    return { text: (o.textContent || '').trim().slice(0, 24), wfx: o.getAttribute('data-wfx-filter-option'), href: o.getAttribute('href') };
  })()`);
  report.checks.wiring = { target };
  if (target) {
    await ab("click", "[data-r29c-opt='1']");
    await sleep(1500);
    report.checks.wiring.after = await evalJS(`(() => ({
      url: location.search,
      rows: document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length,
      filtered: /\\(filtered\\)/.test(document.querySelector('main').innerText.slice(0, 3000)) }))()`);
    await shot("s2-wiring-after");
  }
}

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`S2 PROBE -> ${OUT}`);
console.log(JSON.stringify({
  query: report.checks.query,
  rowAnatomy: report.checks.rowAnatomy,
  chips: report.checks.chips,
  filtersDialog: report.checks.filtersDialog,
  urlState: report.checks.urlState,
  wiring: report.checks.wiring,
}, null, 1).slice(0, 4600));
