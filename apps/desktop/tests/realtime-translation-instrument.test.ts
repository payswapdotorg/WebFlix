/**
 * R25-W3 — the realtime translation latency instrument's discipline (the
 * plan's R25-L measures — the R24 clock-seam/null-absence laws).
 *
 * Proven here (machine-checked):
 * - THE NULL-ABSENCE LAW: every measure stays null until its observation
 *   exists — never zero, never fabricated.
 * - THE REAL-CLOCK LAW: every measure is a REAL delta the injected clock
 *   observed between two honest points (the derivation checks ordering).
 * - THE CLOSED VOCABULARY: the observation kinds are the frozen fifteen.
 * - THE RESET LAW: reset clears the raw record; the next pass measures
 *   afresh.
 */

import { describe, expect, it } from "bun:test";

import {
  createRealtimeTranslationInstrument,
  realtimePercentile,
  REALTIME_TRANSLATION_OBSERVATION_KINDS,
} from "../src/platform/realtime-translation-instrument";

function measurementWorld() {
  let t = 1_000;
  const instrument = createRealtimeTranslationInstrument({ nowMs: (): number => t });
  const advanceTo = (ms: number): void => {
    t = ms;
  };
  return { instrument, advanceTo };
}

const INPUT = {
  label: "instrument-law",
  realization: "authorized-torrent",
  targetLanguage: "en",
  outputModalities: "text+audio" as const,
  translatedAudioChunks: 0,
  capturedAudioFrames: 0,
  visualFramesAppended: 0,
};

describe("R25-W3 — the realtime translation instrument (R25-L)", () => {
  it("THE NULL-ABSENCE LAW — every measure stays null until observed (never zero theater)", () => {
    const { instrument } = measurementWorld();
    instrument.observe({ kind: "translation-start-requested" });
    const measurement = instrument.measurement(INPUT);
    expect(measurement.firstTranscriptDeltaMs).toBeNull();
    expect(measurement.firstTranslationDeltaMs).toBeNull();
    expect(measurement.firstTranslatedSpeechChunkMs).toBeNull();
    expect(measurement.stableSegmentMs).toBeNull();
    expect(measurement.speakerAttributionObserved).toBe(false);
    expect(measurement.reconnectTimeMs).toBeNull();
    expect(measurement.audioContinuity.gaps).toBe(0);
    expect(measurement.audioContinuity.totalGapMs).toBe(0);
    expect(measurement.driftMs).toBeNull();
    expect(measurement.translationFailed).toBe(false);
  });

  it("THE REAL-CLOCK LAW — every measure is a real observed delta", () => {
    const { instrument, advanceTo } = measurementWorld();
    instrument.observe({ kind: "translation-start-requested" });
    advanceTo(1_200);
    instrument.observe({ kind: "first-transcript-delta" });
    advanceTo(1_450);
    instrument.observe({ kind: "first-translation-delta" });
    advanceTo(1_800);
    instrument.observe({ kind: "first-translated-audio-chunk" });
    advanceTo(2_600);
    instrument.observe({ kind: "first-stable-segment" });
    advanceTo(3_100);
    instrument.observe({ kind: "speaker-attribution-observed" });
    advanceTo(9_000);
    instrument.observe({ kind: "translation-interruption", detail: "drop" });
    advanceTo(9_750);
    instrument.observe({ kind: "reconnected" });

    const measurement = instrument.measurement(INPUT);
    expect(measurement.firstTranscriptDeltaMs).toBe(200);
    expect(measurement.firstTranslationDeltaMs).toBe(450);
    expect(measurement.firstTranslatedSpeechChunkMs).toBe(800);
    expect(measurement.stableSegmentMs).toBe(1_600);
    expect(measurement.speakerAttributionObserved).toBe(true);
    expect(measurement.reconnectTimeMs).toBe(750);
  });

  it("the continuity gaps + drift ride their observations with the real magnitudes", () => {
    const { instrument } = measurementWorld();
    instrument.observe({ kind: "translation-start-requested" });
    instrument.observe({ kind: "audio-continuity-gap", gapMs: 1_400 });
    instrument.observe({ kind: "audio-continuity-gap", gapMs: 600 });
    instrument.observe({ kind: "drift-observed", driftMs: -250 });
    instrument.observe({ kind: "drift-observed", driftMs: 120 });
    instrument.observe({ kind: "drift-correction", magnitudeMs: 250 });
    const measurement = instrument.measurement(INPUT);
    expect(measurement.audioContinuity.gaps).toBe(2);
    expect(measurement.audioContinuity.totalGapMs).toBe(2_000);
    expect(measurement.driftMs).toBe(120); // the LAST observed drift
    expect(measurement.driftCorrections).toBe(1);
  });

  it("the failure truth carries the honest detail", () => {
    const { instrument } = measurementWorld();
    instrument.observe({ kind: "translation-start-requested" });
    instrument.observe({ kind: "translation-failed", detail: "the attempts were exhausted" });
    const measurement = instrument.measurement(INPUT);
    expect(measurement.translationFailed).toBe(true);
    expect(measurement.translationFailureDetail).toBe("the attempts were exhausted");
  });

  it("THE CLOSED VOCABULARY — the observation kinds are the frozen fifteen", () => {
    expect(REALTIME_TRANSLATION_OBSERVATION_KINDS.length).toBe(15);
    for (const kind of REALTIME_TRANSLATION_OBSERVATION_KINDS) {
      expect(typeof kind).toBe("string");
    }
    expect(REALTIME_TRANSLATION_OBSERVATION_KINDS.includes("first-transcript-delta")).toBe(true);
    expect(REALTIME_TRANSLATION_OBSERVATION_KINDS.includes("reconnected")).toBe(true);
    expect(REALTIME_TRANSLATION_OBSERVATION_KINDS.includes("drift-correction")).toBe(true);
  });

  it("THE RESET LAW — reset clears the raw record; the next pass measures afresh", () => {
    const { instrument, advanceTo } = measurementWorld();
    instrument.observe({ kind: "translation-start-requested" });
    advanceTo(1_500);
    instrument.observe({ kind: "first-transcript-delta" });
    expect(instrument.measurement(INPUT).firstTranscriptDeltaMs).toBe(500);
    instrument.reset();
    expect(instrument.raw().length).toBe(0);
    const fresh = instrument.measurement(INPUT);
    expect(fresh.firstTranscriptDeltaMs).toBeNull();
  });

  it("the percentile derivation is honest over small samples (nearest-rank, null over none)", () => {
    expect(realtimePercentile([], 50)).toBeNull();
    expect(realtimePercentile([300], 50)).toBe(300);
    expect(realtimePercentile([300, 500, 100, 200], 50)).toBe(200);
    expect(realtimePercentile([300, 500, 100, 200], 95)).toBe(500);
  });
});
