#!/usr/bin/env bun
// R29-C DIFFERENTIAL PROBE — the subscribe honesty gate's decisive test.
// Question: does the Subscribe write round-trip to the user-visible library
// surfaces (Library page + reload), and is that behavior B-specific or the
// pre-existing dev-module-graph seam split (the R24 dev-boot bridge law)?
// Method: on ONE boot, test BOTH writes (watchlist save + subscribe) with the
// RAW POST receipts captured, then the read surfaces (Library page, reload).
// Usage: bun evidence/r29-recon/r29-diffprobe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "diff";
const OUT = resolve(`evidence/r29-recon/${TAG}.diffprobe.json`);

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

await ab("set", "viewport", 1440, 900);
const report: any = { tag: TAG, base: BASE, at: new Date().toISOString(), checks: {} };

// robust navigation: poll for a PARAMETERIZED player card link (the dev
// server's first compile can outlast networkidle)
let watchHref: string | null = null;
for (let i = 0; i < 20 && watchHref === null; i++) {
  await open(`${BASE}/`);
  watchHref = await evalJS(`document.querySelector('main a[href*="/player"][href*="id="]')?.getAttribute('href') || null`);
  if (watchHref === null) await sleep(1500);
}
report.checks.entry = { watchHref };
const watchUrl = watchHref ? BASE + watchHref : `${BASE}/player`;
await open(watchUrl);
await sleep(2000);

const ids = await evalJS(`(() => {
  const params = new URLSearchParams(location.search);
  return { itemId: params.get('id'), connectorId: params.get('connector'), externalRef: params.get('ref'), title: params.get('title'), type: params.get('type') };
})()`);
report.checks.itemIdentity = ids;

// ── 1. THE RAW SUBSCRIBE WRITE (the pill's own fetch, receipt captured) ────
report.checks.rawSubscribePost = await evalJS(`(async () => {
  const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'save', itemId: ${JSON.stringify(ids.itemId)}, title: ${JSON.stringify(ids.title)},
      connectorId: ${JSON.stringify(ids.connectorId)}, externalRef: ${JSON.stringify(ids.externalRef)}, listName: 'Subscriptions' }) });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`);

// ── 2. THE RAW WATCHLIST WRITE (the R24 machinery, no listName) ─────────────
report.checks.rawWatchlistPost = await evalJS(`(async () => {
  const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'save', itemId: ${JSON.stringify(ids.itemId)}, title: ${JSON.stringify(ids.title)},
      connectorId: ${JSON.stringify(ids.connectorId)}, externalRef: ${JSON.stringify(ids.externalRef)} }) });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`);

// ── 3. THE READ SURFACES after both writes ─────────────────────────────────
await open(`${BASE}/library`);
await sleep(1600);
report.checks.libraryAfterWrites = await evalJS(`(() => {
  const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
  const watchSection = [...document.querySelectorAll('section')].find(s => /watchlist/i.test(s.getAttribute('aria-label') || s.querySelector('h2')?.textContent || ''));
  const watchRows = watchSection ? (watchSection.textContent || '').slice(0, 220) : null;
  return { playlists: lists.map(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim()),
    watchlistText: watchRows };
})()`);

// ── 4. THE RELOAD SURFACE: does either save survive SSR? ───────────────────
await open(watchUrl);
await sleep(1800);
report.checks.reloadStates = await evalJS(`(() => {
  const sub = document.querySelector('[data-wfx-subscribe]');
  const save = [...document.querySelectorAll('button')].find(b => /^save\\b|watchlist/i.test(b.getAttribute('aria-label') || ''));
  return { subscribeState: sub ? sub.getAttribute('data-wfx-subscribe-state') : 'n/a',
    subscribeLabel: (sub ? (sub.getAttribute('aria-label') || sub.textContent) : '').trim().slice(0, 50),
    saveLabel: (save ? (save.getAttribute('aria-label') || save.textContent) : '').trim().slice(0, 60),
    savePressed: save ? save.getAttribute('aria-pressed') : null };
})()`);

// ── 5. CLEANUP: remove both writes (the runtime's remove op) ────────────────
report.checks.cleanup = await evalJS(`(async () => {
  const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'remove', itemId: ${JSON.stringify(ids.itemId)}, connectorId: ${JSON.stringify(ids.connectorId)}, externalRef: ${JSON.stringify(ids.externalRef)} }) });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`);

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks, null, 2).slice(0, 3500));
console.log("WROTE " + OUT);
