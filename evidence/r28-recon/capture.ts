#!/usr/bin/env bun
// R28-C CAPTURE DRIVER — the PNG evidence producer. Complements verify.ts (operator
// data) + verify-corpus.ts (corpus spec data) with the visual evidence set:
//   verifications/<tag>-home.png, -hover-250ms.png, -hover-1.7s.png,
//   -click1.png, -click2.png, -comments.png, -share.png
// and a JSON summary verifications/<tag>.capture.json.
// Real clicks (data-attr targeting) so SPA soft-nav — part of the one-click law —
// is exercised, not bypassed by URL opens. Absolute screenshot paths (the
// agent-browser daemon resolves relative paths against its own CWD).
// Usage: bun evidence/r28-recon/capture.ts http://localhost:3101 [tag]

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUTD = resolve("evidence/r28-recon/verifications");
const OUT = `${OUTD}/${TAG}.capture.json`;

const ab = async (...args: (string | number)[]): Promise<string> => {
  const p = await $`agent-browser ${args.map(String)}`.nothrow().quiet();
  return p.stdout.toString().trim();
};
const evalJS = async (js: string): Promise<any> => {
  const out = await ab("eval", js);
  try { return JSON.parse(out); } catch { return out; }
};
const open = async (url: string) => { await ab("open", url); await ab("wait", "--load", "networkidle"); };
const shot = (name: string) => ab("screenshot", `${OUTD}/${TAG}-${name}.png`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

await ab("set", "viewport", 1440, 900);
const report: any = { tag: TAG, base: BASE, at: new Date().toISOString(), shots: [], checks: {} };

// ── home first screen ──────────────────────────────────────────────────────
await open(`${BASE}/`);
await sleep(600);
await shot("home"); report.shots.push("home");
report.checks.home = await evalJS(`(() => ({
  path: location.pathname,
  bg: getComputedStyle(document.body).backgroundColor,
  htmlClass: document.documentElement.className.slice(0, 60),
  themeAttr: document.documentElement.getAttribute('dark') !== null ? 'dark-attr' : (document.documentElement.getAttribute('data-theme') || null),
  heroW: (() => { const h = document.querySelector('section[aria-label^="Featured"], [class*=hero]'); return h ? Math.round(h.getBoundingClientRect().width) : null; })(),
}))()`);

// ── fonts (O5) ─────────────────────────────────────────────────────────────
// NOTE: document.fonts.check() is system-font-dependent (true even when no
// webfont loads); the honest instrument is the FontFaceSet census — YouTube
// SERVES Roboto woff2, so the set must contain a Roboto face.
report.checks.fonts = await evalJS(`(() => ({
  loaded: Array.from(document.fonts).map(f => f.family + ':' + f.weight + ':' + f.status),
  robotoFacesInSet: Array.from(document.fonts).filter(f => /roboto/i.test(f.family)).map(f => f.family + ':' + f.weight),
  h1family: (() => { const e = document.querySelector('h1, [class*=title]'); return e ? getComputedStyle(e).fontFamily.slice(0, 50) : null; })(),
}))()`);

// ── hover preview (O1) — corpus dwell ~150ms ───────────────────────────────
await ab("scroll", "down", 1100);  // past main's 775px hero so cards enter the viewport
await sleep(400);
const hover = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a.wfx-card, main a[href*="/item"], main a[href*="/watch"], main [data-wfx-card], main [class*=card] a')]
    .find(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 40 && b.y < 700; });
  if (!c) return { found: false };
  c.setAttribute('data-r28c-hover', '1');
  const b = c.getBoundingClientRect();
  return { found: true, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), label: (c.getAttribute('aria-label') || c.textContent || '').slice(0, 40) };
})()`);
report.checks.hover = { target: hover };
if (hover?.found) {
  await ab("mouse", "move", hover.x, hover.y);
  await sleep(250);
  report.checks.hover.at250ms = await evalJS(`(() => ({
    videos: document.querySelectorAll('video').length,
    hoverElClass: document.elementFromPoint(${hover.x}, ${hover.y})?.className?.toString().slice(0, 40),
    previews: [...document.querySelectorAll('[class*=preview], [class*=cardpreview], ytd-video-preview')].slice(0, 3).map(e => ({
      cls: e.className.toString().slice(0, 40), children: e.children.length,
      box: (() => { const b = e.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); })(),
    })),
  }))()`);
  await shot("hover-250ms"); report.shots.push("hover-250ms");
  await sleep(1300);
  report.checks.hover.at1_7s = await evalJS(`(() => ({
    videos: document.querySelectorAll('video').length,
    playing: (() => { const v = document.querySelector('video'); return v ? !v.paused : false; })(),
    previews: [...document.querySelectorAll('[class*=preview], [class*=cardpreview], ytd-video-preview')].slice(0, 3).map(e => ({
      children: e.children.length, opacity: getComputedStyle(e).opacity, display: getComputedStyle(e).display,
    })),
  }))()`);
  await shot("hover-1.7s"); report.shots.push("hover-1.7s");
  await ab("mouse", "move", 10, 10);
}

// ── click trace (O2) — one-click law, REAL click (SPA soft-nav) ────────────
await open(`${BASE}/`);
await ab("scroll", "down", 1100);
await sleep(400);
const card = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a[href*="/item"], main a[href*="/watch"], main a.wfx-card, main [class*=card] a')]
    .find(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 0; });
  if (!c) return null;
  c.scrollIntoView({ block: 'center' });
  c.setAttribute('data-r28c-click', '1');
  return { href: c.getAttribute('href'), label: (c.getAttribute('aria-label') || c.textContent || '').slice(0, 40) };
})()`);
await sleep(300);
report.checks.clickTrace = { card, steps: [] };
if (card) {
  await ab("click", "[data-r28c-click='1']");
  await ab("wait", "--load", "networkidle");
  await sleep(1500);
  const step1 = await evalJS(`(() => ({
    path: location.pathname + location.search.slice(0, 80),
    nav: performance.getEntriesByType('navigation').slice(-1)[0]?.type || null,
    hasVideo: !!document.querySelector('video'),
    playing: (() => { const v = document.querySelector('video'); return v ? !v.paused : false; })(),
    hasIframe: !!document.querySelector('iframe'),
    h1: (document.querySelector('h1')?.textContent || '').slice(0, 40),
  }))()`);
  report.checks.clickTrace.steps.push({ n: 1, after: "click card", ...step1 });
  await shot("click1"); report.shots.push("click1");
  if (!step1.playing) {
    const needs2 = await evalJS(`(() => {
      const v = document.querySelector('video'); if (v && !v.paused) return 'no';
      const p = [...document.querySelectorAll('a, button, [role=button]')].find(e => /^\\s*(play|watch now)\\b/i.test(e.getAttribute('aria-label') || e.textContent || ''));
      if (p) { p.setAttribute('data-r28c-play', '1'); return 'yes'; }
      return 'none';
    })()`);
    if (needs2 === "yes") {
      await ab("click", "[data-r28c-play='1']");
      await ab("wait", "--load", "networkidle");
      await sleep(1500);
      const step2 = await evalJS(`(() => ({
        path: location.pathname + location.search.slice(0, 80),
        hasVideo: !!document.querySelector('video'),
        playing: (() => { const v = document.querySelector('video'); return v ? !v.paused : false; })(),
        playBtnStill: !![...document.querySelectorAll('button, [role=button]')].find(e => /\\bplay\\b/i.test(e.getAttribute('aria-label') || e.textContent || '') && getComputedStyle(e).display !== 'none'),
      }))()`);
      report.checks.clickTrace.steps.push({ n: 2, after: "click Play", ...step2 });
      await shot("click2"); report.shots.push("click2");
    }
  }
}

