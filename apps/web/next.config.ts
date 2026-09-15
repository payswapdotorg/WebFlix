/**
 * @wfx/app-web — the Next.js host configuration (WFX-050).
 *
 * Minimal and standard: a plain App Router application, no custom
 * bundler plugins, no exotic output — Vercel-compatible by default
 * (see DEPLOYMENT.md for the WFX-056 project settings).
 *
 * `transpilePackages`: the @wfx/* workspace packages ship TypeScript
 * sources (their package `main` is `src/index.ts` — the repo compiles
 * nothing ahead of time by design), so the app build transpiles them.
 * All three are pure TypeScript — no native or Node-only dependencies
 * enter the web app's closure (postgres drivers and the like belong to
 * the service lanes, never to this host).
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wfx/domain", "@wfx/experience", "@wfx/native-media"],
};

export default nextConfig;
