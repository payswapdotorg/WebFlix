#!/usr/bin/env bun
// R29-C STAGE-3 PROBE — B's masthead + keyboard claims (N24 gear multi-page,
// N12 sign-in pill, O6 meta theme-color follows the boot, N25-b theater
// re-anchor 1296×729 @(72,68), N25-c the in-app miniplayer dock flow, N25-a
// the per-key keyboard set with the /api/playback command path instrumented).
// A check is VERIFIED only when THIS probe reproduces the claimed behavior.
// Usage: bun evidence/r29-recon/r29-s3probe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r29-recon/${TAG}.s3probe.json`);

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

// ═══ A. MASTHEAD — sign-in pill (N12), gear (N24), retired toggle ════════
await open(`${BASE}/`);
await sleep(1000);

report.checks.signinPill = await evalJS(`(() => {
  const pill = [...document.querySelectorAll('header a, header button, header [role=button]')]
    .find(e => /^sign in$/i.test((e.textContent || '').replace(/\\s+/g, ' ').trim()));
  if (!pill) return { found: false };
  const b = pill.getBoundingClientRect(); const s = getComputedStyle(pill);
  return { found: true, text: (pill.textContent || '').replace(/\\s+/g, ' ').trim(),
    href: pill.getAttribute('href'),
    box: Math.round(b.width) + 'x' + Math.round(b.height),
    radius: s.borderRadius, bg: s.backgroundColor, color: s.color,
    font: s.fontSize + '/' + s.fontWeight, border: s.border,
    personMark: !!pill.querySelector('svg, img, [class*=icon], [class*=person]') };
})()`);
await shot("s3-masthead");

report.checks.retiredThemeToggle = await evalJS(`(() => ({
  oldToggle: !!document.querySelector('[data-wfx-theme-toggle]'),
  oldToggleLabel: [...document.querySelectorAll('header button, header [role=button]')]
    .some(e => /switch to (dark|light) theme/i.test(e.getAttribute('aria-label') || '')),
  gearButton: !!document.querySelector('[data-wfx-gear-button]'),
}))()`);

