#!/usr/bin/env bun
// R29-C STAGE-5 PROBE — B's token claims (D16: the nine surface-scoped
// tokens declared as --wfx-* custom props with the contract's corpus values,
// both themes; the literals replaced by canonical names in the rules) +
// N16 (the duration badge keeps the corpus rgba(0,0,0,0.6) post-token-work).
// Byte-exactness: the computed custom-property strings vs the contract's
// own literals (whitespace-normalized — custom props compute to their
// specified token stream), cross-checked against the SUBJECT's own frozen
// contract file. A check is VERIFIED only when THIS probe reproduces it.
// Usage: bun evidence/r29-recon/r29-s5probe.ts http://localhost:3101 <tag> [worktree]

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
const TAG = process.argv[3] ?? "run";
const WT = process.argv[4] ?? "/home/z/webflix-b";
const OUT = resolve(`evidence/r29-recon/${TAG}.s5probe.json`);

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
const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

await ab("set", "viewport", 1440, 900);
const report: any = { tag: TAG, base: BASE, at: new Date().toISOString(), checks: {} };

// the frozen contract's nine surface-scoped tokens (parity-tokens.ts, R27
// vintage — the same file the subject carries; C re-reads it from the
// subject tree to prove the pair, never from memory)
const CONTRACT_PATH = `${WT}/packages/platform-contracts/src/parity-tokens.ts`;
let contractSrc = "";
try { contractSrc = await Bun.file(CONTRACT_PATH).text(); } catch { report.checks.contractFile = "UNREADABLE"; }
const NINE: Array<{ contractKey: string; cssName: string; dark: string; light: string }> = [
  { contractKey: "hairline", cssName: "--wfx-border-hairline", dark: "hsla(0,100%,100%,.08)", light: "hsl(0,0%,93.3%)" },
  { contractKey: "pill-surface", cssName: "--wfx-pill-bg", dark: "rgba(0,0,0,0.8)", light: "rgba(0,0,0,0.8)" },
  { contractKey: "pill-ink", cssName: "--wfx-pill-fg", dark: "#ffffff", light: "#ffffff" },
  { contractKey: "scrollbar-thumb", cssName: "--wfx-scrollbar-thumb", dark: "hsl(0, 0%, 67%)", light: "hsl(0, 0%, 76%)" },
  { contractKey: "toast-surface", cssName: "--wfx-toast-bg", dark: "#f1f1f1", light: "#0f0f0f" },
  { contractKey: "toast-ink", cssName: "--wfx-toast-fg", dark: "#0f0f0f", light: "#f1f1f1" },
  { contractKey: "chrome-scrim", cssName: "--wfx-chrome-scrim", dark: "rgba(0,0,0,0.74)", light: "rgba(0,0,0,0.74)" },
  { contractKey: "chrome-ink", cssName: "--wfx-chrome-fg", dark: "#ffffff", light: "#ffffff" },
  { contractKey: "stage-black", cssName: "--wfx-stage-black", dark: "#000000", light: "#000000" },
];
// cross-check the hardcoded expectations against the subject's contract file
if (contractSrc) {
  report.checks.contractCrossCheck = NINE.map(t => {
    const block = contractSrc.match(new RegExp(`"${t.contractKey}":\\s*\\{[\\s\\S]*?\\}`))?.[0] ?? "";
    const cssName = block.match(/cssName:\s*"([^"]+)"/)?.[1] ?? null;
    const dark = block.match(/dark:\s*"([^"]+)"/)?.[1] ?? null;
    const light = block.match(/light:\s*"([^"]+)"/)?.[1] ?? null;
    return { key: t.contractKey,
      matchesExpectation: cssName === t.cssName && norm(dark ?? "") === norm(t.dark) && norm(light ?? "") === norm(t.light),
      contractValues: { cssName, dark, light } };
  });
}

