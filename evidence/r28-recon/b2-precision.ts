#!/usr/bin/env bun
// R28-C WAVE-2 PRECISION PROBE — the second-order measurements:
//   · the hover DWELL timed by in-page MutationObserver (corpus ~150ms)
//   · the playing-state preview IFRAME src + chrome (unmute/speed/progress)
//   · the comment ROW anatomy with the exact wfx-comment selectors
//   · the kebab (Actions for <title>) box + menu items
//   · the Copy→toast with the clipboard stubbed to succeed
// Usage: bun evidence/r28-recon/b2-precision.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r28-recon/verifications/${TAG}-precision.json`);

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
const shot = (name: string) => ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-${name}.png`));

// ── 1. hover dwell + playing-state chrome (timed in-page) ───────────────────
await open(`${BASE}/`);
await sleep(800);
await ab("scroll", "down", 800);
await sleep(400);
const target = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('main a[href*="/player"], main a.wfx-card, main [class*=card] a')]
    .filter(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 80 && b.y < 640; });
  const c = cards[0];
  if (!c) return { found: false };
  const thumb = c.querySelector('[class*=thumb]') || c;
  const t = thumb.getBoundingClientRect();
  return { found: true, x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height / 2), href: c.getAttribute('href') };
})()`);
if (target?.found) {
  // arm the in-page observer BEFORE the pointer move (timestamp precision)
  await evalJS(`(() => {
    (window).__wfxDwellLog = [];
    const el = document.querySelector('[data-wfx-hover-preview]');
    const log = window.__wfxDwellLog;
    const obs = new MutationObserver(() => {
      const s = el.getAttribute('data-wfx-preview-state');
      const last = log[log.length - 1];
      if (!last || last.state !== s) log.push({ state: s, t: performance.now() });
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-wfx-preview-state', 'class'] });
    log.push({ state: el.getAttribute('data-wfx-preview-state'), t: performance.now() });
    window.__wfxDwellObserver = obs;
    return 'armed';
  })()`);
  await ab("mouse", "move", target.x, target.y);
  await sleep(2600); // resolving -> playing + provider answer
  report.checks.dwell = await evalJS(`(() => {
    const log = (window).__wfxDwellLog || [];
    const el = document.querySelector('[data-wfx-hover-preview]');
    const frame = el ? el.querySelector('iframe[data-wfx-hover-preview-frame]') : null;
    const chrome = el ? {
      unmute: (el.querySelector('[data-wfx-hover-preview-unmute]')?.textContent || '').trim(),
      speedPill: [...el.querySelectorAll('button,[role=button]')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(t => /2x|speed/i.test(t)).slice(0, 2),
      progressBar: !!el.querySelector('[class*=progress],[role=progressbar]'),
      infoBtn: [...el.querySelectorAll('button,[aria-label]')].map(b => (b.getAttribute('aria-label') || '')).filter(t => /info/i.test(t)).slice(0, 1),
      clickLayer: !!el.querySelector('[data-wfx-hover-preview-open]'),
    } : null;
    return { log, state: el ? el.getAttribute('data-wfx-preview-state') : null,
             frameSrc: frame ? frame.src : null,
             frameBox: frame ? (() => { const b = frame.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); })() : null,
             chrome };
  })()`);
  await shot("hover-playing");
  // the mouseaway timeline via the same observer (fade + retention)
  await evalJS(`(() => { (window).__wfxDwellLog = []; const el = document.querySelector('[data-wfx-hover-preview]');
    const log = window.__wfxDwellLog;
    const obs = new MutationObserver(() => { log.push({ cls: el.className, t: performance.now(), opacity: getComputedStyle(el).opacity }); });
    obs.observe(el, { attributes: true, attributeFilter: ['class', 'style'], childList: true });
    window.__wfxDwellObserver = obs; return 'rearmed'; })()`);
  await ab("mouse", "move", 20, 450);
  await sleep(900);
  report.checks.unhoverObserver = await evalJS(`(() => {
    const log = (window).__wfxDwellLog || [];
    const el = document.querySelector('[data-wfx-hover-preview]');
    return { log: log.slice(0, 8), elementRetained: !!el, finalOpacity: el ? getComputedStyle(el).opacity : null,
             finalFrameCount: el ? el.querySelectorAll('iframe').length : 0 };
  })()`);
}

