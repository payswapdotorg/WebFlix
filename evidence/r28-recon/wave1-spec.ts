#!/usr/bin/env bun
// R28-C WAVE-1 SPEC CHECKS — the follow-up measurements the standard harness
// doesn't carry: iframe autoplay params (O2's decisive datum, cross-origin so
// src-params are the observable), chip inversion pair (N14's signature look),
// duration pill alpha + badge grammar (N16/N19), player chrome labels (N9/N25).
// Usage: bun evidence/r28-recon/wave1-spec.ts http://localhost:3101 b1-1d32ed8

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = resolve(`evidence/r28-recon/verifications/${TAG}-spec.json`);

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

// ── O2 iframe autoplay (service mode) — the decisive datum ─────────────────
await open(`${BASE}/`);
await sleep(600);
const card = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a[href*="/player"], main a[href*="/item"], main a.wfx-card, main [class*=card] a')]
    .find(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 0; });
  return c ? { href: c.getAttribute('href') } : null;
})()`);
report.checks.card = card;
if (card?.href) {
  await open(`${BASE}${card.href}`);
  await sleep(2000);
  report.checks.playerIframe = await evalJS(`(() => ({
    iframes: [...document.querySelectorAll('iframe')].map(f => {
      const b = f.getBoundingClientRect();
      return { src: f.src, box: Math.round(b.width) + 'x' + Math.round(b.height) };
    }),
    autoplayParam: [...document.querySelectorAll('iframe')].some(f => /autoplay=1/.test(f.src)),
    muteParam: [...document.querySelectorAll('iframe')].some(f => /(mute=1|mute=true)/.test(f.src)),
    unmuteAffordances: [...document.querySelectorAll('button,[role=button],a,[aria-label]')]
      .filter(e => /unmute|mute|sound/i.test(e.getAttribute('aria-label') || e.textContent || ''))
      .map(e => (e.getAttribute('aria-label') || e.textContent || '').slice(0, 40)).slice(0, 5),
    playControls: [...document.querySelectorAll('button[aria-label]')]
      .map(b => b.getAttribute('aria-label')).filter(l => /play|pause|mute|fullscreen|theater|volume/i.test(l || '')).slice(0, 10),
  }))()`);
  await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-player-autoplay.png`));
  await ab("scroll", "down", 600);
  await sleep(600);
  report.checks.playerBelow = await evalJS(`(() => ({
    actionRow: [...document.querySelectorAll('button,[role=button],a')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().toLowerCase()).filter(t => /^(like|dislike|share|download|save|subscribe|more actions|copy link|description)/.test(t)).slice(0, 12),
    descriptionPresent: !!document.querySelector('[class*=description],[class*=details]'),
    comments: document.querySelectorAll('[class*=comment],[id*=comment]').length,
  }))()`);
}

// ── N14 chip inversion pair + N16 duration pill + N19 badge grammar ────────
await open(`${BASE}/`);
await sleep(600);
report.checks.chips = await evalJS(`(() => {
  const chips = [...document.querySelectorAll('[class*=chip], [role=radio], button')]
    .filter(e => /^\\s*(all|short|movie|series|music|gaming)\\s*$/i.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0);
  const active = chips[0];
  if (!active) return { found: false };
  const s = getComputedStyle(active);
  const inactive = chips[1];
  const si = inactive ? getComputedStyle(inactive) : null;
  return { found: true, count: chips.length,
    active: { bg: s.backgroundColor, color: s.color, h: Math.round(active.getBoundingClientRect().height) },
    inactive: si ? { bg: si.backgroundColor, color: si.color } : null,
    labels: chips.map(c => (c.textContent || '').trim()).slice(0, 8),
  };
})()`);
report.checks.durationPill = await evalJS(`(() => {
  const badge = [...document.querySelectorAll('[class*=badge],[class*=duration],[class*=pill]')]
    .find(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 80 && /\\d/.test(e.textContent || ''));
  if (!badge) return { found: false };
  const b = badge.getBoundingClientRect(); const s = getComputedStyle(badge);
  return { found: true, text: (badge.textContent || '').trim().slice(0, 14), box: Math.round(b.width) + 'x' + Math.round(b.height),
    bg: s.backgroundColor, color: s.color, font: s.fontSize + '/' + s.fontWeight, radius: s.borderRadius, pad: s.padding };
})()`);
report.checks.cardTitle = await evalJS(`(() => {
  const card = [...document.querySelectorAll('main a.wfx-card, main [class*=card] a, main a[href*="/player"], main a[href*="/item"]')]
    .find(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 0; });
  if (!card) return { found: false };
  const title = card.querySelector('h3, [class*=title]');
  if (!title) return { found: false, cardLabel: (card.textContent || '').slice(0, 40) };
  const s = getComputedStyle(title);
  const rect = title.getBoundingClientRect();
  return { found: true, text: (title.textContent || '').slice(0, 40), font: s.fontFamily.slice(0, 40), size: s.fontSize, weight: s.fontWeight, lineClamp: s.webkitLineClamp || s.lineClamp || null, titleH: Math.round(rect.height) };
})()`);

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`SPEC -> ${OUT}`);
console.log(JSON.stringify(report.checks, null, 1).slice(0, 2400));
