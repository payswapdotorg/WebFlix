/**
 * @wfx/experience — the library/history client (WFX-029, Lane C).
 *
 * The client-facing library + watch-history VIEW MODEL ("My Stuff"):
 * framework-neutral, pure, deterministic. Modules:
 *
 * - `model.ts`      — the typed `LibraryView` sections/rows, badges, source
 *                     icons, a11y labels; the WFX-022 status mirror; the
 *                     WFX-024 download-completion seam; list/title helpers
 * - `history.ts`    — `deriveWatchHistory`: the deterministic fold of the
 *                     frozen event stream + PlaybackSessions into
 *                     per-item `WatchState`
 * - `merge.ts`      — `mergeLibraryViews`: the three-source unification
 *                     (union rows + typed conflict rows, never silently
 *                     dropped, never auto-resolved)
 * - `commands.ts`   — `planLibraryCommand`: the optimistic UI MODEL for
 *                     save/remove/move-to-list (WFX-005 use-case call plan,
 *                     WFX-022 outbox entry preview with idempotency-key
 *                     mirror, rollback plan per terminal outbox state) —
 *                     NO mutation
 * - `presenter.ts`  — `createLibraryPresenter`: assembles the LibraryView
 *                     (section ordering policy, empty-section suppression,
 *                     typed placeholder states, a11y labels on every row).
 *                     A react binding is intentionally absent: react types
 *                     are not available in this package and the dispatch
 *                     forbids new dependencies.
 *
 * No persistence, no network, no provider calls: everything is a pure view
 * model over injected data. See each module's doc for its laws.
 */

export * from "./model";
export * from "./history";
export * from "./merge";
export * from "./commands";
export * from "./presenter";
