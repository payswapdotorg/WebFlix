#!/usr/bin/env bun
// R30-A REPRO PROBE — the Subscribe reload-durability split (the R29 sweep's
// ONE LOUD FINDING, DIVERGENCES.md #1): the write path is REAL and DURABLE
// server-side, but the watch page never hydrates it on a fresh load:
//   (a) a FRESH watch-page load renders the Subscribe pill idle despite the
//       stored subscription;
//   (b) a fresh-load unsubscribe POST {op:"remove"} answers not-found
//       ("not in the local watchlist" — the client runtime's per-load map
//       is empty).
// Method (the b-probe house style — r29-diffprobe.ts's decisive-test shape):
// on ONE boot, drive the REAL pill click, read the REAL Library page, RELOAD
// the REAL watch URL, then POST the raw remove the pill would send — every
// receipt captured verbatim. PHASE "fresh-load" (the production-lambda
// simulation): assumes the stored truth was written by an EARLIER boot (a
// server restart between the phases = a fresh lambda), opens the watch page
// cold, reads the pill, POSTs the remove the pill would send, then cleans
// up through the in-view round trip.
// Usage: bun evidence/r30-web/repro/r30-repro-probe.ts <base> <tag> [phase]
//   phase: full (default) | fresh-load
//   writes evidence/r30-web/repro/<tag>.repro.json

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "repro";
const PHASE = process.argv[4] ?? "full";
const OUT = resolve(`evidence/r30-web/repro/${TAG}.repro.json`);

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
const shot = (name: string) => ab("screenshot", resolve(`evidence/r30-web/repro/${TAG}-${name}.png`));

await ab("set", "viewport", 1440, 900);
const report: { tag: string; base: string; at: string; phase: string; checks: Record<string, unknown> } = { tag: TAG, base: BASE, at: new Date().toISOString(), phase: PHASE, checks: {} };
const save = () => Bun.write(OUT, JSON.stringify(report, null, 2));

// ── entry: navigate home, click through to a REAL watch page ────────────────
// (the fresh-load phase ALSO enters through home — the reload's honest path;
//  the FIRST card is deterministic, so the watch URL matches the full phase's.
//  Robust navigation: the dev server's first compile can outlast networkidle,
//  so an empty/absent href RETRIES — never a silent wrong-page probe.)
let watchHref: string | null = null;
for (let i = 0; i < 24 && (watchHref === null || watchHref === ""); i++) {
  await open(`${BASE}/`);
  await sleep(1800);
  const probed = await evalJS(`document.querySelector('main a[href*="/player"][href*="id="]')?.getAttribute('href') || null`);
  watchHref = typeof probed === "string" && probed.length > 0 ? probed : null;
}
report.checks.entry = { watchHref };
if (typeof watchHref !== "string" || watchHref.length === 0) {
  report.checks.entryFailure = "the home page never exposed a /player card link (the probe cannot run)";
  await save();
  console.log(`REPRO PROBE -> ${OUT} (ENTRY FAILED)`);
  process.exit(0);
}
const watchUrl = BASE + String(watchHref);
await open(watchUrl);
await sleep(2200);
save();

const ids = await evalJS(`(() => {
  const params = new URLSearchParams(location.search);
  return { itemId: params.get('id'), connectorId: params.get('connector'), externalRef: params.get('ref'), title: params.get('title'), type: params.get('type') };
})()`);
report.checks.itemIdentity = ids;
save();

// ── 1. THE FRESH PILL STATE (before any write — the fresh-load phase's
//    core check: the stored truth was written by an EARLIER boot; the pill
//    must render it) ────────────────────────────────────────────────────────
report.checks.pillFresh = await evalJS(`(() => {
  const s = document.querySelector('[data-wfx-subscribe]');
  return s ? { state: s.getAttribute('data-wfx-subscribe-state'), pressed: s.getAttribute('aria-pressed') } : null;
})()`);
await shot("watch-fresh");

const subBtn = '[data-wfx-subscribe]';
const subPresent = await evalJS(`!!document.querySelector('${subBtn}')`);

