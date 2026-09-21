/**
 * @wfx/app-web — the R24-E playback-telemetry RETENTION store (the
 * server side of the shared performance contract).
 *
 * The running product's client surfaces flush their in-page startup
 * traces here (POST /api/playback/telemetry) so the benchmark harness
 * and the journeys can read REAL observations from the RUNNING product
 * over HTTP — the record's retention seam (the lab rule: raw
 * observations are retained, never pre-aggregated away).
 *
 * VALIDATION LAW: every flushed marker id is validated against the
 * shared contract's frozen vocabulary (`isPlaybackStartupMarker`) — a
 * marker outside the contract is a typed rejection, never a silently
 * stored string. This store keeps the contract's shape verbatim; the
 * metric derivations (percentiles, deltas) live in the contract.
 *
 * Scope honesty: an in-memory per-boot store (the same class of
 * session-scoped state the queue store uses — dev-boot retention for
 * the live harness, not a durable analytics pipeline; production
 * retention is the service-mode lane's concern, never this module's
 * claim).
 */

import {
  isPlaybackStartupMarker,
  type PlaybackStartupMarker,
  type PlaybackStartupTrace,
} from "@wfx/client-runtime";

/** The flushed trace payload (the client recorder's snapshot shape). */
export interface PlaybackTraceFlushInput {
  readonly traceId?: unknown;
  readonly itemId?: unknown;
  readonly realization?: unknown;
  readonly fromPlayClick?: unknown;
  readonly markers?: unknown;
}

/** The typed store outcome (never a silent failure). */
export type TraceStoreOutcome =
  | { readonly ok: true; readonly stored: number }
  | { readonly ok: false; readonly reason: string };

/** The retained traces (per boot, in insertion order). */
const retained: PlaybackStartupTrace[] = [];

/**
 * Validate + store one flushed trace. The contract's vocabulary is the
 * gate: markers outside the frozen union are rejected with the typed
 * reason (a benchmark never measures vocabulary drift silently).
 */
export function storePlaybackTrace(input: PlaybackTraceFlushInput): TraceStoreOutcome {
  if (typeof input.traceId !== "string" || input.traceId.length === 0) {
    return { ok: false, reason: "traceId: expected a non-empty string" };
  }
  if (typeof input.itemId !== "string" || input.itemId.length === 0) {
    return { ok: false, reason: "itemId: expected a non-empty string" };
  }
  if (!Array.isArray(input.markers)) {
    return { ok: false, reason: "markers: expected an array" };
  }
  const markers: PlaybackStartupMarker[] = [];
  for (const raw of input.markers) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, reason: "markers[]: expected objects" };
    }
    const candidate = raw as { marker?: unknown; offsetMs?: unknown; detail?: unknown };
    if (!isPlaybackStartupMarker(candidate.marker)) {
      return {
        ok: false,
        reason: `markers[].marker: '${String(candidate.marker)}' is not in the frozen R24-E vocabulary`,
      };
    }
    if (
      typeof candidate.offsetMs !== "number" ||
      !Number.isFinite(candidate.offsetMs) ||
      candidate.offsetMs < 0
    ) {
      return { ok: false, reason: "markers[].offsetMs: expected a finite non-negative number" };
    }
    markers.push({
      marker: candidate.marker,
      offsetMs: candidate.offsetMs,
      ...(typeof candidate.detail === "string" && candidate.detail.length > 0
        ? { detail: candidate.detail }
        : {}),
    });
  }
  // The contract's ingest law: markers sorted by offset within the trace.
  markers.sort((a, b) => a.offsetMs - b.offsetMs);
  const trace: PlaybackStartupTrace = {
    traceId: input.traceId,
    itemId: input.itemId,
    ...(typeof input.realization === "string" && input.realization.length > 0
      ? { realization: input.realization }
      : {}),
    markers,
  };
  // One trace per id (a re-flush of the same trace replaces it — the
  // later flush carries the superset of markers).
  const existing = retained.findIndex((candidate) => candidate.traceId === trace.traceId);
  if (existing >= 0) {
    retained[existing] = trace;
  } else {
    retained.push(trace);
  }
  return { ok: true, stored: markers.length };
}

/** The retained traces (optionally filtered by item). */
export function retainedPlaybackTraces(itemId?: string): readonly PlaybackStartupTrace[] {
  return itemId === undefined
    ? [...retained]
    : retained.filter((trace) => trace.itemId === itemId);
}

/** Reset the store (the harness's between-passes determinism seam). */
export function resetPlaybackTelemetryStore(): void {
  retained.length = 0;
}
