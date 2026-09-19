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
 * The transpiled set stays PURE TypeScript — no native or Node-only
 * dependencies enter the web app's PRODUCTION closure (postgres drivers
 * and the like belong to the service lanes, never to this host). R07 adds
 * the shared runtime + platform contracts (the adapter's layering law).
 *
 * `serverExternalPackages` (R20-D): the DEV-ONLY BYOF fixtures host
 * (`src/host/byof/byof-fixtures.ts` — reachable ONLY through the 050
 * environment law's `WFX_DEV_FIXTURES=1` boot, and loaded through a
 * dynamic import the service-mode path never evaluates) composes the
 * REAL shared BYOF surface: `@wfx/persistence`'s FeedImportService over
 * PGlite plus `@wfx/connectors`' real YouTube connector. Those packages
 * and their Node-native dependencies (PGlite's WASM Postgres, the
 * postgres.js driver, and the persistence package's `import.meta.url`-
 * resolved migrations directory) must NOT be bundled by Turbopack —
 * they are required natively at runtime (the documented `bun run dev`
 * boot runs on Bun, which requires TypeScript workspace sources
 * natively). Service mode never loads this path: the production closure
 * stays as pure as before (the honesty law — a fixture is never silently
 * presented as production capability).
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
  // The dev-only BYOF fixtures composition (R20-D): the REAL shared
  // service + connector + PGlite, required natively instead of bundled
  // (see the module doc — fixtures mode only; service mode never loads it).
  serverExternalPackages: [
    "@wfx/persistence",
    "@wfx/connectors",
    "@electric-sql/pglite",
    "postgres",
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
