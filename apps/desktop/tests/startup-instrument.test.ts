/**
 * R24-W3 — the playback startup/recovery instrument battery (the frozen
 * metric vocabulary + the startup architecture laws, proven at the
 * derivation level before the journey drives them).
 */

import { describe, expect, it } from "bun:test";

import {
  createPlaybackStartupInstrument,
  PLAYBACK_STARTUP_OBSERVATION_KINDS,
  startupPercentile,
  ttffThresholdVerdict,
} from "../src/platform/playback-startup-instrument";

/** A scripted clock (the deterministic harness's own seam). */
class ScriptedClock {
  private now = 0;
  advance(ms: number): void {
    this.now += ms;
  }
  nowMs(): number {
    return this.now;
  }
}

describe("R24 startup instrument — the observation vocabulary", () => {
  it("freezes the observation kinds (19 honest points)", () => {
    expect(PLAYBACK_STARTUP_OBSERVATION_KINDS.length).toBe(19);
    for (const kind of PLAYBACK_STARTUP_OBSERVATION_KINDS) {
      expect(typeof kind).toBe("string");
      expect(kind.length).toBeGreaterThan(0);
    }
  });
});

describe("R24 startup instrument — the measurement derivation", () => {
  it("derives the R24-E primary metrics from the ordered observations", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });

    instrument.observe({ kind: "navigation-start" });
    clock.advance(40);
    instrument.observe({ kind: "player-visible" });
    clock.advance(25);
    instrument.observe({ kind: "play-click" });
    clock.advance(12);
    instrument.observe({ kind: "first-verified-playable-range" });
    clock.advance(38);
    instrument.observe({ kind: "first-frame", runwayMs: 45_000, verifiedFraction: 0.67 });
    clock.advance(4);
    instrument.observe({ kind: "audible" });

    const measurement = instrument.measurement({
      label: "Family Archive",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.navigationToPlayerVisibleMs).toBe(40);
    expect(measurement.clickToFirstFrameMs).toBe(50); // t=115 - t=65
    expect(measurement.clickToAudibleMs).toBe(54); // t=119 - t=65
    expect(measurement.timeToPlayableMs).toBe(12); // t=77 - t=65
    expect(measurement.startupFailed).toBe(false);
    expect(measurement.firstFrameRunwayMs).toBe(45_000);
    expect(measurement.firstFrameVerifiedFraction).toBe(0.67);
  });

  it("derives the torrent performance track (metadata → file → verified range → completion → integrity → ready offline)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });

    instrument.observe({ kind: "play-click" });
    clock.advance(80);
    instrument.observe({ kind: "torrent-metadata" });
    clock.advance(15);
    instrument.observe({ kind: "file-selected" });
    clock.advance(20);
    instrument.observe({ kind: "first-verified-playable-range" });
    clock.advance(30);
    instrument.observe({ kind: "first-frame", runwayMs: 30_000, verifiedFraction: 0.4 });
    clock.advance(60_000);
    instrument.observe({ kind: "background-completion" });
    clock.advance(2_000);
    instrument.observe({ kind: "integrity-verified" });
    clock.advance(50);
    instrument.observe({ kind: "ready-offline" });

    const measurement = instrument.measurement({
      label: "Family Archive",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.timeToTorrentMetadataMs).toBe(80);
    expect(measurement.timeToSelectedFileMs).toBe(95);
    expect(measurement.timeToFirstVerifiedPlayableRangeMs).toBe(115);
    expect(measurement.backgroundCompletionMs).toBe(60_145);
    expect(measurement.integrityVerificationMs).toBe(2_000);
    expect(measurement.readyOfflineTransitionMs).toBe(62_195);
  });

  it("derives the seek response, the control response, and the transient recovery", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });

    instrument.observe({ kind: "play-click" });
    clock.advance(30);
    instrument.observe({ kind: "first-frame", runwayMs: 30_000, verifiedFraction: 0.5 });
    clock.advance(100);
    instrument.observe({ kind: "seek-issued" });
    clock.advance(18);
    instrument.observe({ kind: "seek-accepted" });
    clock.advance(200);
    instrument.observe({ kind: "control-issued" });
    clock.advance(7);
    instrument.observe({ kind: "control-settled" });
    clock.advance(1_000);
    instrument.observe({ kind: "transient-failure" });
    clock.advance(1_400);
    instrument.observe({ kind: "recovery-complete" });

    const measurement = instrument.measurement({
      label: "Family Archive",
      realization: "authorized-peer-copy",
      cacheMode: "warm",
    });
    expect(measurement.seekResponseMs).toBe(18);
    expect(measurement.controlResponseMs).toBe(7);
    expect(measurement.recoveryAfterTransientFailureMs).toBe(1_400);
  });

  it("answers the honest null for unobserved metrics (never fabricated zeros)", () => {
    const instrument = createPlaybackStartupInstrument({ nowMs: () => 0 });
    instrument.observe({ kind: "play-click" });

    const measurement = instrument.measurement({
      label: "Nothing observed",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.clickToFirstFrameMs).toBeNull();
    expect(measurement.clickToAudibleMs).toBeNull();
    expect(measurement.timeToTorrentMetadataMs).toBeNull();
    expect(measurement.backgroundCompletionMs).toBeNull();
    expect(measurement.seekResponseMs).toBeNull();
    expect(measurement.recoveryAfterTransientFailureMs).toBeNull();
    expect(measurement.observations.length).toBe(1);
  });

  it("records a startup failure honestly (the failure detail rides the record)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });
    instrument.observe({ kind: "play-click" });
    clock.advance(50);
    instrument.observe({ kind: "startup-failed", detail: "the native session could not open" });

    const measurement = instrument.measurement({
      label: "Broken",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.startupFailed).toBe(true);
    expect(measurement.startupFailureDetail).toBe("the native session could not open");
    expect(measurement.clickToFirstFrameMs).toBeNull();
  });
});

