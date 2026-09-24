#!/usr/bin/env bun
// R28-C WAVE-2 TARGETED PROBE — the per-feature deep measurements for B's
// wave-2 claims (b798879 hover · 08c76e4 kebab+share · 33bee28 comments ·
// 96bb075 theme). Each check is pinned to the corpus sheet value; a verdict
// is VERIFIED only when THIS probe reproduces the claim.
// Usage: bun evidence/r28-recon/b2-probe.ts http://localhost:3101 <tag>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r28-recon/verifications/${TAG}-probe.json`);

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

// ═══════════════════════════════════════════════════════════════════════════
// 1. HOVER PREVIEW — the singleton law (hover-preview.md @ 97a5d22/25ba5e7)
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(800);
await ab("scroll", "down", 800);
await sleep(400);

// the singleton must exist exactly ONCE, in the shell (idle before hover)
report.checks.hoverSingletonBefore = await evalJS(`(() => ({
  count: document.querySelectorAll('[data-wfx-hover-preview]').length,
  states: [...document.querySelectorAll('[data-wfx-hover-preview]')].map(e => e.getAttribute('data-wfx-preview-state')),
}))()`);

// pick a visible card THUMB and hover it; record the timeline of states
const target = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('main a[href*="/player"], main a.wfx-card, main [class*=card] a')]
    .filter(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 80 && b.y < 640; });
  const c = cards[0];
  if (!c) return { found: false, n: cards.length };
  const thumb = c.querySelector('[class*=thumb]') || c;
  const t = thumb.getBoundingClientRect();
  const cardBefore = { transform: getComputedStyle(c).transform, rect: [Math.round(c.getBoundingClientRect().x), Math.round(c.getBoundingClientRect().y), Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)] };
  return { found: true, x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height / 2),
    thumb: { x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.width), h: Math.round(t.height) },
    cardBefore, href: c.getAttribute('href') };
})()`);
report.checks.hoverTarget = target;

if (target?.found) {
  await ab("mouse", "move", target.x, target.y);
  // timeline: poll the singleton's state + box for 700ms (the dwell is ~150ms)
  const timeline: any[] = [];
  for (let i = 0; i < 14; i++) {
    await sleep(50);
    const s = await evalJS(`(() => {
      const el = document.querySelector('[data-wfx-hover-preview]');
      if (!el) return { present: false };
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const frame = el.querySelector('iframe');
      return { present: true, state: el.getAttribute('data-wfx-preview-state'), open: el.className.includes('--open'),
        box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        opacity: cs.opacity, frameSrc: frame ? frame.src : null };
    })()`);
    timeline.push({ t: (i + 1) * 50, ...s });
  }
  report.checks.hoverTimeline = timeline;
  await shot("hover-open");
  // 1.7s long-dwell: still open (the corpus keeps the preview while hovered)
  await sleep(1000);
  report.checks.hoverLongDwell = await evalJS(`(() => {
    const el = document.querySelector('[data-wfx-hover-preview]');
    if (!el) return { present: false };
    const b = el.getBoundingClientRect();
    return { present: true, state: el.getAttribute('data-wfx-preview-state'), open: el.className.includes('--open'),
      box: [Math.round(b.width), Math.round(b.height)] };
  })()`);
  // the card must NOT transform (corpus: card itself never transforms)
  report.checks.cardAfter = await evalJS(`(() => {
    const cards = [...document.querySelectorAll('main a[href*="/player"], main a.wfx-card, main [class*=card] a')]
      .filter(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 80 && b.y < 640; });
    const c = cards[0];
    if (!c) return null;
    return { transform: getComputedStyle(c).transform, rect: [Math.round(c.getBoundingClientRect().x), Math.round(c.getBoundingClientRect().y), Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)] };
  })()`);
  // un-hover: fade + RETENTION (the element persists; the stream stops)
  await ab("mouse", "move", 20, 450);
  const unhover: any[] = [];
  for (const ms of [100, 250, 450, 800]) {
    await sleep(ms === 100 ? 100 : ms - (unhover.length ? [100, 250, 450, 800][unhover.length - 1] : 0));
    const s = await evalJS(`(() => {
      const el = document.querySelector('[data-wfx-hover-preview]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return { present: true, state: el.getAttribute('data-wfx-preview-state'), open: el.className.includes('--open'),
        opacity: cs.opacity, display: cs.display, visibility: cs.visibility,
        frameCount: el.querySelectorAll('iframe').length };
    })()`);
    unhover.push({ afterMs: ms, ...s });
  }
  report.checks.hoverUnhover = unhover;
  await shot("hover-after-unhover");
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CARD KEBAB (N18) — 40×40 3-dot, menu: Add to queue / Save / Share / Details
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(600);
await ab("scroll", "down", 800);
await sleep(400);
report.checks.kebab = await evalJS(`(() => {
  const dots = [...document.querySelectorAll('button,[role=button],[aria-label]')]
    .filter(e => /more actions|kebab|3-dot|•••/i.test(e.getAttribute('aria-label') || '') && e.getBoundingClientRect().width > 0);
  const k = dots[0];
  if (!k) return { found: false, count: dots.length };
  const b = k.getBoundingClientRect();
  return { found: true, count: dots.length, box: Math.round(b.width) + 'x' + Math.round(b.height),
    label: k.getAttribute('aria-label'), visible: b.width > 0 };
})()`);
// open the first kebab and read the menu
const kebabOpened = await evalJS(`(() => {
  const k = [...document.querySelectorAll('button,[role=button],[aria-label]')]
    .filter(e => /more actions|kebab|3-dot/i.test(e.getAttribute('aria-label') || '') && e.getBoundingClientRect().width > 0)[0];
  if (!k) return false; k.click(); return true;
})()`);
if (kebabOpened) {
  await sleep(500);
  report.checks.kebabMenu = await evalJS(`(() => {
    const menus = [...document.querySelectorAll('[role=menu],[class*=menu],[class*=popover],[class*=dropdown]')]
      .filter(e => e.getBoundingClientRect().width > 0);
    const m = menus[0];
    if (!m) return { found: false, menuText: (document.body.innerText.match(/add to queue[^\\n]{0,60}/i) || [null])[0] };
    return { found: true, items: [...m.querySelectorAll('button,[role=menuitem],a,li')].map(e => (e.textContent || '').trim()).filter(t => t.length > 0 && t.length < 40).slice(0, 8) };
  })()`);
  await shot("kebab-open");
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. COMMENTS (O3/N11) — anatomy via the app's own transport + the anon gate
// ═══════════════════════════════════════════════════════════════════════════
const playerHref = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a[href*="/player"]')].find(el => el.getBoundingClientRect().width > 100);
  return c ? c.getAttribute('href') : null;
})()`);
if (playerHref) {
  await open(`${BASE}${playerHref}`);
  await sleep(1800);
  // 3a. the anonymous state: region + header + sort + the composer gate
  report.checks.commentsAnon = await evalJS(`(() => {
    const region = document.querySelector('.wfx-comments,[class*=comments]');
    const header = [...document.querySelectorAll('.wfx-comments *, [class*=comments] *')].find(e => /\\d+\\s+comments?/i.test(e.textContent || '') && e.children.length === 0);
    const hs = header ? getComputedStyle(header.parentElement || header) : null;
    const hEl = header ? (header.parentElement || header) : null;
    return {
      region: !!region, regionCls: region ? region.className.toString().slice(0, 40) : null,
      headerText: header ? header.textContent : null,
      headerFont: hEl ? getComputedStyle(hEl).fontSize + '/' + getComputedStyle(hEl).fontWeight : null,
      sortLabels: [...document.querySelectorAll('.wfx-comments button,[class*=comments] button')]
        .map(b => (b.textContent || '').trim()).filter(t => /^(top|newest|top comments|newest first)$/i.test(t)),
      composerRow: (document.body.innerText.match(/add a comment[^\\n]{0,40}/i) || [null])[0],
      signedInComposer: !!document.querySelector('.wfx-comments textarea,[class*=comments] [contenteditable]'),
    };
  })()`);
  // 3b. the anon gate: click the composer row — the editor must NOT mount
  const gateClick = await evalJS(`(() => {
    const row = [...document.querySelectorAll('.wfx-comments *, [class*=comments] *')].find(e => /add a comment/i.test(e.getAttribute('placeholder') || e.textContent || '') && e.children.length <= 2);
    if (!row) return { clicked: false };
    row.click();
    return { clicked: true };
  })()`);
  await sleep(700);
  report.checks.commentsAnonGate = await evalJS(`(() => ({
    editorMounted: !!document.querySelector('.wfx-comments textarea,[class*=comments] textarea,[class*=comments] [contenteditable=true]'),
    signInSection: /sign in/i.test(document.body.innerText),
    items: document.querySelectorAll('.wfx-comments [class*=row],[class*=comments] [class*=item],[class*=comments] [class*=thread]').length,
  }))()`);
  await shot("comments-anon");
  // 3c. the row anatomy via the app's OWN transport (seed 2 comments + a reply,
  //     exactly the shape CommentsSection.tsx persists, then reload)
  await evalJS(`(() => {
    const itemId = ${JSON.stringify(playerHref)}.match(/[?&]id=([^&]+)/)?.[1] || 'seed';
    const store = JSON.parse(localStorage.getItem('wfx-comments-v1') || '{}');
    const now = Date.now();
    store[itemId] = [
      { id: 'c1', parentId: null, body: 'The corpus anatomy probe — top-level comment one with a measured body line.', createdAt: new Date(now - 3600e3).toISOString(), authorHandle: '@probe_one', liked: false },
      { id: 'c2', parentId: 'c1', body: 'A nested reply line for the expander grammar.', createdAt: new Date(now - 1800e3).toISOString(), authorHandle: '@probe_two', liked: true },
      { id: 'c3', parentId: null, body: 'Second top-level comment for the sort and count.', createdAt: new Date(now - 600e3).toISOString(), authorHandle: '@probe_three', liked: false },
    ];
    localStorage.setItem('wfx-comments-v1', JSON.stringify(store));
    return 'seeded:' + itemId;
  })()`);
  await open(`${BASE}${playerHref}`);
  await sleep(1800);
  report.checks.commentsSeeded = await evalJS(`(() => {
    const header = [...document.querySelectorAll('.wfx-comments *, [class*=comments] *')].find(e => /\\d+\\s+comments?/i.test(e.textContent || '') && e.children.length === 0);
    const hEl = header ? (header.parentElement || header) : null;
    const row = document.querySelector('.wfx-comments [class*=row],[class*=comments] [class*=item],[class*=comments] [class*=thread]');
    const avatar = row ? row.querySelector('img,[class*=avatar]') : null;
    const av = avatar ? avatar.getBoundingClientRect() : null;
    const avs = avatar ? getComputedStyle(avatar) : null;
    const author = row ? row.querySelector('[class*=author],[class*=handle]') : null;
    const rs = author ? getComputedStyle(author) : null;
    const body = row ? row.querySelector('p,[class*=body],[class*=text]') : null;
    const bs = body ? getComputedStyle(body) : null;
    const pills = row ? [...row.querySelectorAll('button,[role=button]')].filter(e => /like|dislike|reply/i.test(e.getAttribute('aria-label') || e.textContent || '')) : [];
    return {
      headerText: header ? header.textContent : null,
      headerFont: hEl ? getComputedStyle(hEl).fontSize + '/' + getComputedStyle(hEl).fontWeight : null,
      threadCount: document.querySelectorAll('.wfx-comments [class*=row],[class*=comments] [class*=item],[class*=comments] [class*=thread]').length,
      avatarBox: av ? Math.round(av.width) + 'x' + Math.round(av.height) : null,
      avatarRadius: avs ? avs.borderRadius : null,
      authorText: author ? author.textContent : null,
      authorFont: rs ? rs.fontSize + '/' + rs.fontWeight : null,
      bodyText: body ? (body.textContent || '').slice(0, 40) : null,
      bodyFont: bs ? bs.fontSize + '/' + bs.fontWeight + '/' + bs.lineHeight : null,
      pills: pills.map(e => { const b = e.getBoundingClientRect(); return { label: (e.getAttribute('aria-label') || e.textContent || '').slice(0, 12), box: Math.round(b.width) + 'x' + Math.round(b.height) }; }).slice(0, 5),
      replyExpander: (document.body.innerText.match(/\\d+\\s+repl(y|ies)/i) || [null])[0] || null,
      showMore: /show more|\\d+\\s+comments?/i.test(document.body.innerText),
    };
  })()`);
  await shot("comments-seeded");
  // 3d. the sort behavior: click Newest → order changes
  const sorted = await evalJS(`(() => {
    const b = [...document.querySelectorAll('.wfx-comments button,[class*=comments] button')].find(e => /^newest$/i.test((e.textContent || '').trim()));
    if (!b) return { clicked: false };
    b.click(); return { clicked: true };
  })()`);
  if (sorted?.clicked) {
    await sleep(600);
    report.checks.commentsSorted = await evalJS(`(() => {
      const rows = [...document.querySelectorAll('.wfx-comments [class*=row],[class*=comments] [class*=item],[class*=comments] [class*=thread]')];
      return { order: rows.map(r => { const a = r.querySelector('[class*=author],[class*=handle]'); return a ? a.textContent : '?'; }).slice(0, 5) };
    })()`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. SHARE (O4) — Copy click → the toast; Start-at → t= param
  // ═══════════════════════════════════════════════════════════════════════
  const shareClicked = await evalJS(`(() => {
    const e = [...document.querySelectorAll('button,[role=button],a')].find(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
    if (!e) return false; e.click(); return true;
  })()`);
  if (shareClicked) {
    await sleep(900);
    report.checks.shareDialogDeep = await evalJS(`(() => {
      const d = document.querySelector('.wfx-share__panel, dialog, [role=dialog]');
      if (!d) return { found: false };
      const b = d.getBoundingClientRect();
      const tiles = [...d.querySelectorAll('button,a,[role=button]')]
        .filter(e => { const tb = e.getBoundingClientRect(); return Math.round(tb.width) === 70 && Math.round(tb.height) === 93; })
        .map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16));
      const linkField = d.querySelector('input');
      const startAt = [...d.querySelectorAll('input[type=checkbox],label')].find(e => /start at/i.test(e.textContent || ''));
      return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height),
        tileRow: tiles, tileCount: tiles.length,
        linkFieldValue: linkField ? (linkField.value || '').slice(0, 70) : null,
        linkFieldFont: linkField ? getComputedStyle(linkField).fontSize + '/' + getComputedStyle(linkField).fontWeight : null,
        startAtPresent: !!startAt };
    })()`);
    await shot("share-deep");
    // Copy click → toast (N26 + O4's corpus law)
    const copyClicked = await evalJS(`(() => {
      const e = [...document.querySelectorAll('.wfx-share__panel button,[role=dialog] button,dialog button')].find(e => /^\\s*copy\\b/i.test(e.getAttribute('aria-label') || e.textContent || ''));
      if (!e) return false; e.click(); return true;
  })()`);
    if (copyClicked) {
      await sleep(900);
      report.checks.shareCopyToast = await evalJS(`(() => {
        const toasts = [...document.querySelectorAll('[class*=toast],[class*=snackbar],[role=status],[aria-live]')].filter(e => (e.textContent || '').trim().length > 0 && e.getBoundingClientRect().width > 0);
        return { toastCount: toasts.length, texts: toasts.map(t => (t.textContent || '').trim().slice(0, 40)),
          bodyMatch: (document.body.innerText.match(/copied[^\\n]{0,30}/i) || [null])[0] };
      })()`);
      await shot("share-copy-toast");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. N28 — the PWA install prompt placement (no in-page floating chrome)
// ═══════════════════════════════════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(800);
report.checks.pwaPrompt = await evalJS(`(() => {
  const prompt = [...document.querySelectorAll('button,[role=button],a,div,section')].filter(e => /install\\s+webflix/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
  return { count: prompt.length, boxes: prompt.map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }) };
})()`);

// ═══════════════════════════════════════════════════════════════════════════
// 6. THEME toggle behavior (N15 mechanism): click the toggle → persists
// ═══════════════════════════════════════════════════════════════════════════
const toggle = await evalJS(`(() => {
  const e = [...document.querySelectorAll('button,[role=button]')].find(e => /switch to (dark|light) theme/i.test(e.getAttribute('aria-label') || ''));
  return e ? { label: e.getAttribute('aria-label') } : null;
})()`);
if (toggle) {
  await evalJS(`(() => { const e = [...document.querySelectorAll('button,[role=button]')].find(e => /switch to (dark|light) theme/i.test(e.getAttribute('aria-label') || '')); e.click(); return 'toggled'; })()`);
  await sleep(900);
  report.checks.themeAfterToggle = await evalJS(`(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    storedChoice: localStorage.getItem('wfx-theme'),
  }))()`);
  await shot("theme-toggled");
}

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`PROBE -> ${OUT}`);
console.log(JSON.stringify({
  hoverSingletonBefore: report.checks.hoverSingletonBefore,
  hoverOpen: (report.checks.hoverTimeline || []).filter((s: any) => s.open).slice(0, 2),
  hoverUnhover: (report.checks.hoverUnhover || []).slice(0, 3),
  kebab: report.checks.kebab, kebabMenu: report.checks.kebabMenu,
  commentsAnon: report.checks.commentsAnon, commentsAnonGate: report.checks.commentsAnonGate,
  commentsSeeded: report.checks.commentsSeeded,
  shareDialogDeep: report.checks.shareDialogDeep, shareCopyToast: report.checks.shareCopyToast,
  pwaPrompt: report.checks.pwaPrompt, themeAfterToggle: report.checks.themeAfterToggle,
}, null, 1).slice(0, 3600));