// ── the gear multi-page menu (N24) ────────────────────────────────────────
const gearOpened = await evalJS(`(() => {
  const g = document.querySelector('[data-wfx-gear-button]');
  if (!g) return false;
  g.setAttribute('data-r29c-gear', '1'); return true;
})()`);
report.checks.gear = { opened: false };
if (gearOpened) {
  await ab("click", "[data-r29c-gear='1']");
  await sleep(800);
  report.checks.gear.root = await evalJS(`(() => {
    const panel = document.querySelector('[data-wfx-gear-panel]');
    if (!panel) return { found: false };
    const s = getComputedStyle(panel);
    const b = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('[data-wfx-gear-item]')].map(r => ({
      key: r.getAttribute('data-wfx-gear-item'), text: (r.textContent || '').trim().slice(0, 30),
      href: r.getAttribute('href') }));
    const absent = panel.querySelector('[data-wfx-gear-absent]');
    return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height),
      radius: s.borderRadius, shadow: s.boxShadow.slice(0, 60),
      rows, absenceNote: absent ? absent.textContent.trim().slice(0, 220) : null,
      absentNames: ['Display language','Restricted Mode','Location','Help','Send feedback']
        .filter(n => (absent?.textContent || '').includes(n)) };
  })()`);
  await shot("s3-gear-root");

  // the Appearance subpage + the LIVE theme seam flip
  await evalJS(`document.querySelector('[data-wfx-gear-item="appearance"]')?.setAttribute('data-r29c-app', '1'); 'ok'`);
  await ab("click", "[data-r29c-app='1']");
  await sleep(700);
  report.checks.gear.appearance = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('[data-wfx-appearance]')].map(r => ({
      theme: r.getAttribute('data-wfx-appearance'), text: (r.textContent || '').trim().slice(0, 20),
      checked: r.getAttribute('aria-checked') }));
    return { rows,
      metaBefore: document.querySelector('meta[name=theme-color]')?.content || null,
      dataThemeBefore: document.documentElement.getAttribute('data-theme') };
  })()`);
  await evalJS(`document.querySelector('[data-wfx-appearance="light"]')?.setAttribute('data-r29c-light', '1'); 'ok'`);
  await ab("click", "[data-r29c-light='1']");
  await sleep(700);
  report.checks.gear.appearanceAfterLight = await evalJS(`(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    meta: document.querySelector('meta[name=theme-color]')?.content || null,
    stored: localStorage.getItem('wfx-theme'),
    bodyBg: getComputedStyle(document.body).backgroundColor }))()`);
  await shot("s3-gear-appearance-light");
  // back to dark (the pre-state of the boot)
  await evalJS(`document.querySelector('[data-wfx-appearance="dark"]')?.setAttribute('data-r29c-dark', '1'); 'ok'`);
  await ab("click", "[data-r29c-dark='1']");
  await sleep(700);
  report.checks.gear.appearanceAfterDark = await evalJS(`(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    meta: document.querySelector('meta[name=theme-color]')?.content || null,
    stored: localStorage.getItem('wfx-theme') }))()`);
  await ab("press", "Escape");

  // the Keyboard shortcuts subpage (the real key sheet)
  await evalJS(`document.querySelector('[data-r29c-gear]')?.click(); 'ok'`);
  await sleep(500);
  await evalJS(`document.querySelector('[data-r29c-gear]')?.click(); 'ok'`);
  await sleep(600);
  await evalJS(`document.querySelector('[data-wfx-gear-item="shortcuts"]')?.setAttribute('data-r29c-sc', '1'); 'ok'`);
  await ab("click", "[data-r29c-sc='1']");
  await sleep(600);
  report.checks.gear.shortcuts = await evalJS(`(() => {
    const sheet = document.querySelector('[data-wfx-gear-shortcuts]');
    if (!sheet) return { found: false };
    const rows = [...sheet.querySelectorAll('dt')].map(dt => (dt.textContent || '').trim());
    return { found: true, keys: rows,
      hasUpDown: rows.some(r => /↑|up/i.test(r)), hasI: rows.some(r => /^i$/i.test(r)) };
  })()`);
  await shot("s3-gear-shortcuts");
  await ab("press", "Escape");
}

// ── O6 — the meta theme-color follows the boot (BOTH branches) ───────────
report.checks.metaBoot = {};
await evalJS(`localStorage.setItem('wfx-theme', 'light'); 'set'`);
await open(`${BASE}/`);
await sleep(1200);
report.checks.metaBoot.lightBranch = await evalJS(`(() => ({
  meta: document.querySelector('meta[name=theme-color]')?.content || null,
  themedMeta: !!document.querySelector('meta[data-wfx-theme-color]'),
  dataTheme: document.documentElement.getAttribute('data-theme'),
  bodyBg: getComputedStyle(document.body).backgroundColor }))()`);
await evalJS(`localStorage.setItem('wfx-theme', 'dark'); 'set'`);
await open(`${BASE}/`);
await sleep(1200);
report.checks.metaBoot.darkBranch = await evalJS(`(() => ({
  meta: document.querySelector('meta[name=theme-color]')?.content || null,
  dataTheme: document.documentElement.getAttribute('data-theme'),
  bodyBg: getComputedStyle(document.body).backgroundColor }))()`);
await evalJS(`localStorage.removeItem('wfx-theme'); 'set'`);

// the before-first-paint seam: the served HTML carries the meta + the inline
// seam script, meta first (independent of the browser session)
const rawHtml = await (await fetch(`${BASE}/search?q=x`)).text();
report.checks.metaBoot.servedHtml = {
  hasThemedMeta: /<meta[^>]+data-wfx-theme-color[^>]*>/i.test(rawHtml),
  metaContent: (rawHtml.match(/<meta[^>]+name="theme-color"[^>]*>/i) || [null])[0]?.slice(0, 120) ?? null,
  seamScriptInline: /<script[^>]*>[^<]*localStorage[^<]*wfx-theme[^<]*<\/script>/i.test(rawHtml),
  metaBeforeBody: (rawHtml.indexOf('data-wfx-theme-color') >= 0 && rawHtml.indexOf('data-wfx-theme-color') < rawHtml.indexOf('<body')),
};

// ═══ B. THE WATCH SURFACE — theater + keyboard + miniplayer ═════════════
await open(`${BASE}/`);
const hrefs = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('main a.wfx-card, main [data-wfx-card]')].slice(0, 2);
  return cards.map(c => c.getAttribute('href'));
})()`);
const watchUrl = hrefs?.[0] ? (hrefs[0].startsWith("http") ? hrefs[0] : BASE + hrefs[0]) : `${BASE}/player`;
const otherUrl = hrefs?.[1] ? (hrefs[1].startsWith("http") ? hrefs[1] : BASE + hrefs[1]) : null;
report.checks.playerUrls = { watchUrl, otherUrl };

