/**
 * @wfx/experience — the Experience API shell (WFX-005, Lane C).
 *
 * The source-neutral use-case layer of the Experience Core: TypeScript types
 * + pure orchestration logic + fixtures ONLY. No UI components, no provider
 * connectors, no persistence — every external effect is an injected PORT
 * (`ports.ts`). The frozen contracts come exclusively from `@wfx/domain`.
 *
 * Public surface:
 * - `ports.ts`             — ConnectorPort / EventSink / Clock / IdGen /
 *                            Ports, the ExperienceResult convention, the
 *                            typed ExperienceError misuse channel
 * - `use-cases/feed.ts`    — source-neutral watch/short feeds
 * - `use-cases/playback.ts`— playback sessions + progress mirroring
 * - `use-cases/library.ts` — connector-side library access
 * - `use-cases/actions.ts` — user actions + engagement event mirrors
 * - `fixtures.ts`          — deterministic test fixtures (never production)
 * - `createExperienceApi`  — convenience facade bundling the use-cases with
 *                            one shared in-memory PlaybackSessionStore
 */

export * from "./ports";
export * from "./use-cases/events";
export * from "./use-cases/feed";
export * from "./use-cases/playback";
export * from "./use-cases/library";
export * from "./use-cases/actions";
export * from "./fixtures";

import type {
  ActionReceipt,
  LibraryEntry,
  PlaybackSession,
} from "@wfx/domain";

import type {
  ExperienceContext,
  ExperienceResult,
  Ports,
} from "./ports";
import type { FeedPage, FeedRequest } from "./use-cases/feed";
import type { PlaybackIntent, PlaybackReport } from "./use-cases/playback";
import { PlaybackSessionStore, reportComplete, reportProgress, reportSkip, startPlayback } from "./use-cases/playback";
import type { RemoveFromLibraryInput, SaveToLibraryInput } from "./use-cases/library";
import { getLibrary, removeFromLibrary, saveToLibrary } from "./use-cases/library";
import type { ActionRequest } from "./use-cases/actions";
import { runUserAction } from "./use-cases/actions";
import { getFeed } from "./use-cases/feed";

/**
 * The bundled Experience API: every use-case pre-bound to one `Ports` bundle
 * and one shared in-memory `PlaybackSessionStore` (start → progress →
 * complete/skip report on the same session map without any wiring).
 */
export interface ExperienceApi {
  /** Assemble one source-neutral feed page (empty page on unsupported/empty/failed search). */
  getFeed(ctx: ExperienceContext, request: FeedRequest): Promise<FeedPage>;
  /** Start playback (resolve via the port or accept a chosen realization); emits the `"start"` event. */
  startPlayback(ctx: ExperienceContext, intent: PlaybackIntent): Promise<ExperienceResult<PlaybackSession>>;
  /** Report progress on a session started through this API; emits `"progress"`. */
  reportProgress(ctx: ExperienceContext, report: PlaybackReport): Promise<ExperienceResult<PlaybackSession>>;
  /** Report completion on a session started through this API; emits `"complete"`. */
  reportComplete(ctx: ExperienceContext, report: PlaybackReport): Promise<ExperienceResult<PlaybackSession>>;
  /** Report a skip on a session started through this API; emits `"skip"`. */
  reportSkip(ctx: ExperienceContext, report: PlaybackReport): Promise<ExperienceResult<PlaybackSession>>;
  /** Read a playback session from this API's store (undefined when unknown). */
  getPlaybackSession(sessionId: string): PlaybackSession | undefined;
  /** Read the connector-side library (typed unsupported when the capability is missing). */
  getLibrary(ctx: ExperienceContext): Promise<ExperienceResult<LibraryEntry[]>>;
  /** Save an external item to the connector-side library. */
  saveToLibrary(ctx: ExperienceContext, input: SaveToLibraryInput): Promise<ExperienceResult<ActionReceipt>>;
  /** Remove an external item from the connector-side library. */
  removeFromLibrary(ctx: ExperienceContext, input: RemoveFromLibraryInput): Promise<ExperienceResult<ActionReceipt>>;
  /** Execute a user action; mirrors confirmed like/save actions as engagement events. */
  runUserAction(ctx: ExperienceContext, action: ActionRequest): Promise<ExperienceResult<ActionReceipt>>;
}

/**
 * Build the bundled Experience API facade. The playback session store is
 * created here and shared by the playback methods; everything else is a thin
 * pre-bound call into the pure use-cases (which remain usable standalone
 * with their own store).
 */
export function createExperienceApi(ports: Ports): ExperienceApi {
  const sessions = new PlaybackSessionStore();
  return {
    getFeed: (ctx, request) => getFeed(ports, ctx, request),
    startPlayback: (ctx, intent) => startPlayback(ports, ctx, intent, sessions),
    reportProgress: (ctx, report) => reportProgress(ports, ctx, report, sessions),
    reportComplete: (ctx, report) => reportComplete(ports, ctx, report, sessions),
    reportSkip: (ctx, report) => reportSkip(ports, ctx, report, sessions),
    getPlaybackSession: (sessionId) => sessions.get(sessionId),
    getLibrary: (ctx) => getLibrary(ports, ctx),
    saveToLibrary: (ctx, input) => saveToLibrary(ports, ctx, input),
    removeFromLibrary: (ctx, input) => removeFromLibrary(ports, ctx, input),
    runUserAction: (ctx, action) => runUserAction(ports, ctx, action),
  };
}
