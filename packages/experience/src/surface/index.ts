/**
 * @wfx/experience — Media Surface resolver (WFX-025, Lane C).
 *
 * The pure decision engine of the frozen Media Surface: TypeScript types +
 * pure logic + fixtures ONLY — no browser embedding, no players, no UI, no
 * new runtime dependencies. Built ON the merged Lane-C work (WFX-005
 * Experience API shell, WFX-002 device capabilities) via `@wfx/domain` and
 * this package's own modules — nothing outside `src/surface/` is touched.
 *
 * - `request.ts`         — `SurfaceRequest` / `SurfacePermissions` /
 *                          `SurfaceRealization` + container validation
 * - `resolve.ts`         — `resolveSurface`: THE frozen precedence
 *                          (Native -> Embed -> Browser -> External) with
 *                          capability, permission, availability, expiry, and
 *                          codec-demand gates, plus the auditable
 *                          `precedenceTrace` and typed `unresolvable`
 * - `session-builder.ts` — `buildPlaybackSession`: frozen `PlaybackSession`
 *                          from a successful resolution (injected clock only)
 * - `matrix.ts`          — device profiles + `capabilityMatrix()` for tests
 *                          and WFX-043 release acceptance
 * - `fixtures.ts`        — deterministic test fixtures (never production)
 */

export * from "./request";
export * from "./resolve";
export * from "./session-builder";
export * from "./matrix";
export * from "./fixtures";
