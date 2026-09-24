#!/usr/bin/env bun
// R28-C CORPUS-SPEC CHECKS — the corpus-specified geometry/anatomy checks that
// complement verify.ts (the operator-complaint checks). Usage:
//   bun evidence/r28-recon/verify-corpus.ts http://localhost:3101 [tag]
// Report: evidence/r28-recon/verifications/<tag>.corpus.json
// Each check carries its corpus citation (A's sheet + measured value).

import { $ } from "bun";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = `evidence/r28-recon/verifications/${TAG}.corpus.json`;

const ab = async (...args: (string | number)[]): Promise<string> => {
  const p = await $`agent-browser ${args.map(String)}`.nothrow().quiet();
  return p.stdout.toString().trim();
};
const evalJS = async (js: string): Promise<any> => {
  const out = await ab("eval", js);
  try { return JSON.parse(out); } catch { return out; }
};
const open = async (url: string) => { await ab("open", url); await ab("wait", "--load", "networkidle"); };

const report: any = { tag: TAG, base: BASE, at: new Date().toISOString(), checks: {} };

// Corpus fidelity: every corpus value is measured @1440×900 (R28-A sheets).
await ab("set", "viewport", 1440, 900);

// ── N14 chips: h32 r8 14/500, active inverted (corpus color-survey.md) ─────
await open(`${BASE}/`);
report.checks.chips = await evalJS(`(() => {
  const chips = [...document.querySelectorAll('[class*=chip], [role=radio], button')].filter(e => /^\\s*(all|short|movie|series|music|gaming)\\s*$/i.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0);
  const c = chips[0];
  if (!c) return { found: false };
  const b = c.getBoundingClientRect(); const s = getComputedStyle(c);
  return { found: true, count: chips.length, h: Math.round(b.height), radius: s.borderRadius, fontSize: s.fontSize, fontWeight: s.fontWeight, pad: s.padding };
})()`);

