/**
 * @wfx/experience — the long-form Watch Feed (WFX-027, Lane C).
 *
 * The client-facing Watch Feed model of the frozen experience mode
 * "Watch Feed: long-form, episodic continuity, resume, quality/audio/subtitle
 * controls" (docs/architecture/webflix-frozen-architecture.md). Framework-
 * neutral core + a thin presenter; a react binding is the DOCUMENTED WIRING
 * in react.ts (react types are not available in this package and the
 * dispatch forbids new dependencies — the WFX-026 note pattern).
 *
 * - `view.ts`        — `WatchFeedView` model: hero (resume-or-start),
 *                      continue-watching row (recency order, resume
 *                      position, completion ratio, realization badge),
 *                      episodic rows, topic rows; every row a typed `FeedRow`
 *                      with a non-empty `reason`; `A11yLabel` on every entry;
 *                      the OS page input (structural mirror of WFX-021's
 *                      `FeedPage` — see the module doc for the
 *                      dependency-honesty rationale)
 * - `continuity.ts`  — the episodic continuity engine (pure): next episode,
 *                      resume points, "New season" markers, the
 *                      `ContinuityCursor`, and binge-chain visibility bounded
 *                      by the attention mode (frozen intent-graph policy
 *                      types); the injected `RelationsPort` seam
 * - `controls.ts`    — `PlaybackControlSet` descriptors: quality tiers /
 *                      audio / subtitle tracks from DECLARED provider data,
 *                      capability-honest (native ⇒ the declared set;
 *                      provider-owned modes ⇒ typed-absent, never greyed-out
 *                      lies)
 * - `resume.ts`      — `planResume` (pure): continue-session vs start-fresh
 *                      vs next-episode by the resume band; emits the exact
 *                      frozen `EntertainmentEvent` the WFX-005 playback
 *                      use-case should fire (typed, not fired)
 * - `presenter.ts`   — `createWatchFeedPresenter(deps)` →
 *                      `build(feedPage, context): WatchFeedView` (row
 *                      ordering policy, resume badge thresholds, typed
 *                      placeholder states, a11y labels, transparency lists)
 * - `react.ts`       — the documented React wiring + the framework-neutral
 *                      element tree (`watchFeedElementTree`)
 *
 * No data fetching, no provider calls, no player embedding: everything is
 * injected data (the frozen "Experience Core" boundary).
 */

export * from "./view";
export * from "./continuity";
export * from "./controls";
export * from "./resume";
export * from "./presenter";
export * from "./react";
