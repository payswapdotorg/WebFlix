#!/usr/bin/env bun
// R28-C WAVE-2 SPEC CHECKS — the follow-up measurements for B's expected wave-2
// surface set, each pinned to A's corpus contract:
//   O1  hover preview  — dwell ~150ms → singleton preview, +24px pop, media,
//                        opacity-fade on un-hover (element retained)
//   O6/N15 theme       — logged-out default LIGHT (#ffffff field), mechanism
//                        html[dark]-equivalent, toggle surface
//   O3/N11 comments    — "N Comments" 15px/700 header + Top/Newest sort; rows:
//                        avatar 36 circular, @handle 12px/500, time 12px/400,
//                        body 14px/400/20, like pills 32×32, Reply, composer
//   O4/N17/N26 share   — dialog 470×337 r12 + shadow; social tiles 70×93
//                        (Embed first); short-link field; Copy pill 64×40 r20;
//                        Start-at 0:00; "Link copied" toast
// Usage: bun evidence/r28-recon/wave2-spec.ts http://localhost:3101 <tag>

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

// ── O6/N15 theme default (fresh boot, no interaction) ──────────────────────
await open(`${BASE}/`);
await sleep(800);
report.checks.themeDefault = await evalJS(`(() => {
  const html = document.documentElement;
  const body = getComputedStyle(document.body);
  const appBg = (() => {
    const main = document.querySelector('main, [class*=app], #__next');
    return main ? getComputedStyle(main).backgroundColor : null;
  })();
  return {
    htmlClass: html.className || null,
    htmlAttrs: [...html.attributes].map(a => a.name + (a.value ? '=' + a.value : '')).slice(0, 8),
    htmlBg: getComputedStyle(html).backgroundColor,
    bodyBg: body.backgroundColor,
    appBg,
    colorScheme: getComputedStyle(html).colorScheme || null,
    metaTheme: document.querySelector('meta[name=theme-color]')?.content || null,
    lightField: body.backgroundColor === 'rgb(255, 255, 255)' || getComputedStyle(html).backgroundColor === 'rgb(255, 255, 255)',
    themeToggle: [...document.querySelectorAll('button,[role=button],[aria-label]')]
      .filter(e => /dark|light|theme|appearance/i.test(e.getAttribute('aria-label') || e.textContent || ''))
      .map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)).slice(0, 6),
  };
})()`);
await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-theme-default.png`));

// ── O1 hover preview (corpus: ~150ms dwell → singleton +24px pop + media) ──
await ab("scroll", "down", 800);
await sleep(400);
const hoverTarget = await evalJS(`(() => {
  const c = [...document.querySelectorAll('main a.wfx-card, main a[href*="/player"], main a[href*="/item"], main [class*=card] a, main [data-wfx-card]')]
    .find(el => { const b = el.getBoundingClientRect(); return b.width > 100 && b.height > 60 && b.y > 100 && b.y < 700; });
  if (!c) return { found: false };
  const thumb = c.querySelector('[class*=thumb], img') || c;
  const t = thumb.getBoundingClientRect();
  return { found: true, x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height / 2),
           thumbBox: Math.round(t.width) + 'x' + Math.round(t.height),
           cardBox: Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height) };
})()`);
report.checks.hover = { target: hoverTarget };
if (hoverTarget?.found) {
  // measure at ~250ms (past the 150ms threshold, before long-dwell states)
  await ab("mouse", "move", hoverTarget.x, hoverTarget.y);
  await sleep(250);
  report.checks.hover.at250ms = await evalJS(`(() => {
    const vids = [...document.querySelectorAll('video')].map(v => { const b = v.getBoundingClientRect(); return { box: Math.round(b.width) + 'x' + Math.round(b.height), paused: v.paused, readyState: v.readyState }; });
    const previews = [...document.querySelectorAll('[class*=preview],[class*=cardpreview],[data-wfx-preview],[class*=hover]')]
      .filter(e => e.getBoundingClientRect().width > 0)
      .map(e => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
        return { cls: e.className.toString().slice(0, 50), box: Math.round(b.width) + 'x' + Math.round(b.height), opacity: s.opacity, children: e.children.length, visible: s.visibility !== 'hidden' && s.display !== 'none' }; });
    const gifs = [...document.querySelectorAll('img[src$=".gif"], img[src*="preview"], video')].length;
    return { videos: vids.length, videoDetail: vids.slice(0, 3), previews, gifs,
             mediaCount: vids.length + gifs };
  })()`);
  await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-hover-250ms.png`));
  // long-dwell 1.7s: corpus says the preview stays (singleton retained)
  await sleep(1450);
  report.checks.hover.at1_7s = await evalJS(`(() => ({
    videos: document.querySelectorAll('video').length,
    previews: [...document.querySelectorAll('[class*=preview],[class*=cardpreview],[data-wfx-preview]')]
      .filter(e => e.getBoundingClientRect().width > 0).length,
  }))()`);
  await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-hover-1.7s.png`));
  // un-hover: corpus = opacity fade, ELEMENT RETAINED (not unmount)
  await ab("mouse", "move", 20, 450);
  await sleep(300);
  report.checks.hover.afterUnhover = await evalJS(`(() => ({
    videos: document.querySelectorAll('video').length,
    previewEls: document.querySelectorAll('[class*=preview],[class*=cardpreview],[data-wfx-preview]').length,
    faded: [...document.querySelectorAll('[class*=preview],[class*=cardpreview],[data-wfx-preview]')]
      .filter(e => { const s = getComputedStyle(e); return s.opacity !== '1' || s.visibility === 'hidden' || s.display === 'none'; }).length,
  }))()`);
}

// ── O3/N11 comments anatomy (player surface — independent of hover target) ──
const watchHref = await evalJS(`(() => { const c = [...document.querySelectorAll('main a[href*="/player"], main a[href*="/item"], main a.wfx-card, main [class*=card] a')].find(el => el.getBoundingClientRect().width > 100); return c ? c.getAttribute('href') : null; })()`) ?? await evalJS(`(() => { const c = document.querySelector('main a[href*="/player"], main a[href*="/item"]'); return c ? c.getAttribute('href') : null; })()`);
if (watchHref) {
  await open(`${BASE}${watchHref}`);
  await sleep(1800);
  report.checks.comments = await evalJS(`(() => {
    const region = document.querySelector('[class*=comment],[id*=comment],[data-wfx-comment]');
    const header = [...document.querySelectorAll('h1,h2,h3,[class*=comment] [class*=header],[class*=comment] h3')]
      .map(h => (h.textContent || '').trim()).find(t => /\\d+\\s*comments?/i.test(t)) || null;
    const headerEl = [...document.querySelectorAll('h1,h2,h3,div,span')].find(e => /\\d+\\s+comments?/i.test(e.textContent || '') && e.children.length < 4);
    const hs = headerEl ? getComputedStyle(headerEl) : null;
    const row = document.querySelector('[class*=comment][class*=row],[class*=comment][class*=item],[class*=thread],[data-wfx-comment]');
    const avatar = document.querySelector('[class*=comment] img,[class*=comment] [class*=avatar],[class*=comment] [class*=author] img');
    const as = avatar ? getComputedStyle(avatar) : null;
    const ab2 = avatar ? avatar.getBoundingClientRect() : null;
    const body = document.querySelector('[class*=comment] p,[class*=comment] [class*=body],[class*=comment] [class*=text]');
    const bs = body ? getComputedStyle(body) : null;
    const author = document.querySelector('[class*=comment] [class*=author],[class*=comment] [class*=handle],[class*=comment] a[href*=channel],[class*=comment] [class*=name]');
    const rs = author ? getComputedStyle(author) : null;
    return {
      region: !!region, regionCls: region ? region.className.toString().slice(0, 50) : null,
      headerText: header,
      headerFont: hs ? hs.fontSize + '/' + hs.fontWeight : null,
      sortMenu: /top|newest|sort/i.test(document.body.innerText) ? [...document.querySelectorAll('button,[role=button],select')].map(e => (e.textContent || '').trim()).filter(t => /^(top|newest|sort by|top comments|newest first)$/i.test(t)).slice(0, 4) : [],
      threadCount: document.querySelectorAll('[class*=comment][class*=row],[class*=thread],[data-wfx-comment]').length,
      avatarBox: ab2 ? Math.round(ab2.width) + 'x' + Math.round(ab2.height) : null,
      avatarRadius: as ? as.borderRadius : null,
      authorFont: rs ? rs.fontSize + '/' + rs.fontWeight : null,
      bodyFont: bs ? bs.fontSize + '/' + bs.fontWeight + '/' + bs.lineHeight : null,
      likePills: [...document.querySelectorAll('[class*=comment] button,[class*=comment] [role=button]')]
        .filter(e => /like|dislike|reply/i.test(e.getAttribute('aria-label') || e.textContent || ''))
        .map(e => { const b = e.getBoundingClientRect(); return { label: (e.getAttribute('aria-label') || e.textContent || '').slice(0, 14), box: Math.round(b.width) + 'x' + Math.round(b.height) }; }).slice(0, 6),
      composer: !!document.querySelector('[class*=comment] textarea,[class*=comment] [contenteditable],[placeholder*=comment i]'),
      composerPlaceholder: document.querySelector('[placeholder*=comment i]')?.getAttribute('placeholder') || null,
    };
  })()`);
  await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-comments.png`));

  // ── O4/N17/N26 share modal (same player surface) ─────────────────────────
  report.checks.shareEntry = await evalJS(`(() => {
    const btns = [...document.querySelectorAll('button,[role=button],a,[aria-label]')]
      .filter(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
    return { count: btns.length, labels: btns.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)).slice(0, 5),
             playerPage: btns.length > 0 };
  })()`);
  // open via the first share affordance (click for real)
  const opened = await evalJS(`(() => {
    const e = [...document.querySelectorAll('button,[role=button],a,[aria-label]')]
      .find(e => /share/i.test(e.getAttribute('aria-label') || e.textContent || '') && e.getBoundingClientRect().width > 0);
    if (!e) return false; e.click(); return true;
  })()`);
  if (opened) {
    await sleep(900);
    report.checks.shareDialog = await evalJS(`(() => {
      // find the topmost dialog-ish surface (dialog, [role=dialog], fixed overlay, details)
      const surfaces = [...document.querySelectorAll('dialog,[role=dialog],[class*=modal],[class*=dialog],[class*=popover],[class*=share],details[open]')]
        .filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 900);
      const d = surfaces.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
      if (!d) return { found: false, shareText: (document.body.innerText.match(/share[^\\n]{0,80}/i) || [null])[0] };
      const b = d.getBoundingClientRect(); const s = getComputedStyle(d);
      const text = d.innerText || '';
      const tiles = [...d.querySelectorAll('button,a,[role=button],[class*=tile],[class*=target]')]
        .filter(e => e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().width < 200)
        .map(e => { const tb = e.getBoundingClientRect(); return { label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16), box: Math.round(tb.width) + 'x' + Math.round(tb.height) }; }).slice(0, 14);
      const linkField = d.querySelector('input,[class*=link],[class*=url]');
      const copyBtn = [...d.querySelectorAll('button,[role=button]')].find(e => /copy/i.test(e.getAttribute('aria-label') || e.textContent || ''));
      const cb = copyBtn ? copyBtn.getBoundingClientRect() : null;
      const cs = copyBtn ? getComputedStyle(copyBtn) : null;
      const startAt = /start at/i.test(text);
      return { found: true, cls: d.className.toString().slice(0, 60),
        box: Math.round(b.width) + 'x' + Math.round(b.height), radius: s.borderRadius, shadow: s.boxShadow.slice(0, 80),
        header: (d.querySelector('h1,h2,h3,[class*=header],[class*=title]')?.textContent || '').slice(0, 24),
        tiles, tileCount: tiles.length, embedFirst: /embed/i.test((tiles[0]?.label || '')),
        linkValue: linkField ? (linkField.value || '').slice(0, 60) : null,
        linkRaw: (text.match(/[a-z0-9-]+\\.[a-z]{2,}[^\\s]{0,50}/i) || [null])[0],
        copyPill: cb ? { box: Math.round(cb.width) + 'x' + Math.round(cb.height), radius: cs.borderRadius } : null,
        startAt, hasToast: /copied/i.test(document.body.innerText),
        socialTargets: (text.match(/(whatsapp|telegram|messenger|facebook|reddit|pinterest|linkedin|email|x\\b|embed)/gi) || []) };
    })()`);
    await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-share-modal.png`));
    // if Copy exists, click it and watch for the toast (N26)
    const copied = await evalJS(`(() => {
      const e = [...document.querySelectorAll('button,[role=button]')].find(e => /copy/i.test(e.getAttribute('aria-label') || e.textContent || ''));
      if (!e) return false; e.click(); return true;
    })()`);
    if (copied) {
      await sleep(700);
      report.checks.copyToast = await evalJS(`(() => ({
        toastText: (document.body.innerText.match(/copied[^\\n]{0,40}/i) || [null])[0],
        snackbar: !!document.querySelector('[class*=toast],[class*=snackbar],[role=status],[aria-live]'),
      }))()`);
      await ab("screenshot", resolve(`evidence/r28-recon/verifications/${TAG}-share-toast.png`));
    }
  }
}

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`SPEC -> ${OUT}`);
console.log(JSON.stringify({
  themeDefault: report.checks.themeDefault,
  hover: report.checks.hover,
  comments: report.checks.comments,
  shareDialog: report.checks.shareDialog,
  copyToast: report.checks.copyToast,
}, null, 1).slice(0, 3000));