// ── N19 card grid: 16:9 thumb, r12, duration badge (home-anatomy.md) ──────
await ab("scroll", "down", 900);
report.checks.cards = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('main a.wfx-card, main [data-wfx-card], main [class*=card]')].filter(e => e.getBoundingClientRect().width > 150 && e.getBoundingClientRect().height > 100);
  const c = cards[0];
  if (!c) return { found: false };
  const b = c.getBoundingClientRect();
  const thumb = c.querySelector('[class*=thumb]');
  const tb = thumb ? thumb.getBoundingClientRect() : null;
  const badge = c.querySelector('[class*=badge],[class*=duration],[class*=pill]');
  return { found: true, count: cards.length, card: Math.round(b.width) + 'x' + Math.round(b.height), thumb: tb ? Math.round(tb.width) + 'x' + Math.round(tb.height) : null, thumbRadius: thumb ? getComputedStyle(thumb).borderRadius : null, thumbAspect: tb ? Math.round((tb.width / tb.height) * 100) / 100 : null, badgePresent: !!badge, badgeText: badge ? badge.textContent.trim().slice(0, 12) : null };
})()`);

// ── O5/N-role typography spot-check (fonts.md) ────────────────────────────
report.checks.typography = await evalJS(`(() => {
  const h1 = document.querySelector('main h1, main [class*=title]');
  const meta = document.querySelector('main [class*=meta], main [class*=subtitle]');
  const probe = (el) => { if (!el) return null; const s = getComputedStyle(el); return { font: s.fontFamily.slice(0, 40), size: s.fontSize, weight: s.fontWeight }; };
  return { cardOrHeadingTitle: probe(h1), metaLine: probe(meta) };
})()`);

// ── watch/player page: N21 geometry + N9 action row + N25 keys ────────────
await open(`${BASE}/`);
const cardHref = await evalJS(`(() => { const c = document.querySelector('main a[href*="/item"], main a.wfx-card, main [class*=card]'); return c ? c.getAttribute('href') : null; })()`);
let watchUrl = `${BASE}/player`;
if (cardHref) {
  watchUrl = (cardHref.startsWith("http") ? cardHref : BASE + cardHref).replace("/item", "/player");
} else {
  // fall back: take any /item link on home and convert
  const anyItem = await evalJS(`(() => { const c = document.querySelector('a[href*="/item"]'); return c ? c.getAttribute('href') : null; })()`);
  if (anyItem) watchUrl = (anyItem.startsWith("http") ? anyItem : BASE + anyItem).replace("/item", "/player");
}
await open(watchUrl);
report.checks.watchPage = await evalJS(`(() => {
  const layout = document.querySelector('.wfx-player__layout, [class*=player] [class*=layout], [class*=watch] [class*=columns], main [class*=layout]');
  const playerPad = document.querySelector('.wfx-player, main [class*=player]');
  const stage = document.querySelector('[class*=stage], video, iframe, [class*=player] iframe');
  const sb = stage ? stage.getBoundingClientRect() : null;
  const actions = [...document.querySelectorAll('button, [role=button], a')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().toLowerCase()).filter(t => /^(like|dislike|share|download|save|subscribe|more actions|copy link)/.test(t));
  const desc = document.querySelector('[class*=description], [class*=details]');
  return {
    layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null,
    layoutGap: layout ? getComputedStyle(layout).gap : null,
    playerPadding: playerPad ? getComputedStyle(playerPad).padding : null,
    stageBox: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null,
    actionRow: actions,
    descriptionPresent: !!desc,
    descMore: desc ? /\.\.\.more|show less/i.test(desc.textContent || '') : false,
    keyLabels: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /\\((k|f|t|i|m|j|l|c)\\)/.test(l || '')),
  };
})()`);

// ── N22 related rows: 168x94 + 4px gap + autoplay toggle ──────────────────
report.checks.related = await evalJS(`(() => {
  const rel = [...document.querySelectorAll('[class*=related] a, [class*=up-next] a, [class*=explore] a, [class*=compact] a')].filter(e => e.getBoundingClientRect().width > 50);
  const first = rel[0];
  const thumb = first ? first.querySelector('[class*=thumb], img') : null;
  const auto = [...document.querySelectorAll('input[type=checkbox], [role=switch], [class*=toggle]')].find(e => /autoplay/i.test((e.getAttribute('aria-label') || e.textContent || 'autoplay')));
  return { rows: rel.length, firstThumb: thumb ? Math.round(thumb.getBoundingClientRect().width) + 'x' + Math.round(thumb.getBoundingClientRect().height) : null, autoplayToggle: !!auto, autoplayType: auto ? auto.tagName + '.' + (auto.getAttribute('role') || auto.type || '') : null };
})()`);

// ── O3 comments anatomy (comments-anatomy.md) ─────────────────────────────
report.checks.commentsAnatomy = await evalJS(`(() => {
  const header = [...document.querySelectorAll('h1,h2,h3,[class*=count]')].find(e => /\\d+\\s+comments?/i.test(e.textContent || ''));
  const threads = document.querySelectorAll('[class*=comment-thread], [class*=comment]:not([class*=composer])');
  const first = threads[0];
  const avatar = first ? first.querySelector('img, [class*=avatar]') : null;
  const ab = avatar ? avatar.getBoundingClientRect() : null;
  const body = first ? first.querySelector('[class*=content], [class*=text], p') : null;
  const pills = first ? [...first.querySelectorAll('button, [role=button]')].filter(e => /^(like|dislike|reply)/i.test((e.textContent || '').trim())) : [];
  const sort = [...document.querySelectorAll('button, [role=button], [class*=sort]')].find(e => /^(top|newest|sort)/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()));
  const composer = document.querySelector('[placeholder*=comment i], textarea, [class*=composer]');
  return { headerCount: header ? header.textContent.trim() : null, threads: threads.length, threadAvatar: ab ? Math.round(ab.width) + 'x' + Math.round(ab.height) : null, bodyFont: body ? getComputedStyle(body).fontSize + '/' + getComputedStyle(body).lineHeight : null, actionPills: pills.length, sortControl: sort ? (sort.textContent || '').trim() : null, composerPlaceholder: composer ? (composer.getAttribute('placeholder') || composer.className.toString().slice(0, 30)) : null };
})()`);

// ── O4 share dialog (share-dialog.md) ─────────────────────────────────────
const shareToggle = await evalJS(`(() => { const t = document.querySelector('[data-wfx-share-toggle], [aria-label*=share i]'); return t ? true : false; })()`);
if (shareToggle) {
  await evalJS(`(() => { const t = document.querySelector('[data-wfx-share-toggle]') || [...document.querySelectorAll('[aria-label*=share i]')][0]; if (t) t.click(); return 'clicked'; })()`);
  await new Promise(r => setTimeout(r, 800));
  report.checks.shareDialog = await evalJS(`(() => {
    const dlg = document.querySelector('[role=dialog], [class*=modal], details[open], [class*=sheet]');
    const d = dlg || document.querySelector('[data-wfx-share]');
    if (!d) return { found: false };
    const b = d.getBoundingClientRect(); const s = getComputedStyle(d);
    const text = d.innerText || '';
    const tiles = [...d.querySelectorAll('button, a')].map(e => (e.textContent || '').trim()).filter(t => t && t.length < 20);
    return { found: true, box: Math.round(b.width) + 'x' + Math.round(b.height), radius: s.borderRadius, bg: s.backgroundColor, text: text.slice(0, 200), controls: tiles.slice(0, 12), hasStartAt: /start at/i.test(text), hasShortLink: /(\\.be\\/|\\/w\\/|youtu\\.be)/i.test(text) || /\\?si=/.test(text), socialTargets: (text.match(/(embed|whatsapp|facebook|reddit|linkedin|pinterest|x\\b|messages|email)/gi) || []) };
  })()`);
}

// ── N27 shorts shell ──────────────────────────────────────────────────────
await open(`${BASE}/shorts`);
report.checks.shortsShell = await evalJS(`(() => {
  const rail = [...document.querySelectorAll('button, [role=button]')].filter(e => /^(like|dislike|comments|share|more)$/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()));
  const audio = [...document.querySelectorAll('button, [role=button]')].find(e => /audio|mute|unmute|volume/i.test(e.getAttribute('aria-label') || e.textContent || ''));
  const stage = document.querySelector('[class*=stage], video, iframe');
  const sb = stage ? stage.getBoundingClientRect() : null;
  return { actionRailButtons: rail.length, railLabels: rail.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()), audioToggle: !!audio, stageBox: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null };
})()`);

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`CORPUS REPORT -> ${OUT}`);
console.log(JSON.stringify(report.checks, null, 1).slice(0, 3000));
