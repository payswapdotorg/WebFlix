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
 *
 * `outputFileTracingIncludes` (added by WFX-055B at deployment): the one
 * deployment-required config — the persistence package reads its migration
 * SQL files from disk at boot, and serverless file tracing needs the
 * explicit include (see the comment at the setting for the live-observed
 * failure it fixes).
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@wfx/domain",
    "@wfx/experience",
    "@wfx/connectors",
    "@wfx/persistence",
  ],
  // WFX-055B (deployment fix, flagged for lead review): the 052 migration
  // runner reads its SQL files from disk at boot (`defaultMigrationsDir()`
  // = `<this module>/../migrations`, `readdirSync` + `readFileSync`), and
  // Next's serverless file tracing cannot statically see those dynamic
  // reads — the first Vercel deployment shipped without the .sql files and
  // EVERY request failed with the typed
  // `MigrationError: could not read migrations directory
  // (/var/task/packages/persistence/migrations): ENOENT` (observed live,
  // 2026-09-16). This is the canonical monorepo fix: trace the migration
  // files into the serverless output at their repo-relative path, for
  // every route (the whole service shares one boot). No application logic
  // changes — packaging only.
  outputFileTracingIncludes: {
    "/**": ["../../packages/persistence/migrations/**"],
  },
};

export default nextConfig;
