#!/usr/bin/env bun
// R28-C VERIFICATION HARNESS — re-runs the operator-complaint checks against a
// booted WebFlix instance (agent-browser CLI driven from Bun) and emits a JSON
// verdict report. Usage:
//   bun evidence/r28-recon/verify.ts http://localhost:3101 [tag]
// The report lands at evidence/r28-recon/verifications/<tag>.report.json
// A check is VERIFIED only when this harness reproduces the fixed behavior.

import { $ } from "bun";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const OUT = `evidence/r28-recon/verifications/${TAG}.report.json`;

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
// The harness calibrates its own viewport so runs are comparable across boots.
await ab("set", "viewport", 1440, 900);

// ── O5 fonts ──────────────────────────────────────────────────────────────
await open(`${BASE}/`);
report.checks.fonts = await evalJS(`(() => {
  const loaded = Array.from(document.fonts).map(f => f.family);
  return {
    declared: getComputedStyle(document.body).fontFamily,
    loadedFonts: loaded,
    robotoLoaded: loaded.some(f => /roboto/i.test(f)),
    geistOnly: loaded.every(f => /geist/i.test(f)),
  };
})()`);

// ── O6 background tokens ──────────────────────────────────────────────────
report.checks.background = await evalJS(`(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  return { bodyBg: bg, tokenCorrect: bg === "rgb(15, 15, 15)" };
})()`);

// ── O2 click-count trace (home card → ???) ────────────────────────────────
const cardLink = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a[href*="/item"], main a.wfx-card, main [data-wfx-card], main a[href*="/watch"]')].find(el => !el.closest('nav') && !/^(watch|home|shorts|library|history|settings|offline)$/i.test((el.textContent || '').trim())) || document.querySelector('main a[href*="/item"], main a.wfx-card');
  return c ? { href: c.getAttribute('href'), label: c.getAttribute('aria-label') || (c.textContent || '').slice(0, 40) } : null;
})()`);
report.checks.clickTrace = { firstCard: cardLink, steps: [] };
if (cardLink?.href) {
  const href = cardLink.href.startsWith("http") ? cardLink.href : BASE + cardLink.href;
  await open(href);
  const step1 = await evalJS(`(() => ({
    url: location.pathname,
    hasVideo: !!document.querySelector('video'),
    hasIframe: !!document.querySelector('iframe'),
    hasPlayControl: !![...document.querySelectorAll('button,a,[role=button]')].find(e => /play/i.test(e.getAttribute('aria-label') || e.textContent || '')),
    title: (document.querySelector('h1')?.textContent || '').slice(0, 60) || null,
  }))()`);
  report.checks.clickTrace.steps.push({ n: 1, after: "click card", ...step1 });
  if (!step1.hasVideo && !step1.hasIframe) {
    const playSel = await evalJS(`(() => {
      const p = [...document.querySelectorAll('a,button,[role=button]')].find(e => /^\\s*(play|watch now)\\b/i.test(e.getAttribute('aria-label') || e.textContent || ''));
      return p ? { tag: p.tagName, label: p.getAttribute('aria-label') || (p.textContent || '').slice(0, 30), href: p.getAttribute('href') } : null;
    })()`);
    if (playSel?.href) {
      const href2 = playSel.href.startsWith("http") ? playSel.href : BASE + playSel.href;
      await open(href2);
      const step2 = await evalJS(`(() => ({
        url: location.pathname,
        hasVideo: !!document.querySelector('video'),
        hasIframe: !!document.querySelector('iframe'),
        videoPlaying: (() => { const v = document.querySelector('video'); return v ? !v.paused && v.readyState > 2 : false; })(),
        hasPlayControl: !![...document.querySelectorAll('button,[role=button]')].find(e => /\\bplay\\b/i.test(e.getAttribute('aria-label') || e.textContent || '')),
      }))()`);
      report.checks.clickTrace.steps.push({ n: 2, after: "click Play", ...step2 });
      if (!step2.videoPlaying && step2.hasPlayControl) {
        report.checks.clickTrace.steps.push({ n: 3, note: "Play control still required — 3rd action" });
      }
    }
  }
}
report.checks.clickTrace.userActionsToPlayAttempt =
  report.checks.clickTrace.steps.filter((s: any) => s.after).length +
  (report.checks.clickTrace.steps.some((s: any) => s.n === 3) ? 1 : 0);

// ── O1 hover preview ──────────────────────────────────────────────────────
await open(`${BASE}/`);
await ab("scroll", "down", 800);
const hover = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a.wfx-card, main a[href*="/item"], main [data-wfx-card]')].find(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.y > 0 && b.y < 700; });
  if (!c) return { found: false };
  const b = c.getBoundingClientRect();
  return { found: true, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
})()`);
if (hover?.found) {
  await ab("mouse", "move", hover.x, hover.y);
  await new Promise(r => setTimeout(r, 1700));
  report.checks.hoverPreview = await evalJS(`(() => ({
    videos: document.querySelectorAll('video').length,
    gifs: document.querySelectorAll('img[src*=".gif"], img[src*="preview"]').length,
    previewScaffolding: [...document.querySelectorAll('[class*=preview],[class*=cardpreview]')].map(e => ({ cls: e.className.toString().slice(0, 40), children: e.children.length })),
  }))()`);
  if (report.checks.hoverPreview) report.checks.hoverPreview.dwellMs = 1700;
}