// The pill's own unsubscribe POST (op:"remove" + the source identity it
// carries — the ChannelRow posts title/connector/ref verbatim).
const freshLoadRemovePost = `(async () => {
  const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'remove', itemId: ${JSON.stringify(ids.itemId)}, title: ${JSON.stringify(ids.title)},
      connectorId: ${JSON.stringify(ids.connectorId)}, externalRef: ${JSON.stringify(ids.externalRef)}, listName: 'Subscriptions' }) });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`;
// The r29-diffprobe's title-less variant (no source identity: the posted id
// is the truth — the bridge cannot resolve it; the local map answers).
const freshLoadRemoveNoIdentityPost = `(async () => {
  const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'remove', itemId: ${JSON.stringify(ids.itemId)}, connectorId: ${JSON.stringify(ids.connectorId)}, externalRef: ${JSON.stringify(ids.externalRef)} }) });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`;

if (PHASE === "fresh-load") {
  // ══ THE PRODUCTION-LAMBDA SIMULATION (a server restart happened since the
  //    write; the stored truth is the ONLY cross-boot state) ══════════════
  await open(`${BASE}/library`);
  await sleep(1800);
  report.checks.librarySubscriptions = await evalJS(`(() => {
    const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
    const subs = lists.find(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim() === 'Subscriptions');
    const titles = subs ? [...subs.querySelectorAll('li, .wfx-queue__list li')].map(li => (li.textContent || '').trim().slice(0, 60)) : null;
    return { playlistCount: lists.length, subsFound: !!subs,
      subsListTitle: subs ? (subs.querySelector('[data-wfx-playlist-name]')?.textContent || '') : null,
      entryTitles: titles };
  })()`);
  await shot("library-stored-truth");
  save();

  // THE SPLIT (a): the fresh watch-page load renders the pill IDLE despite
  // the stored subscription (pillFresh above — re-read for the record).
  await open(watchUrl);
  await sleep(2400);
  report.checks.subscribeDurable = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    return { stateAfterReload: s?.getAttribute('data-wfx-subscribe-state'),
      pressedAfterReload: s?.getAttribute('aria-pressed'),
      label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44) };
  })()`);
  await shot("watch-fresh-load");
  save();

  // THE SPLIT (b): the fresh-load unsubscribe — a fresh runtime's local map
  // is empty; the stored truth says subscribed; the remove must find it.
  report.checks.freshLoadRemove = await evalJS(freshLoadRemovePost);
  report.checks.freshLoadRemovePill = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    const status = document.querySelector('[data-wfx-subscribe-status]');
    return { state: s?.getAttribute('data-wfx-subscribe-state'), status: (status?.textContent || '').trim().slice(0, 110) };
  })()`);
  save();

  // CLEANUP (leave the store clean): the IN-VIEW round-trip — re-subscribe
  // then unsubscribe in the SAME view (the local map knows the item there).
  if (subPresent) {
    const stateNow = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
    if (stateNow !== "subscribed") {
      await ab("click", subBtn); await sleep(1300);
    }
    const preCleanup = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
    if (preCleanup === "subscribed") {
      await ab("click", subBtn); await sleep(1300);
    }
    report.checks.cleanupRoundTrip = await evalJS(`(() => {
      const s = document.querySelector('[data-wfx-subscribe]');
      return { state: s?.getAttribute('data-wfx-subscribe-state') };
    })()`);
    await open(`${BASE}/library`);
    await sleep(1600);
    report.checks.libraryAfterCleanup = await evalJS(`(() => {
      const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
      const subs = lists.find(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim() === 'Subscriptions');
      return { playlistCount: lists.length, subsFound: !!subs,
        entryTitles: subs ? [...subs.querySelectorAll('li')].map(li => (li.textContent || '').trim().slice(0, 60)) : null };
    })()`);
    save();
  }
} else if (subPresent) {
  // ══ THE FULL PHASE (one boot: subscribe → read → reload → remove) and the
  //    SUBSCRIBE-LEAVE variant (the same arc, NO cleanup — the stored truth
  //    stays for the fresh-load phase's server-restart verification) ═════
  // ── 2. THE SUBSCRIBE CLICK (the REAL write through the REAL pill) ──────
  await ab("click", subBtn);
  await sleep(1400);
  report.checks.subscribeClick = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    const status = document.querySelector('[data-wfx-subscribe-status]');
    return { state: s?.getAttribute('data-wfx-subscribe-state'), pressed: s?.getAttribute('aria-pressed'),
      label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44),
      status: (status?.textContent || '').trim().slice(0, 90) };
  })()`);
  await shot("watch-subscribed-inview");
  save();

  // ── 3. THE LIBRARY PAGE'S STORED TRUTH (the read path that EXISTS) ──────
  await open(`${BASE}/library`);
  await sleep(1800);
  report.checks.librarySubscriptions = await evalJS(`(() => {
    const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
    const subs = lists.find(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim() === 'Subscriptions');
    const titles = subs ? [...subs.querySelectorAll('li, .wfx-queue__list li')].map(li => (li.textContent || '').trim().slice(0, 60)) : null;
    return { playlistCount: lists.length, subsFound: !!subs,
      subsListTitle: subs ? (subs.querySelector('[data-wfx-playlist-name]')?.textContent || '') : null,
      entryTitles: titles };
  })()`);
  await shot("library-subscriptions");
  save();

  // ── 4. THE RELOAD (THE SPLIT): the pill must render the stored truth ────
  await open(watchUrl);
  await sleep(2400);
  report.checks.subscribeDurable = await evalJS(`(() => {
    const s = document.querySelector('[data-wfx-subscribe]');
    return { stateAfterReload: s?.getAttribute('data-wfx-subscribe-state'),
      pressedAfterReload: s?.getAttribute('aria-pressed'),
      label: (s?.getAttribute('aria-label') || s?.textContent || '').trim().slice(0, 44) };
  })()`);
  await shot("watch-after-reload");
  save();

  // ── 5. THE FRESH-LOAD UNSUBSCRIBE (THE SPLIT): the remove the pill sends ─
  // (the subscribe-leave phase SKIPS the removes — its purpose is to leave
  // the stored truth in place for the fresh-load phase).
  if (PHASE !== "subscribe-leave") {
    report.checks.freshLoadRemove = await evalJS(freshLoadRemovePost);
    // The r29-diffprobe's variant (no source identity — the posted id is the
    // truth; the base build's documented not-found evidence).
    report.checks.freshLoadRemoveNoIdentity = await evalJS(freshLoadRemoveNoIdentityPost);
    // The pill's own clicked-state after the fresh-load remove attempt.
    report.checks.freshLoadRemovePill = await evalJS(`(() => {
      const s = document.querySelector('[data-wfx-subscribe]');
      const status = document.querySelector('[data-wfx-subscribe-status]');
      return { state: s?.getAttribute('data-wfx-subscribe-state'), status: (status?.textContent || '').trim().slice(0, 110) };
    })()`);
    save();
  }

  // ── 6. CLEANUP (leave the store clean): the IN-VIEW round-trip the sweep
  // proved — re-subscribe then unsubscribe in the SAME view (the local map
  // knows the item there). SKIPPED by the subscribe-leave phase (its stored
  // truth is the fresh-load phase's subject).
  if (PHASE !== "subscribe-leave") {
    const stateNow = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
    if (stateNow !== "subscribed") {
      await ab("click", subBtn); await sleep(1300);
    }
    const preCleanup = await evalJS(`document.querySelector('${subBtn}')?.getAttribute('data-wfx-subscribe-state')`);
    if (preCleanup === "subscribed") {
      await ab("click", subBtn); await sleep(1300);
    }
    report.checks.cleanupRoundTrip = await evalJS(`(() => {
      const s = document.querySelector('[data-wfx-subscribe]');
      return { state: s?.getAttribute('data-wfx-subscribe-state') };
    })()`);
    // The Library's final truth (the store left clean).
    await open(`${BASE}/library`);
    await sleep(1600);
    report.checks.libraryAfterCleanup = await evalJS(`(() => {
      const lists = [...document.querySelectorAll('[data-wfx-library-playlist]')];
      const subs = lists.find(l => (l.querySelector('[data-wfx-playlist-name]')?.textContent || '').trim() === 'Subscriptions');
      return { playlistCount: lists.length, subsFound: !!subs,
        entryTitles: subs ? [...subs.querySelectorAll('li')].map(li => (li.textContent || '').trim().slice(0, 60)) : null };
    })()`);
    save();
  }
}

console.log(`REPRO PROBE -> ${OUT}`);
console.log(JSON.stringify(report.checks, null, 1).slice(0, 3200));
