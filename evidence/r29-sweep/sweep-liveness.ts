#!/usr/bin/env bun
// R29 PRODUCTION SWEEP — PROBE 0: LIVENESS + SERVED-CSS MARKERS (the merge proof).
// Every check runs against https://webflix-steel.vercel.app (production, never a
// local build). The markers prove the MERGED set is live: --wfx-pill-bg #0009
// (the lead's b10e0aa ruling 0.8 -> 0.6), the nine canonical D16/F4 token
// families, and the shorts-shelf 208px track geometry (N20).
// Usage: bun evidence/r29-sweep/sweep-liveness.ts <base>

const BASE = process.argv[2] ?? "https://webflix-steel.vercel.app";
const OUT = "evidence/r29-sweep/probes/liveness.json";

type Rec = Record<string, unknown>;
const report: { tag: string; base: string; at: string; checks: Rec } = {
  tag: "prod-webflix-steel",
  base: BASE,
  at: new Date().toISOString(),
  checks: {},
};

// ── 1. liveness: HTTP 200 on / ──────────────────────────────────────────────
const homeRes = await fetch(`${BASE}/`, { redirect: "follow" });
const homeHtml = await homeRes.text();
report.checks.liveness = {
  status: homeRes.status,
  finalUrl: homeRes.url,
  bytes: homeHtml.length,
  server: homeRes.headers.get("server"),
  xVercelId: homeRes.headers.get("x-vercel-id"),
};

// ── 2. extract + fetch the served immutable CSS ────────────────────────────
const cssHref = homeHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1] ?? null;
report.checks.servedCss = { href: cssHref };
if (cssHref) {
  const cssUrl = new URL(cssHref, BASE).toString();
  const cssRes = await fetch(cssUrl);
  const css = await cssRes.text();
  report.checks.servedCss = { href: cssHref, url: cssUrl, status: cssRes.status, bytes: css.length,
    cacheControl: cssRes.headers.get("cache-control"), etag: cssRes.headers.get("etag") };

  // ── 3. THE MERGE PROOF: --wfx-pill-bg #0009 (0.6 alpha — the b10e0aa ruling)
  const pillDecl = [...css.matchAll(/--wfx-pill-bg\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
  report.checks.pillBgRuling = {
    declarations: pillDecl,
    isHex0009: pillDecl.every(v => v === "#0009"),
    is000cAnywhere: /--wfx-pill-bg\s*:\s*#000c/.test(css),
  };

  // ── 4. the nine canonical token families (D16/F4) ────────────────────────
  const TOKENS = [
    "--wfx-border-hairline", "--wfx-pill-bg", "--wfx-pill-fg", "--wfx-scrollbar-thumb",
    "--wfx-toast-bg", "--wfx-toast-fg", "--wfx-chrome-scrim", "--wfx-chrome-fg",
    "--wfx-stage-black",
  ] as const;
  const tokenDecls: Rec = {};
  for (const t of TOKENS) {
    tokenDecls[t] = [...css.matchAll(new RegExp(t.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;}]+)", "g"))].map(m => m[1].trim());
  }
  report.checks.canonicalTokens = {
    declarations: tokenDecls,
    allNineDeclared: TOKENS.every(t => Array.isArray(tokenDecls[t]) && (tokenDecls[t] as string[]).length >= 2),
  };

  // ── 5. the shorts-shelf geometry (N20): 208px tracks ─────────────────────
  const shortsRule = css.match(/\.wfx-row__scroller--shorts\{[^}]+\}/)?.[0] ?? null;
  report.checks.shortsGeometry = {
    rule: shortsRule,
    autoColumns208: !!shortsRule && /grid-auto-columns:\s*208px/.test(shortsRule),
    flowColumn: !!shortsRule && /grid-auto-flow:\s*column/.test(shortsRule),
    gap4: !!shortsRule && /gap:\s*4px/.test(shortsRule),
  };

  // ── 6. the recorded out-of-scope 0.8 literals (context, not defects) ─────
  report.checks.residual000cContexts = [...css.matchAll(/([^{}]{0,80}#000c[^{}]{0,40})/g)].map(m => m[1].trim());
}

// ── 7. the served-HTML theme seam (O6-meta): meta + inline script, pre-body ─
report.checks.themeSeam = {
  hasThemedMeta: /<meta[^>]+data-wfx-theme-color[^>]*>/i.test(homeHtml),
  metaTag: homeHtml.match(/<meta[^>]+name="theme-color"[^>]*>/i)?.[0] ?? null,
  seamScriptInline: /<script[^>]*>[^<]*localStorage[^<]*wfx-theme[^<]*<\/script>/i.test(homeHtml),
  metaBeforeBody: homeHtml.indexOf("data-wfx-theme-color") >= 0 && homeHtml.indexOf("data-wfx-theme-color") < homeHtml.indexOf("<body"),
};

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`LIVENESS PROBE -> ${OUT}`);
console.log(JSON.stringify({ liveness: report.checks.liveness, pillBgRuling: report.checks.pillBgRuling,
  allNine: (report.checks.canonicalTokens as Rec)["allNineDeclared"], shortsGeometry: report.checks.shortsGeometry,
  themeSeam: report.checks.themeSeam }, null, 1));