// ── 2. comment ROW anatomy (exact wfx-comment selectors) ───────────────────
const playerHref = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a[href*="/player"]')].find(el => el.getBoundingClientRect().width > 100);
  return c ? c.getAttribute('href') : null;
})()`);
if (playerHref) {
  await open(`${BASE}${playerHref}`);
  await sleep(1600);
  // seed through the app's own transport if empty (idempotent)
  await evalJS(`(() => {
    const itemId = ${JSON.stringify(playerHref)}.match(/[?&]id=([^&]+)/)?.[1] || 'seed';
    const store = JSON.parse(localStorage.getItem('wfx-comments-v1') || '{}');
    if (store[itemId] && store[itemId].length) return 'already:' + store[itemId].length;
    const now = Date.now();
    store[itemId] = [
      { id: 'p1', parentId: null, body: 'The precision anatomy probe — the top-level row.', createdAt: new Date(now - 7200e3).toISOString(), authorHandle: '@precision_one', liked: false },
      { id: 'p2', parentId: 'p1', body: 'A nested reply for the expander grammar.', createdAt: new Date(now - 3600e3).toISOString(), authorHandle: '@precision_two', liked: true },
    ];
    localStorage.setItem('wfx-comments-v1', JSON.stringify(store));
    return 'seeded';
  })()`);
  await open(`${BASE}${playerHref}`);
  await sleep(1600);
  report.checks.commentRow = await evalJS(`(() => {
    const sec = document.querySelector('.wfx-comments');
    const head = sec ? sec.querySelector('.wfx-comments__count') : null;
    const hs = head ? getComputedStyle(head) : null;
    const row = sec ? sec.querySelector('article.wfx-comment') : null;
    if (!row) return { found: false, headerText: head ? head.textContent : null };
    const avatar = row.querySelector('img,[class*=avatar]');
    const av = avatar ? avatar.getBoundingClientRect() : null;
    const avs = avatar ? getComputedStyle(avatar) : null;
    const author = row.querySelector('.wfx-comment__author');
    const rs = author ? getComputedStyle(author) : null;
    const time = row.querySelector('.wfx-comment__time');
    const ts = time ? getComputedStyle(time) : null;
    const text = row.querySelector('.wfx-comment__text');
    const xs = text ? getComputedStyle(text) : null;
    const pills = [...row.querySelectorAll('.wfx-comment__pill')];
    const reply = row.querySelector('.wfx-comment__replybtn');
    const ys = reply ? getComputedStyle(reply) : null;
    const expander = row.querySelector('.wfx-comment__expander') || sec.querySelector('.wfx-comment__expander');
    return { found: true,
      header: { text: head ? head.textContent.trim() : null, font: hs ? hs.fontSize + '/' + hs.fontWeight : null },
      avatar: { box: av ? Math.round(av.width) + 'x' + Math.round(av.height) : null, radius: avs ? avs.borderRadius : null },
      author: { text: author ? author.textContent.trim() : null, font: rs ? rs.fontSize + '/' + rs.fontWeight : null },
      time: { text: time ? time.textContent.trim() : null, font: ts ? ts.fontSize + '/' + ts.fontWeight : null, color: ts ? ts.color : null },
      body: { text: text ? (text.textContent || '').slice(0, 30) : null, font: xs ? xs.fontSize + '/' + xs.fontWeight + '/' + xs.lineHeight : null },
      pills: pills.map(p => { const b = p.getBoundingClientRect(); const s = getComputedStyle(p); return { label: (p.getAttribute('aria-label') || '').slice(0, 16), box: Math.round(b.width) + 'x' + Math.round(b.height), bg: s.backgroundColor }; }),
      replyBtn: { font: ys ? ys.fontSize + '/' + ys.fontWeight : null, text: reply ? reply.textContent.trim() : null },
      expanderText: expander ? expander.textContent.trim() : null,
      rowW: Math.round(row.getBoundingClientRect().width),
    };
  })()`);
  await shot("comment-row");

  // ── 3. the copy toast with the clipboard stubbed to succeed ─────────────
  const shareOpened = await evalJS(`(() => {
    const e = [...document.querySelectorAll('button,[role=button],a')].find(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
    if (!e) return false; e.click(); return true;
  })()`);
  if (shareOpened) {
    await sleep(900);
    await evalJS(`(() => {
      // stub the clipboard permission denial (the headless default) so the
      // app's own success path can be observed
      navigator.clipboard.writeText = (t) => Promise.resolve(t);
      return 'stubbed';
    })()`);
    const copyClicked = await evalJS(`(() => {
      const e = [...document.querySelectorAll('.wfx-share__panel button,[role=dialog] button,dialog button')].find(e => /^\\s*copy\\b/i.test(e.getAttribute('aria-label') || e.textContent || ''));
      if (!e) return false; e.click(); return true;
    })()`);
    if (copyClicked) {
      await sleep(900);
      report.checks.copyToastStubbed = await evalJS(`(() => ({
        toasts: [...document.querySelectorAll('[class*=toast],[class*=snackbar],[role=status],[aria-live]')].filter(e => (e.textContent || '').trim().length > 0 && e.getBoundingClientRect().width > 0).map(t => (t.textContent || '').trim().slice(0, 50)),
        bodyMatch: (document.body.innerText.match(/copied[^\\n]{0,30}/i) || [null])[0],
      }))()`);
      await shot("copy-toast-success");
    }
  }
}

// ── 4. the kebab (Actions for <title>) ──────────────────────────────────────
await open(`${BASE}/`);
await sleep(700);
await ab("scroll", "down", 800);
await sleep(400);
report.checks.kebab = await evalJS(`(() => {
  const btn = document.querySelector('details.wfx-kebab summary, summary[aria-label*=Actions]');
  if (!btn) return { found: false };
  const b = btn.getBoundingClientRect();
  return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height), label: btn.getAttribute('aria-label') };
})()`);
const kebabOpened = await evalJS(`(() => {
  const d = document.querySelector('details.wfx-kebab');
  if (!d) return false; d.open = true; return true;
})()`);
if (kebabOpened) {
  await sleep(400);
  report.checks.kebabMenu = await evalJS(`(() => {
    const menu = document.querySelector('.wfx-kebab__menu');
    if (!menu) return { found: false };
    const items = [...menu.querySelectorAll('.wfx-kebab__item,button,a')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(t => t.length > 2 && t.length < 60).slice(0, 8);
    return { found: true, items };
  })()`);
  await shot("kebab-menu");
}

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`PRECISION -> ${OUT}`);
console.log(JSON.stringify(report.checks, null, 1).slice(0, 3200));