// ── N25-b — the theater re-anchor (1296×729 @(72,68) @1440) ──────────────
await open(watchUrl);
await sleep(2200);
const theaterBox = async () => evalJS(`(() => {
  const s = document.querySelector('[data-wfx-player-stagewrap], .wfx-player__stagewrap');
  const layout = document.querySelector('.wfx-player__layout');
  if (!s) return null;
  const b = s.getBoundingClientRect();
  return { box: Math.round(b.width) + 'x' + Math.round(b.height) + ' @(' + Math.round(b.x) + ',' + Math.round(b.y) + ')',
    viewport: window.innerWidth + 'x' + window.innerHeight,
    gutters: { left: Math.round(b.x), right: Math.round(window.innerWidth - b.right) },
    theaterClass: !!document.querySelector('.wfx-player--theater, [data-wfx-theater=true]'),
    layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null };
})()`);
await ab("mouse", "move", 700, 500);
await sleep(400);
report.checks.theater = { before: await theaterBox() };
await ab("press", "t");
await sleep(1100);
report.checks.theater.after = await theaterBox();
await shot("s3-theater-1296");
await ab("press", "t");
await sleep(900);
report.checks.theater.reverted = await theaterBox();

// ── N25-a — the per-key keyboard set (command path instrumented) ─────────
await open(watchUrl);
await sleep(2200);
await evalJS(`(() => {
  window.__r29Keys = { fetches: [], keydowns: [] };
  const of = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && input.method) || 'GET';
    const body = init && init.body ? String(init.body).slice(0, 140) : null;
    const t0 = performance.now();
    return of(input, init).then(res => {
      window.__r29Keys.fetches.push({ url: String(url).slice(0, 80), method, body, status: res.status, atMs: Math.round(performance.now() - t0) });
      return res;
    });
  };
  window.addEventListener('keydown', e => window.__r29Keys.keydowns.push(e.key), true);
  return 'instrumented';
})()`);

const keySnap = () => evalJS(`(() => ({
  path: location.pathname,
  playLabel: document.querySelector('[data-wfx-chrome-play]')?.getAttribute('aria-label') || null,
  playing: document.querySelector('[data-wfx-chrome]')?.getAttribute('data-wfx-chrome-phase') || null,
  muteLabel: document.querySelector('[data-wfx-chrome-mute]')?.getAttribute('aria-label') || null,
  volumeValue: document.querySelector('[data-wfx-chrome-volumeslider]')?.value ?? null,
  theaterLabel: document.querySelector('[data-wfx-chrome-theater]')?.getAttribute('aria-label') || null,
  fullscreen: !!document.fullscreenElement,
  sheetOpen: (() => { const s = document.querySelector('[data-wfx-chrome-keyboard-sheet]'); return s ? s.open : null; })(),
  captionsControl: !!document.querySelector('[data-wfx-chrome-captions]'),
  fetches: (window.__r29Keys ? window.__r29Keys.fetches.slice(-3) : []),
  keydowns: (window.__r29Keys ? window.__r29Keys.keydowns.slice(-2) : []),
}))()`);
report.checks.keyboard = { pre: await keySnap() };
const clearFetches = () => evalJS(`(() => { if (window.__r29Keys) window.__r29Keys.fetches = []; if (window.__r29Keys) window.__r29Keys.keydowns = []; return 'cleared'; })()`);

for (const key of ["m", "ArrowUp", "ArrowDown", "f", "?", "k", "Space", " ", "j", "l", "ArrowLeft", "ArrowRight", "5"]) {
  await clearFetches();
  await ab("press", key);
  await sleep(900);
  report.checks.keyboard[`press_${key.replace(" ", "SPACE")}`] = await keySnap();
  // honest reverts: m toggles back; f exits via Escape; ? toggles the sheet closed
  if (key === "m") { await ab("press", "m"); await sleep(500); }
  if (key === "f") { await ab("press", "Escape"); await sleep(600); }
  if (key === "?") { await ab("press", "?"); await sleep(500); }
}
report.checks.keyboard.post = await keySnap();
await shot("s3-keyboard-set");

