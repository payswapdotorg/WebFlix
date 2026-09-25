#!/usr/bin/env bun
// R29 PRODUCTION SWEEP — CAPTURES @1440x900, BOTH themes. Light = the default
// boot; dark = flipped via the R29 gear's Appearance subpage (dogfooding the
// merged seam). Shot list: home, search (the filters dialog open on the light
// shot), player (watch), shorts, library, settings.
// Usage: bun evidence/r29-sweep/sweep-captures.ts <base>

import { $ } from "bun";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "https://webflix-steel.vercel.app";
const DIR = resolve("evidence/r29-sweep");

const ab = async (...args: (string | number)[]): Promise<string> => {
  const p = await $`agent-browser ${args.map(String)}`.nothrow().quiet();
  return p.stdout.toString().trim();
};
const evalJS = async (js: string): Promise<unknown> => {
  const out = await ab("eval", js);
  try { return JSON.parse(out); } catch { return out; }
};
const open = async (url: string) => { await ab("open", url); await ab("wait", "--load", "networkidle").catch(() => {}); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const shot = (name: string) => ab("screenshot", resolve(`${DIR}/${name}`));

await ab("set", "viewport", 1440, 900);
const log: string[] = [];

// fresh boot state (light default, no residue)
await ab("open", BASE + "/");
await evalJS(`localStorage.removeItem('wfx-theme'); sessionStorage.removeItem('wfx-miniplayer'); 'clean'`);
await sleep(1200);

// ═══ LIGHT (the default boot) ═════════════════════════════════════════════
await open(`${BASE}/`);
await sleep(2200);
await shot("home.light.png"); log.push("home.light.png");
const themeLight = await evalJS(`document.documentElement.getAttribute('data-theme')`);
console.log("light boot theme:", themeLight);

// search with the FILTERS DIALOG OPEN (the task's one dialog shot)
await open(`${BASE}/search?q=the`);
await sleep(2400);
await evalJS(`document.querySelector('[data-wfx-search-filters]')?.setAttribute('data-r29s-f', '1'); 'ok'`);
await ab("click", "[data-r29s-f='1']");
await sleep(1400);
await shot("search.light.png"); log.push("search.light.png (filters dialog OPEN)");
await evalJS(`document.querySelector('[data-wfx-filters-close]')?.setAttribute('data-r29s-c', '1'); 'ok'`);
await ab("click", "[data-r29s-c='1']");
await sleep(800);

// a plain light search shot (for the vs-search composite)
await sleep(600);
await shot("search-results.light.png"); log.push("search-results.light.png (plain, for the composite)");

// the watch/player surface (the first card's /player link)
await open(`${BASE}/`);
await sleep(1800);
const watchHref = await evalJS(`document.querySelector('main a[href*="/player"]')?.getAttribute('href') ?? null`);
const watchUrl = watchHref ? (String(watchHref).startsWith("http") ? String(watchHref) : BASE + String(watchHref)) : `${BASE}/player`;
await open(watchUrl);
await sleep(3500);
await shot("player.light.png"); log.push("player.light.png");

// shorts
await open(`${BASE}/shorts`);
await sleep(2600);
await shot("shorts.light.png"); log.push("shorts.light.png");

// library
await open(`${BASE}/library`);
await sleep(2600);
await shot("library.light.png"); log.push("library.light.png");

// settings
await open(`${BASE}/settings`);
await sleep(2600);
await shot("settings.light.png"); log.push("settings.light.png");

// ═══ DARK — via the R29 gear's Appearance seam (dogfooding the merged set) ═══
await open(`${BASE}/`);
await sleep(2000);
await evalJS(`document.querySelector('[data-wfx-gear-button]')?.setAttribute('data-r29s-gear', '1'); 'ok'`);
await ab("click", "[data-r29s-gear='1']");
await sleep(1100);
await evalJS(`document.querySelector('[data-wfx-gear-item="appearance"]')?.setAttribute('data-r29s-app', '1'); 'ok'`);
await ab("click", "[data-r29s-app='1']");
await sleep(1000);
await evalJS(`document.querySelector('[data-wfx-appearance="dark"]')?.setAttribute('data-r29s-dark', '1'); 'ok'`);
await ab("click", "[data-r29s-dark='1']");
await sleep(1100);
const seamCheck = await evalJS(`(() => ({
  dataTheme: document.documentElement.getAttribute('data-theme'),
  meta: document.querySelector('meta[name=theme-color]')?.content || null,
  stored: localStorage.getItem('wfx-theme') }))()`);
console.log("dark seam flip:", JSON.stringify(seamCheck));
await ab("press", "Escape");
await sleep(700);
await shot("home.dark.png"); log.push("home.dark.png");

// search (plain results, dark)
await open(`${BASE}/search?q=the`);
await sleep(2400);
await shot("search.dark.png"); log.push("search.dark.png");

// player (dark)
await open(watchUrl);
await sleep(3500);
await shot("player.dark.png"); log.push("player.dark.png");

// shorts (dark)
await open(`${BASE}/shorts`);
await sleep(2600);
await shot("shorts.dark.png"); log.push("shorts.dark.png");

// library (dark)
await open(`${BASE}/library`);
await sleep(2600);
await shot("library.dark.png"); log.push("library.dark.png");

// settings (dark)
await open(`${BASE}/settings`);
await sleep(2600);
await shot("settings.dark.png"); log.push("settings.dark.png");

// leave the session at the clean light default
await open(`${BASE}/`);
await evalJS(`localStorage.removeItem('wfx-theme'); 'clean'`);
await sleep(800);

console.log("CAPTURES DONE:");
for (const l of log) console.log("  " + l);
await Bun.write(resolve("evidence/r29-sweep/probes/captures.log"), log.join("\n") + "\n");