// ── the computed token census (both themes) ──────────────────────────────
const readTokens = () => evalJS(`(() => {
  const cs = getComputedStyle(document.documentElement);
  const names = ['--wfx-border-hairline','--wfx-pill-bg','--wfx-pill-fg','--wfx-scrollbar-thumb','--wfx-toast-bg','--wfx-toast-fg','--wfx-chrome-scrim','--wfx-chrome-fg','--wfx-stage-black'];
  const out = {};
  for (const n of names) out[n] = cs.getPropertyValue(n).trim();
  return { tokens: out, dataTheme: document.documentElement.getAttribute('data-theme') };
})()`);

await evalJS(`localStorage.setItem('wfx-theme', 'dark'); 'set'`);
await open(`${BASE}/`);
await sleep(1300);
report.checks.tokensDark = await readTokens();

await evalJS(`localStorage.setItem('wfx-theme', 'light'); 'set'`);
await open(`${BASE}/`);
await sleep(1300);
report.checks.tokensLight = await readTokens();
await shot("s5-tokens-light");

await evalJS(`localStorage.removeItem('wfx-theme'); 'set'`);

// ── the subject's stylesheet (read once — used by both checks below) ────
let css = "";
try { css = await Bun.file(`${WT}/apps/web/src/app/globals.css`).text(); } catch {}

// ── the byte-exact verdict table (TWO levels) ─────────────────────────────
// (a) SOURCE level: the subject's globals.css declares each token with the
//     contract's own literal (whitespace-normalized string equality);
// (b) COMPUTED level: getComputedStyle resolves custom property colors to
//     computed forms ('rgba(0,0,0,0.8)' -> '#000c'), so byte-exactness is
//     proven through the BROWSER'S OWN normalization: a probe element
//     carrying the contract literal must resolve to the identical string.
const cssSource = css || "";
const declOf = (name: string, block: string): string | null => {
  const m = cssSource.match(new RegExp(`${name}:\\s*([^;\\n]+)`, "g"));
  if (!m) return null;
  const inBlock = m.map(s => s.replace(new RegExp(`^${name}:\\s*`), "").trim())
    .filter((_, i) => (block === "dark" ? i === 0 : i === 1));
  return inBlock[0] ?? null;
};
report.checks.tokenVerdicts = NINE.map(t => ({
  name: t.cssName,
  source: {
    dark: { declared: declOf(t.cssName, "dark"), contract: t.dark,
      byteExact: norm(declOf(t.cssName, "dark") ?? "") === norm(t.dark) },
    light: { declared: declOf(t.cssName, "light"), contract: t.light,
      byteExact: norm(declOf(t.cssName, "light") ?? "") === norm(t.light) },
  },
  computed: {
    dark: { resolved: report.checks.tokensDark?.tokens?.[t.cssName] ?? null,
      contractResolved: null, byteExact: null },
    light: { resolved: report.checks.tokensLight?.tokens?.[t.cssName] ?? null,
      contractResolved: null, byteExact: null },
  },
}));