// the keyboard sheet content (the ? sheet's own rows)
await ab("press", "?");
await sleep(700);
report.checks.keyboard.sheetRows = await evalJS(`(() => {
  const sheet = document.querySelector('[data-wfx-chrome-keyboard-sheet]');
  if (!sheet || !sheet.open) return { open: false };
  const rows = [...sheet.querySelectorAll('dt, [class*=key]')].map(d => (d.textContent || '').trim()).filter(Boolean);
  return { open: true, rows: rows.slice(0, 14), hasUpDown: rows.some(r => /↑/i.test(r)), hasI: rows.some(r => /^i$/i.test(r)) };
})()`);
await shot("s3-keyboard-sheet");
await ab("press", "?");
await sleep(400);

// ── N25-c — THE MINIPLAYER FLOW (dock → persist → expand → replace → close) ──
// dock from a nonzero session position (resume=5000 — a real session input)
const dockableUrl = watchUrl.includes("?") ? `${watchUrl}&resume=5000` : `${watchUrl}?resume=5000`;
await open(dockableUrl);
await sleep(2400);
report.checks.miniplayer = { dockFrom: dockableUrl };
await ab("press", "i");
await sleep(2000);
report.checks.miniplayer.afterDockPress = await evalJS(`(() => {
  const dock = document.querySelector('[data-wfx-miniplayer]');
  const stage = dock ? dock.querySelector('[data-wfx-miniplayer-stage]') : null;
  const head = dock ? dock.querySelector('.wfx-dock__head, [class*=head]') : null;
  const b = dock ? dock.getBoundingClientRect() : null;
  const sb = stage ? stage.getBoundingClientRect() : null;
  const hb = head ? head.getBoundingClientRect() : null;
  let stored = null;
  try { stored = JSON.parse(sessionStorage.getItem('wfx-miniplayer') || 'null'); } catch {}
  return {
    path: location.pathname,
    dockPresent: !!dock,
    dockBox: b ? Math.round(b.width) + 'x' + Math.round(b.height) : null,
    dockPos: b ? { right: Math.round(innerWidth - b.right), bottom: Math.round(innerHeight - b.bottom) } : null,
    headH: hb ? Math.round(hb.height) : null,
    title: dock ? (dock.querySelector('[data-wfx-miniplayer-title]')?.textContent || '').slice(0, 50) : null,
    stageBox: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null,
    stageSrc: stage ? stage.getAttribute('src') : null,
    compactInSrc: stage ? (stage.getAttribute('src') || '').includes('miniplayer=1') : null,
    stored, storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 160) ?? null,
    mainPlayerOnPage: !!document.querySelector('main [data-wfx-surface=player]'),
  };
})()`);
await shot("s3-miniplayer-dock");

// persistence across navigation: / → /search → back
await open(`${BASE}/`);
await sleep(1400);
report.checks.miniplayer.persistHome = await evalJS(`(() => ({
  path: location.pathname, dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
  storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 160) ?? null }))()`);
await open(`${BASE}/search?q=${encodeURIComponent("lofi")}`);
await sleep(1400);
report.checks.miniplayer.persistSearch = await evalJS(`(() => ({
  path: location.pathname, dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
  storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 160) ?? null }))()`);
await shot("s3-miniplayer-persistent");

// the ~3s position-write seam: override the stored position, then watch
// whether the compact player's interval REWRITES it with the live truth
const readPos = () => evalJS(`(() => { try { const d = JSON.parse(sessionStorage.getItem('wfx-miniplayer') || 'null'); return d ? d.positionMs : null; } catch { return null; } })()`);
const p0 = await readPos();
await evalJS(`(() => { try { const d = JSON.parse(sessionStorage.getItem('wfx-miniplayer') || '{}'); d.positionMs = 777; sessionStorage.setItem('wfx-miniplayer', JSON.stringify(d)); } catch {} return 'overridden'; })()`);
await sleep(4300);
const p1 = await readPos();
report.checks.miniplayer.positionSeam = { storedBefore: p0, override: 777, readAfter3s: p1, seamWrote: p1 !== null && p1 !== 777 };