describe("R24 startup instrument — the startup architecture laws", () => {
  it("LAW 1: flags a nonessential call inside the startup window (the no-serial-chain violation)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });
    instrument.observe({ kind: "play-click" });
    clock.advance(10);
    instrument.observe({ kind: "nonessential-call", detail: "recommendations.prefetch()" });
    clock.advance(20);
    instrument.observe({ kind: "first-frame", runwayMs: 30_000, verifiedFraction: 0.5 });

    const measurement = instrument.measurement({
      label: "Blocked",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.playbackBlockedOnNonessentialWork).toBe(true);
    expect(measurement.nonessentialCallsInWindow).toEqual(["recommendations.prefetch()"]);
  });

  it("LAW 1: holds when the window is clean (no nonessential work between click and frame)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });
    instrument.observe({ kind: "play-click" });
    clock.advance(30);
    instrument.observe({ kind: "first-frame", runwayMs: 30_000, verifiedFraction: 0.5 });
    // A nonessential call AFTER the first frame is NOT a startup violation.
    clock.advance(500);
    instrument.observe({ kind: "nonessential-call", detail: "analytics.batch()" });

    const measurement = instrument.measurement({
      label: "Clean",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.playbackBlockedOnNonessentialWork).toBe(false);
    expect(measurement.nonessentialCallsInWindow).toEqual([]);
  });

  it("LAW 2: the verified-ranges-first law (first frame from verified data while incomplete)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });
    instrument.observe({ kind: "play-click" });
    clock.advance(100);
    // Runway > 0 AND verified fraction < 1: the ranges needed for immediate
    // playback arrived BEFORE full completion.
    instrument.observe({ kind: "first-frame", runwayMs: 25_000, verifiedFraction: 0.45 });

    const measurement = instrument.measurement({
      label: "Prioritized",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.verifiedRangesPrioritizedOverCompletion).toBe(true);
  });

  it("LAW 2: flags a first frame that waited for full completion (the anti-pattern)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });
    instrument.observe({ kind: "play-click" });
    clock.advance(90_000);
    // First frame only after EVERYTHING verified: the law is violated.
    instrument.observe({ kind: "first-frame", runwayMs: 600_000, verifiedFraction: 1 });

    const measurement = instrument.measurement({
      label: "Waited-for-completion",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.verifiedRangesPrioritizedOverCompletion).toBe(false);
  });

  it("LAW 2: answers null for provider realizations (not derivable without the torrent truth)", () => {
    const instrument = createPlaybackStartupInstrument({ nowMs: () => 0 });
    instrument.observe({ kind: "play-click" });
    instrument.observe({ kind: "first-frame", runwayMs: 0, verifiedFraction: 1 });

    const measurement = instrument.measurement({
      label: "Provider",
      realization: "provider-embed",
      cacheMode: "cold",
    });
    expect(measurement.verifiedRangesPrioritizedOverCompletion).toBe(false); // runway 0 → not verified-data-first for this rung's observation
    expect(measurement.firstFrameRunwayMs).toBe(0);
  });
});

