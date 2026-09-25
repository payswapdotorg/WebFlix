#!/usr/bin/env bun
// R29 PRODUCTION SWEEP — PROBE 1: SEARCH (N3 row anatomy + N23 chips / the
// 696px filters dialog / the URL filter state). Adapted from C's r29-s2probe
// house style, pointed at PRODUCTION (never a local build).
// Usage: bun evidence/r29-sweep/sweep-search.ts <base>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "https://webflix-steel.vercel.app";
const OUT = resolve("evidence/r29-sweep/probes/search.json");

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

// pick the query that answers on production (service feed)
let query = "the";
let n = 0;
for (const q of ["the", "neon", "rain", "lofi", "a"]) {
  await open(`${BASE}/search?q=${encodeURIComponent(q)}`);
  await sleep(1800);
  n = Number(await evalJS(`document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length`));
  if (n > 0) { query = q; break; }
}
report.checks.query = { query, rows: n };
await save();

// ── N3 — the result-row anatomy (byte-exact) ────────────────────────────────
await open(`${BASE}/search?q=${encodeURIComponent(query)}`);
await sleep(1800);
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
await save();

// ── N23 — the contextual chips (only the types really present) ─────────────
report.checks.chips = await evalJS(`(() => {
  const chips = [...document.querySelectorAll('[data-wfx-search-chip]')].map(c => ({
    text: (c.textContent || '').trim(), href: c.getAttribute('href'),
    active: c.className.includes('active') }));
  const allChips = [...document.querySelectorAll('.wfx-chipbar a, .wfx-chipbar button')].map(c => (c.textContent || '').trim());
  return { chips, unbackedChips: allChips.filter(t => /unwatched|watched|recently|live/i.test(t)) };
})()`);
await save();

// ── N23 — the filters dialog (the 696px paper anatomy) ─────────────────────
const filtersBtn = await evalJS(`(() => {
  const b = document.querySelector('[data-wfx-search-filters]');
  if (!b) return null;
  b.setAttribute('data-r29s-f', '1');
  return { found: true, expanded: b.getAttribute('aria-expanded'), box: Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height) };
})()`);
report.checks.filtersButton = filtersBtn;
if (filtersBtn && (filtersBtn as Rec)["found"]) {
  await ab("click", "[data-r29s-f='1']");
  await sleep(1200);
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
  await save();
  // the X closes honestly
  await evalJS(`document.querySelector('[data-wfx-filters-close]')?.setAttribute('data-r29s-close', '1'); 'ok'`);
  await ab("click", "[data-r29s-close='1']");
  await sleep(800);
  report.checks.dialogCloses = await evalJS(`!document.querySelector('[data-wfx-filters-dialog]')`);
}

// ── N23 — the URL is the filter state (server-rendered truth over the real set) ──
const countAt = async (suffix: string): Promise<unknown> => {
  await open(`${BASE}/search?q=${encodeURIComponent(query)}${suffix}`);
  await sleep(2000);
  return evalJS(`(() => ({
    url: location.search,
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
await save();

// the no-matches state keeps its own truth
await open(`${BASE}/search?q=zzzznotathing`);
await sleep(2000);
report.checks.noMatchesState = await evalJS(`(() => ({
  rows: document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length,
  nothingMatches: /nothing matches this filter/i.test(document.body.innerText),
  bodyHead: (document.querySelector('main')?.innerText || '').trim().slice(0, 160) }))()`);

// the wiring proof: click a dialog option -> the URL + result set react
await open(`${BASE}/search?q=${encodeURIComponent(query)}`);
await sleep(1800);
const wired = await evalJS(`(() => {
  const b = document.querySelector('[data-wfx-search-filters]');
  if (!b) return { ok: false };
  b.setAttribute('data-r29s-w', '1'); return { ok: true };
})()`);
if (wired && (wired as Rec)["ok"]) {
  await ab("click", "[data-r29s-w='1']");
  await sleep(1000);
  const target = await evalJS(`(() => {
    const opts = [...document.querySelectorAll('[data-wfx-filter-option]')];
    const o = opts.find(x => /(&|\\?)type=|(&|\\?)duration=/.test(x.getAttribute('href') || '')) || opts[0];
    if (!o) return null;
    o.setAttribute('data-r29s-opt', '1');
    return { text: (o.textContent || '').trim().slice(0, 24), wfx: o.getAttribute('data-wfx-filter-option'), href: o.getAttribute('href') };
  })()`);
  report.checks.wiring = { target };
  if (target) {
    await ab("click", "[data-r29s-opt='1']");
    await sleep(2000);
    report.checks.wiring.after = await evalJS(`(() => ({
      url: location.search,
      rows: document.querySelectorAll('main a.wfx-result, main [data-wfx-card]').length,
      filtered: /\\(filtered\\)/.test(document.querySelector('main').innerText.slice(0, 3000)) }))()`);
  }
}

await save();
console.log(`SEARCH PROBE -> ${OUT}`);
console.log(JSON.stringify({ query: report.checks.query, rowAnatomy: report.checks.rowAnatomy,
  filtersDialog: report.checks.filtersDialog, urlState: report.checks.urlState, wiring: report.checks.wiring }, null, 1).slice(0, 4200));
