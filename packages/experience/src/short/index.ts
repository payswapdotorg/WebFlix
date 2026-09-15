/**
 * @wfx/experience — the Short Feed (WFX-028, Lane C).
 *
 * The client-facing Short Feed model of the frozen experience mode
 * "Short Feed: vertical, swipe-driven, rapid candidate replacement and
 * session-aware ranking" (docs/architecture/webflix-frozen-architecture.md,
 * "Experience modes"). Framework-neutral core + a thin presenter; a react
 * binding is the DOCUMENTED WIRING in react.ts (react types are not
 * available in this package and the dispatch forbids new dependencies —
 * the WFX-026/027 note pattern).
 *
 * - `card.ts`            — `ShortCard` view model (vertical-first
 *                          orientation law with typed-tailed non-vertical
 *                          items, overlay data, engagement affordances
 *                          mapped to the WFX-005 action inputs, realization
 *                          badge, a11y on every card) + the OS page input
 *                          (structural mirror of WFX-021's short-surface
 *                          `FeedPage` — see the module doc for the
 *                          dependency-honesty rationale)
 * - `stack.ts`           — `ShortFeedStack`: the vertical card stack with
 *                          typed IMMUTABLE operations (`swipeNext`,
 *                          bounded `swipeBack`, `replaceAt`, `insertAhead`),
 *                          each returning the new stack + a typed
 *                          `StackEvent` for the trail
 * - `replacement.ts`     — `planReplacement` (pure): the rapid candidate
 *                          replacement policy (watched/skipped ⇒
 *                          replaceable; unwatched prefetch window ⇒ kept;
 *                          deterministic merge order; the typed plan the
 *                          stack applies)
 * - `session-ranking.ts` — `shouldRerank` (pure): the session-aware
 *                          re-ranking triggers (N swipes / M seconds /
 *                          like-save signal; thresholds from the frozen
 *                          intent-graph policy vocabulary) carrying the
 *                          exact ADDITIVE WFX-011 intent-update inputs and
 *                          the reorder-only, no-below-visibility-demotion
 *                          scope (the attention-policy law)
 * - `events.ts`          — `shortFeedEvents`: the engagement emission
 *                          contract (progress with payload percent,
 *                          complete, skip, like, save, share) — exact frozen
 *                          `EntertainmentEvent`s, sessionId wired, ready for
 *                          the WFX-005 EventSink
 * - `presenter.ts`       — `createShortFeedPresenter(deps)`: the initial
 *                          stack build from an OS page, typed state
 *                          transitions (current card, next card, transition
 *                          reasons), typed placeholder states
 * - `react.ts`           — the documented React wiring + the
 *                          framework-neutral element tree
 *                          (`shortFeedElementTree`)
 *
 * No data fetching, no provider calls, no video rendering, no gesture
 * capture: everything is injected data (the frozen "Experience Core"
 * boundary).
 */

export * from "./card";
export * from "./stack";
export * from "./replacement";
export * from "./session-ranking";
export * from "./events";
export * from "./presenter";
export * from "./react";