// EXPAND: back to the full player surface; the dock never doubles
await open(`${BASE}/`);
await sleep(1200);
await evalJS(`document.querySelector('[data-wfx-miniplayer-expand]')?.setAttribute('data-r29c-exp', '1'); 'ok'`);
await ab("click", "[data-r29c-exp='1']");
await sleep(2600);
report.checks.miniplayer.afterExpand = await evalJS(`(() => ({
  path: location.pathname, search: location.search.slice(0, 120),
  mainPlayer: !!document.querySelector('main [data-wfx-surface=player]'),
  dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
  storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 80) ?? null }))()`);
await shot("s3-miniplayer-expanded");

// THE SUPPRESSION law (same item): re-dock, land on the SAME item's surface
await open(dockableUrl);
await sleep(2400);
await ab("press", "i");
await sleep(1800);
await open(watchUrl);
await sleep(2200);
report.checks.miniplayer.suppressionSameItem = await evalJS(`(() => ({
  path: location.pathname, search: location.search.slice(0, 80),
  mainPlayer: !!document.querySelector('main [data-wfx-surface=player]'),
  dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
  storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 80) ?? null }))()`);

// THE REPLACE rule (different item): the dock entry clears
if (otherUrl) {
  await open(dockableUrl);
  await sleep(2400);
  await ab("press", "i");
  await sleep(1800);
  await open(otherUrl);
  await sleep(2400);
  report.checks.miniplayer.replaceDifferentItem = await evalJS(`(() => ({
    path: location.pathname, search: location.search.slice(0, 80),
    mainPlayer: !!document.querySelector('main [data-wfx-surface=player]'),
    dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
    storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 80) ?? null }))()`);
  // after the replace, the browse surface shows NO dock (entry cleared)
  await open(`${BASE}/`);
  await sleep(1400);
  report.checks.miniplayer.afterReplaceBrowse = await evalJS(`(() => ({
    dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
    storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 80) ?? null }))()`);
}

// CLOSE: the dock's own close action clears everything
await open(dockableUrl);
await sleep(2400);
await ab("press", "i");
await sleep(1800);
await evalJS(`document.querySelector('[data-wfx-miniplayer-close]')?.setAttribute('data-r29c-close', '1'); 'ok'`);
await ab("click", "[data-r29c-close='1']");
await sleep(900);
report.checks.miniplayer.afterClose = await evalJS(`(() => ({
  dockPresent: !!document.querySelector('[data-wfx-miniplayer]'),
  storageRaw: sessionStorage.getItem('wfx-miniplayer')?.slice(0, 80) ?? null }))()`);

// the compact form's own document (the /player?…&miniplayer=1 page)
await open(watchUrl.includes("?") ? `${watchUrl}&miniplayer=1` : `${watchUrl}?miniplayer=1`);
await sleep(2400);
report.checks.miniplayer.compactDoc = await evalJS(`(() => ({
  minidoc: !!document.querySelector('[data-wfx-minidoc]'),
  shell: !!document.querySelector('header.wfx-topbar, [class*=topbar], nav.wfx-rail'),
  chrome: !!document.querySelector('[data-wfx-chrome]'),
  theaterControl: !!document.querySelector('[data-wfx-chrome-theater]'),
  miniControl: document.querySelector('[data-wfx-chrome-miniplayer]')?.getAttribute('aria-label') || null,
  title: document.title.slice(0, 40) }))()`);
await shot("s3-compact-doc");

// leave the session clean (no dock residue for later instruments)
await evalJS(`sessionStorage.removeItem('wfx-miniplayer'); localStorage.removeItem('wfx-theme'); 'clean'`);

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`S3 PROBE -> ${OUT}`);
console.log(JSON.stringify({
  signinPill: report.checks.signinPill,
  retiredThemeToggle: report.checks.retiredThemeToggle,
  gear: report.checks.gear,
  metaBoot: report.checks.metaBoot,
  theater: report.checks.theater,
  keyboard: { pre: report.checks.keyboard.pre, m: report.checks.keyboard.press_m, up: report.checks.keyboard.press_ArrowUp, down: report.checks.keyboard.press_ArrowDown, k: report.checks.keyboard.press_k, space: report.checks.keyboard["press_SPACE"], j: report.checks.keyboard.press_j, five: report.checks.keyboard.press_5, qmark: report.checks.keyboard["press_?"] },
  miniplayer: report.checks.miniplayer,
}, null, 1).slice(0, 5200));