// ── comments (O3) on the landing surface ───────────────────────────────────
await ab("scroll", "down", 700);
await sleep(800);
report.checks.comments = await evalJS(`(() => ({
  path: location.pathname,
  commentEls: document.querySelectorAll('[class*=comment], [id*=comment], [data-wfx-comment]').length,
  headerText: (() => { const h = [...document.querySelectorAll('h1, h2, h3')].find(e => /\\d+\\s+comments?/i.test(e.textContent || '')); return h ? h.textContent.trim() : null; })(),
  threads: document.querySelectorAll('[class*=comment-thread], [class*=comment]:not([class*=composer])').length,
  composer: !!document.querySelector('[placeholder*=comment i], textarea, [contenteditable]'),
}))()`);
await shot("comments"); report.shots.push("comments");

// ── share (O4) ─────────────────────────────────────────────────────────────
const share = await evalJS(`(() => {
  const t = document.querySelector('[data-wfx-share-toggle]') ||
    [...document.querySelectorAll('[aria-label*=share i], button, a')].find(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
  if (!t) return { found: false };
  t.setAttribute('data-r28c-share', '1');
  return { found: true, label: (t.getAttribute('aria-label') || t.textContent || '').slice(0, 30) };
})()`);
if (share?.found) {
  await ab("click", "[data-r28c-share='1']");
  await sleep(900);
  report.checks.share = await evalJS(`(() => {
    const d = document.querySelector('[role=dialog], [class*=modal], [class*=sheet], details[open], [data-wfx-share]');
    if (!d) return { found: false };
    const b = d.getBoundingClientRect(); const s = getComputedStyle(d); const t = d.innerText || '';
    return {
      found: true, box: Math.round(b.width) + 'x' + Math.round(b.height), radius: s.borderRadius, bg: s.backgroundColor,
      shortLink: /youtu\\.be|\\?si=|\\?t=|start/i.test(t), startAt: /start at/i.test(t),
      lines: t.split('\\n').filter(x => x.trim() && x.length < 24).slice(0, 14),
    };
  })()`);
  await shot("share"); report.shots.push("share");
} else {
  report.checks.share = { found: false, note: "no share control on the landing surface" };
}

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`CAPTURE -> ${OUT}`);
console.log(JSON.stringify({ shots: report.shots, checks: report.checks }, null, 1).slice(0, 2500));