// (b) the computed-level differential — per theme, in the LIVE browser:
//     the browser serializes custom-property values ('#000c') differently
//     from substituted real properties ('rgba(0, 0, 0, 0.8)'), so byte-
//     exactness is proven IN ONE CONTEXT: a probe element carrying
//     background: var(--token) must compute IDENTICALLY to a twin element
//     carrying background: <the contract literal> (the browser's own
//     canonical form — equality is byte-exact by construction).
const runDifferential = async (theme: "dark" | "light") => {
  await evalJS(`localStorage.setItem('wfx-theme', '${theme}'); 'set'`);
  await open(`${BASE}/`);
  await sleep(1300);
  const pairs = NINE.map(t => [t.cssName, theme === "dark" ? t.dark : t.light]);
  const normalized = await evalJS(`(() => {
    const out = {};
    for (const [n, l] of ${JSON.stringify(pairs)}) {
      const a = document.createElement('div');
      const b = document.createElement('div');
      a.style.display = 'none'; b.style.display = 'none';
      a.style.background = 'var(' + n + ')';
      b.style.background = l;
      document.body.appendChild(a); document.body.appendChild(b);
      const ca = getComputedStyle(a).backgroundColor;
      const cb = getComputedStyle(b).backgroundColor;
      out[n] = { tokenComputed: ca, literalComputed: cb, equal: ca === cb && ca !== '' };
      a.remove(); b.remove();
    }
    return out;
  })()`);
  const live = await readTokens();
  return { normalized, liveTokens: live.tokens, dataTheme: live.dataTheme };
};
report.checks.computedDifferential = {
  dark: await runDifferential("dark"),
  light: await runDifferential("light"),
};
for (const v of report.checks.tokenVerdicts) {
  for (const theme of ["dark", "light"] as const) {
    const diff = report.checks.computedDifferential[theme];
    const pair = diff.normalized?.[v.name] ?? {};
    v.computed[theme] = { resolved: diff.liveTokens?.[v.name] ?? null,
      tokenComputed: pair.tokenComputed ?? null, literalComputed: pair.literalComputed ?? null,
      byteExact: pair.equal === true };
  }
}
await evalJS(`localStorage.removeItem('wfx-theme'); 'set'`);

// ── the literals replaced by canonical names (the subject's own CSS) ──────
if (css) {
  const count = (needle: string) => css.split(needle).length - 1;
  report.checks.ruleUsage = {
    scrollbarUsesVar: /background-color:\s*var\(--wfx-scrollbar-thumb\)/.test(css),
    scrimUsesVar: /var\(--wfx-chrome-scrim\)/.test(css),
    chromeInkUsesVar: /var\(--wfx-chrome-fg\)/.test(css),
    badgeBaseUsesVar: /\.wfx-badge\s*{[^}]*var\(--wfx-pill-bg\)/.test(css.replace(/\n/g, " ")),
    toastUsesVar: /var\(--wfx-toast-bg\)/.test(css) && /var\(--wfx-toast-fg\)/.test(css),
    stageUsesVar: /var\(--wfx-stage-black\)/.test(css),
    hairlineUsesVar: /var\(--wfx-border-hairline\)/.test(css),
    literalCounts: {
      scrim074: count("rgba(0, 0, 0, 0.74)"),
      scrollbar67: count("hsl(0, 0%, 67%)"),
      scrollbar76: count("hsl(0, 0%, 76%)"),
      pill08: count("rgba(0, 0, 0, 0.8)"),
      duration06: count("rgba(0, 0, 0, 0.6)"),
    },
  };
}

// ── N16 — the duration badge keeps the corpus 0.6 (post-token-work) ───────
await open(`${BASE}/`);
await sleep(1100);
await ab("scroll", "down", 700);
await sleep(700);
report.checks.badgeAlpha = await evalJS(`(() => {
  const b = document.querySelector('.wfx-badge--duration, main [class*=badge][class*=duration]');
  if (!b) return { found: false };
  const s = getComputedStyle(b);
  return { found: true, text: (b.textContent || '').trim().slice(0, 12),
    bg: s.backgroundColor, font: s.fontSize + '/' + s.fontWeight, color: s.color,
    radius: s.borderRadius, pad: s.padding,
    isCorpus06: s.backgroundColor === 'rgba(0, 0, 0, 0.6)' };
})()`);
await shot("s5-badge-alpha");

await Bun.write(OUT, JSON.stringify(report, null, 2));
console.log(`S5 PROBE -> ${OUT}`);
console.log(JSON.stringify({
  contractCrossCheck: report.checks.contractCrossCheck,
  tokenVerdicts: report.checks.tokenVerdicts,
  ruleUsage: report.checks.ruleUsage,
  badgeAlpha: report.checks.badgeAlpha,
}, null, 1).slice(0, 4200));
