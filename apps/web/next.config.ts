/**
 * @wfx/app-web — the Next.js host configuration (WFX-050; WFX-057 headers).
 *
 * Minimal and standard: a plain App Router application, no custom
 * bundler plugins, no exotic output — Vercel-compatible by default
 * (see DEPLOYMENT.md for the WFX-056 project settings).
 *
 * `transpilePackages`: the @wfx/* workspace packages ship TypeScript
 * sources (their package `main` is `src/index.ts` — the repo compiles
 * nothing ahead of time by design), so the app build transpiles them.
 * All of them are pure TypeScript — no native or Node-only dependencies
 * enter the web app's closure (postgres drivers and the like belong to
 * the service lanes, never to this host). R07 adds the shared runtime +
 * platform contracts (the adapter's layering law).
 *
 * WFX-057 `headers`: the service worker file must never sit in a stale
 * HTTP cache — the browser re-fetches `/sw.js` on navigations and the
 * update flow depends on seeing the current bytes. `no-store` keeps
 * update detection prompt (the visible-update law).
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@wfx/domain",
    "@wfx/experience",
    "@wfx/native-media",
    "@wfx/client-runtime",
    "@wfx/platform-contracts",
  ],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