// ── O3 comments (player surface) ──────────────────────────────────────────
const watchUrl = cardLink?.href
  ? (cardLink.href.startsWith("http") ? cardLink.href : BASE + cardLink.href).replace("/item", "/player")
  : `${BASE}/player`;
await open(watchUrl);
report.checks.comments = await evalJS(`(() => ({
  commentEls: document.querySelectorAll('[class*=comment],[data-wfx-comment],[id*=comment]').length,
  bodyHasCommentsWord: (document.body.innerText.match(/comment/gi) || []).length,
  headings: [...document.querySelectorAll('h1,h2,h3')].map(h => (h.textContent || '').toLowerCase().trim()).filter(t => t.includes('comment')),
  composer: !!document.querySelector('[class*=composer],[contenteditable],textarea[placeholder*=comment i]'),
}))()`);

// ── O4 share ──────────────────────────────────────────────────────────────
report.checks.share = await evalJS(`(() => {
  const shareCtrls = [...document.querySelectorAll('[data-wfx-share-toggle],[aria-label*=share i],button,a')].filter(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
  return {
    onPlayerPage: shareCtrls.length > 0,
    shareControlCount: shareCtrls.length,
    controlTags: shareCtrls.map(e => e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent || '').slice(0, 30)),
  };
})()`);
const canOpen = await evalJS(`!!document.querySelector('[data-wfx-share-toggle]')`);
if (canOpen) {
  await evalJS(`document.querySelector('[data-wfx-share-toggle]').click(); 'clicked'`);
  await new Promise(r => setTimeout(r, 600));
  report.checks.share.openedSurface = await evalJS(`(() => {
    const d = document.querySelector('details.wfx-share, [data-wfx-share]');
    const t = d ? (d.innerText || '') : '';
    return {
      text: t.slice(0, 300),
      buttons: d ? d.querySelectorAll('button,a').length : 0,
      hasEmbed: /embed/i.test(t),
      hasStartAt: /start at/i.test(t),
      socialTargets: (t.match(/(facebook|twitter|x\\.com|whatsapp|telegram|reddit|linkedin|email|copy)/gi) || []),
      linkIsRawParamPath: /connector=|ref=/.test(t),
    };
  })()`);
}

// ── chrome: rail + masthead + hero + thumbs ───────────────────────────────
await open(`${BASE}/`);
report.checks.chrome = await evalJS(`(() => {
  const navLinks = [...document.querySelectorAll('nav a')].map(a => (a.textContent || '').trim());
  const hero = document.querySelector('section[aria-label^="Featured"], [class*=hero]');
  return {
    topbarH: Math.round((document.querySelector('header, [class*=topbar]') || document.body).getBoundingClientRect().height),
    railHistoryCount: navLinks.filter(l => l === 'History').length,
    hasMic: !!document.querySelector('[aria-label*=mic i],[aria-label*=voice i]'),
    hasBell: !!document.querySelector('[aria-label*=notification i]'),
    hero: hero ? Math.round(hero.getBoundingClientRect().width) + 'x' + Math.round(hero.getBoundingClientRect().height) : null,
    feedConfigText: document.body.innerText.includes('What your feed shows'),
    realImgThumbs: document.querySelectorAll('.wfx-card img, [data-wfx-card] img').length,
    gradientThumbs: [...document.querySelectorAll('.wfx-card__thumb, [class*=thumb]')].filter(e => /gradient/i.test(e.getAttribute('style') || '') || getComputedStyle(e).backgroundImage.includes('gradient')).length,
  };
})()`);

// ── write report ──────────────────────────────────────────────────────────
await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`REPORT -> ${OUT}`);
console.log(JSON.stringify({
  fonts: { robotoLoaded: report.checks.fonts?.robotoLoaded, declared: report.checks.fonts?.declared },
  bg: report.checks.background,
  actionsToPlay: report.checks.clickTrace.userActionsToPlayAttempt,
  hover: report.checks.hoverPreview ? { videos: report.checks.hoverPreview.videos } : null,
  comments: report.checks.comments,
  share: { onPlayerPage: report.checks.share?.onPlayerPage, buttons: report.checks.share?.openedSurface?.buttons },
  chrome: report.checks.chrome,
}, null, 2));