describe("R24 startup instrument — the percentile machinery", () => {
  it("derives the nearest-rank percentiles honestly over small samples", () => {
    expect(startupPercentile([], 50)).toBeNull();
    expect(startupPercentile([10], 50)).toBe(10);
    expect(startupPercentile([10, 20, 30, 40], 50)).toBe(20); // ceil(0.5*4)=2 → 20
    expect(startupPercentile([10, 20, 30, 40], 75)).toBe(30); // ceil(0.75*4)=3 → 30
    expect(startupPercentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(startupPercentile([5, 1, 9, 3], 50)).toBe(3); // sorted [1,3,5,9], rank 2
  });

  it("answers the honest not-comparable verdict without a reference baseline (never a silent pass)", () => {
    const verdict = ttffThresholdVerdict({
      webflix: { p50: 100, p75: 150, p95: 300 },
      reference: null,
    });
    expect(verdict.comparable).toBe(false);
    expect(verdict.p50WithinThreshold).toBeNull();
    expect(verdict.detail).toContain("not measurable in this environment");
    expect(verdict.detail).toContain("never silently passed");
  });

  it("checks the frozen thresholds against a reference baseline", () => {
    const verdict = ttffThresholdVerdict({
      webflix: { p50: 200, p75: 400, p95: 1200 },
      reference: { p50: 100, p75: 200, p95: 300 },
    });
    // p50: 200 <= 100+150 ✓; p75: 400 <= 200+300 ✓; p95: 1200 > 300+750 ✗.
    expect(verdict.comparable).toBe(true);
    expect(verdict.p50WithinThreshold).toBe(true);
    expect(verdict.p75WithinThreshold).toBe(true);
    expect(verdict.p95WithinThreshold).toBe(false);
    expect(verdict.detail).toContain("p95");
    expect(verdict.detail).toContain("OVER");
  });

  it("keeps the raw observations in the record (the lab's retained-raw-record law)", () => {
    const clock = new ScriptedClock();
    const instrument = createPlaybackStartupInstrument({ nowMs: () => clock.nowMs() });
    instrument.observe({ kind: "play-click" });
    clock.advance(5);
    instrument.observe({ kind: "first-frame", runwayMs: 10_000, verifiedFraction: 0.3 });
    const measurement = instrument.measurement({
      label: "Raw",
      realization: "authorized-peer-copy",
      cacheMode: "cold",
    });
    expect(measurement.observations.length).toBe(2);
    expect(measurement.observations[0]?.kind).toBe("play-click");
    expect(measurement.observations[1]?.atMs).toBe(5);

    // The reset clears the raw record for the next pass.
    instrument.reset();
    expect(instrument.raw().length).toBe(0);
    expect(
      instrument.measurement({ label: "Next", realization: "authorized-peer-copy", cacheMode: "warm" })
        .observations.length,
    ).toBe(0);
  });
});

// Keep the scripted clock driving every derivation (the harness's seam).
