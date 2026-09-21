/**
 * @wfx/app-web — the R24-E playback-startup TELEMETRY recorder (the
 * client-side seam of the shared performance contract).
 *
 * THE LAW THIS MODULE SERVES (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md — R24-E; J41):
 * "Videos should load just as easily as YouTube" is a MEASURED release
 * requirement — the real startup path must be INSTRUMENTED with the
 * shared contract's typed marker vocabulary so Web and Desktop traces
 * mean the same thing.
 *
 * THE DESIGN (honest clocks, one trace origin):
 * - Every marker records `performance.now()` offsets from ONE trace
 *   origin, monotonic within the trace (the contract's law).
 * - The trace origin is the PLAY INTENT when the navigation came from a
 *   real play click (the item page's Play link / a Where-to-watch "Play
 *   this way" switch): the click page records the intent epoch (wall
 *   clock) in sessionStorage; the player page's boot script bridges the
 *   two documents (`originSkewMs = timeOriginEpoch − clickEpoch`) and
 *   rebases every in-page marker onto the click origin. The wall-clock
 *   bridge sets ONLY the origin — within-trace ordering stays
 *   `performance.now()`-monotonic.
 * - A direct navigation (no stored intent) anchors the trace at the
 *   page's own navigation start (`originSkewMs = 0`); such a trace
 *   honestly carries NO `play-clicked` marker (nothing fabricated).
 * - The in-page trace lives at `window.__wfxPlaybackTelemetry` (the
 *   harness reads it from the LIVE page) and is flushed to
 *   `/api/playback/telemetry` for retention (the server store validates
 *   every marker id against the frozen contract vocabulary).
 *
 * WHAT THIS MODULE IS NOT: a collector that invents observations. It
 * records events the REAL product surfaces emit — the stage observer
 * attaches to the real stage elements, the chrome wraps the real
 * command round trips, the boot script runs in the real streamed HTML.
 * A benchmark passing through synthetic fixture behavior is an R24
 * rejection; nothing here synthesizes a marker.
 */

import type { PlaybackStartupMarkerId } from "@wfx/client-runtime";

/** The sessionStorage key carrying the recorded play intent (one-shot). */
export const PLAY_INTENT_STORAGE_KEY = "wfx-play-intent";

/** One recorded play intent (written by the item/card surfaces' recorder). */
export interface PlayIntentRecord {
  /** The click's wall-clock epoch (Date.now() at the click). */
  readonly epochMs: number;
  /** The intent's href (the player navigation the click starts). */
  readonly href: string;
  /** The intent's target item id (the trace's item binding). */
  readonly itemId: string;
  /** The realization switch the intent carries ("embed"/"browser"/"authorized-peer-copy"). */
  readonly realization?: string;
}

/** One recorded marker (the contract's shape, JSON-serializable). */
export interface RecordedPlaybackMarker {
  readonly marker: PlaybackStartupMarkerId;
  readonly offsetMs: number;
  readonly detail?: string;
}

/** The in-page trace (the harness's read surface + the flush payload). */
export interface InPagePlaybackTrace {
  readonly traceId: string;
  readonly itemId: string;
  readonly realization: string;
  /**
   * The trace-origin rebase (ms): the play-click epoch minus this page's
   * navigation origin. 0 when the trace anchors at the navigation.
   */
  readonly originSkewMs: number;
  readonly markers: RecordedPlaybackMarker[];
  /** Whether the play-clicked marker was recorded (a real click intent). */
  readonly fromPlayClick: boolean;
}

/** The architecture-law observations (NOT contract markers — the R24-E
 * startup-law evidence the harness compares: the enrichment sections'
 * mount times vs the first frame). */
export interface StartupLawObservations {
  readonly enrichmentMountedAtMs: Record<string, number>;
}

declare global {
  interface Window {
    __wfxPlaybackTelemetry?: InPagePlaybackTrace;
    __wfxStartupObservations?: StartupLawObservations;
  }
}

/** The current trace (created on demand; the boot script owns creation). */
export function currentPlaybackTrace(): InPagePlaybackTrace | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__wfxPlaybackTelemetry;
}

/**
 * Record one marker into the live trace (offsets rebased onto the trace
 * origin). A trace that was never initialized records nothing — the
 * boot script owns the trace lifecycle (never a stray window global).
 */
export function recordPlaybackMarker(
  marker: PlaybackStartupMarkerId,
  detail?: string,
): void {
  if (typeof window === "undefined") return;
  const trace = window.__wfxPlaybackTelemetry;
  if (trace === undefined) return;
  const offsetMs = performance.now() + trace.originSkewMs;
  trace.markers.push({
    marker,
    offsetMs,
    ...(detail !== undefined ? { detail } : {}),
  });
}

/** Record the play intent (the click page's side — one-shot sessionStorage). */
export function recordPlayIntent(intent: PlayIntentRecord): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(PLAY_INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Storage refused (private mode quotas): the next page anchors its
    // trace at the navigation — an honest narrower trace, never an error.
  }
}

/** The stored play intent, if any (consumed one-shot by the boot script). */
export function takePlayIntent(): PlayIntentRecord | null {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLAY_INTENT_STORAGE_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(PLAY_INTENT_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<PlayIntentRecord>;
    if (
      typeof parsed.epochMs !== "number" ||
      typeof parsed.href !== "string" ||
      typeof parsed.itemId !== "string"
    ) {
      return null;
    }
    return {
      epochMs: parsed.epochMs,
      href: parsed.href,
      itemId: parsed.itemId,
      ...(typeof parsed.realization === "string" ? { realization: parsed.realization } : {}),
    };
  } catch {
    return null;
  }
}

/** The trace's flush payload (the server store's POST shape). */
export interface PlaybackTraceFlush {
  readonly traceId: string;
  readonly itemId: string;
  readonly realization: string;
  readonly fromPlayClick: boolean;
  readonly markers: readonly RecordedPlaybackMarker[];
}

/** The trace snapshot for retention (what the server stores). */
export function playbackTraceSnapshot(): PlaybackTraceFlush | null {
  if (typeof window === "undefined") return null;
  const trace = window.__wfxPlaybackTelemetry;
  if (trace === undefined) return null;
  return {
    traceId: trace.traceId,
    itemId: trace.itemId,
    realization: trace.realization,
    fromPlayClick: trace.fromPlayClick,
    markers: [...trace.markers],
  };
}

/** Flush the trace to the retention store (best-effort, never blocking). */
export function flushPlaybackTrace(): void {
  if (typeof window === "undefined") return;
  const snapshot = playbackTraceSnapshot();
  if (snapshot === null || snapshot.markers.length === 0) return;
  try {
    void fetch("/api/playback/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Retention is best-effort; the in-page trace remains readable.
  }
}

/**
 * Observe an enrichment section's mount (the startup-law evidence: the
 * nonessential sections' arrival times vs the first frame — the
 * architecture law measured, not asserted).
 */
export function recordEnrichmentMount(sectionId: string): void {
  if (typeof window === "undefined") return;
  const trace = window.__wfxPlaybackTelemetry;
  const offsetMs = performance.now() + (trace?.originSkewMs ?? 0);
  const observations = (window.__wfxStartupObservations ?? { enrichmentMountedAtMs: {} });
  observations.enrichmentMountedAtMs[sectionId] = offsetMs;
  window.__wfxStartupObservations = observations;
}
