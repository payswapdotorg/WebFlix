/**
 * @wfx/app-api — the Experience API service host configuration (WFX-055A).
 *
 * The service-lane twin of `apps/web/next.config.ts`: a plain App Router
 * application with ONLY route handlers (no pages, no components), no custom
 * bundler plugins, no exotic output — Vercel-compatible by default (see
 * WFX-055B's DEPLOYMENT.md for the project settings).
 *
 * `transpilePackages`: the @wfx/* workspace packages ship TypeScript
 * sources (their package `main` is `src/index.ts` — the repo compiles
 * nothing ahead of time by design), so the app build transpiles them.
 *
 * Unlike the web host, this service DOES pull `@wfx/persistence` (and with
 * it postgres.js + the Neon pooled client) and `@wfx/connectors` (the
 * WFX-054 YouTube connector) into its server closure — that is precisely
 * the point of the split-runtime service lane: the drivers live in the
 * SERVICE, never in the web host.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@wfx/domain",
    "@wfx/experience",
    "@wfx/connectors",
    "@wfx/persistence",
  ],
};

export default nextConfig;
