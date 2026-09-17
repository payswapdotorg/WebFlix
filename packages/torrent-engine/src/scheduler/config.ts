/**
 * @wfx/torrent-engine — the playback scheduler configuration (R12).
 *
 * THE CONFIG SURFACE (the dispatch's law: "plain typed config with
 * validation, no hidden magic"): exactly the three knobs the deadline
 * mapping needs —
 *
 * - `startupTargetSeconds`  — how many seconds of media the startup window
 *   must have verified before first paint is honest (first-paint fast).
 * - `steadyRunwaySeconds`   — how many seconds of verified runway ahead of
 *   the playhead the steady state tries to maintain.
 * - `seekBurstPieces`       — how many pieces to burst around a seek target
 *   at critical urgency so the player can paint after a seek.
 *
 * Every value is validated (finite, positive, sane-integer where pieces are
 * counted) and every default is exported. There are NO hidden heuristics:
 * the scheduler consumes exactly these numbers, nothing inferred, nothing
 * smoothed, nothing invented.
 */

import { torrentError, type TorrentResult } from "../errors";

// ---------------------------------------------------------------------------
// The config type
// ---------------------------------------------------------------------------

/** The playback scheduler's complete, validated configuration. */
export interface PlaybackSchedulerConfig {
  /**
   * The startup window's size in seconds of playback: the scheduler
   * prioritizes the pieces covering `[position, position + velocity *
   * startupTargetSeconds)` until they are verified. Finite number > 0.
   * Default: 8.
   */
  readonly startupTargetSeconds: number;
  /**
   * The steady-state runway target in seconds of playback ahead of the
   * playhead. Finite number > 0. Default: 30.
   */
  readonly steadyRunwaySeconds: number;
  /**
   * The seek burst size in PIECES (seek targets are byte offsets; the
   * burst is naturally piece-quantized — BitTorrent's atomic unit). Safe
   * integer >= 1. Default: 8.
   */
  readonly seekBurstPieces: number;
}

/** A partial scheduler config: omitted fields fall back to validated defaults. */
export type PlaybackSchedulerConfigInput = Partial<PlaybackSchedulerConfig>;

/** The validated defaults (exported for tests, docs, and telemetry). */
export const DEFAULT_PLAYBACK_SCHEDULER_CONFIG: PlaybackSchedulerConfig = {
  startupTargetSeconds: 8,
  steadyRunwaySeconds: 30,
  seekBurstPieces: 8,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a playback scheduler config. Accepts a COMPLETE config, a
 * PARTIAL one (missing fields fall back to {@link DEFAULT_PLAYBACK_SCHEDULER_CONFIG}),
 * or `undefined` (the pure defaults). Returns a fresh, fully-populated copy
 * or a typed `INVALID_INPUT` rejection — never a silent default for a
 * value that was present but malformed.
 */
export function validatePlaybackSchedulerConfig(
  config: PlaybackSchedulerConfigInput | undefined,
): TorrentResult<PlaybackSchedulerConfig> {
  if (config === undefined) {
    return { ok: true, value: { ...DEFAULT_PLAYBACK_SCHEDULER_CONFIG } };
  }
  if (typeof config !== "object" || config === null) {
    return torrentError("INVALID_INPUT", {
      detail: "validatePlaybackSchedulerConfig: config must be an object or undefined",
    });
  }
  const startupRaw = config.startupTargetSeconds ?? DEFAULT_PLAYBACK_SCHEDULER_CONFIG.startupTargetSeconds;
  if (typeof startupRaw !== "number" || !Number.isFinite(startupRaw) || startupRaw <= 0) {
    return torrentError("INVALID_INPUT", {
      detail: `validatePlaybackSchedulerConfig: startupTargetSeconds must be a finite number > 0 (got ${String(config.startupTargetSeconds)})`,
    });
  }
  const runwayRaw = config.steadyRunwaySeconds ?? DEFAULT_PLAYBACK_SCHEDULER_CONFIG.steadyRunwaySeconds;
  if (typeof runwayRaw !== "number" || !Number.isFinite(runwayRaw) || runwayRaw <= 0) {
    return torrentError("INVALID_INPUT", {
      detail: `validatePlaybackSchedulerConfig: steadyRunwaySeconds must be a finite number > 0 (got ${String(config.steadyRunwaySeconds)})`,
    });
  }
  const burstRaw = config.seekBurstPieces ?? DEFAULT_PLAYBACK_SCHEDULER_CONFIG.seekBurstPieces;
  if (typeof burstRaw !== "number" || !Number.isSafeInteger(burstRaw) || burstRaw < 1) {
    return torrentError("INVALID_INPUT", {
      detail: `validatePlaybackSchedulerConfig: seekBurstPieces must be a safe integer >= 1 (got ${String(config.seekBurstPieces)})`,
    });
  }
  return {
    ok: true,
    value: {
      startupTargetSeconds: startupRaw,
      steadyRunwaySeconds: runwayRaw,
      seekBurstPieces: burstRaw,
    },
  };
}
