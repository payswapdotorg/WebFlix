/**
 * R25-W3 — the translated-audio output mixer's laws (the plan's desktop
 * lane: native output mixing + translated-audio buffering + drift).
 *
 * Proven here (machine-checked):
 * - THE MODE LAW: original-audio keeps the original at full gain with the
 *   translated stream muted; translated-speech ducks (never erases) the
 *   original and plays the due chunks; the switch is instant + lossless
 *   (the buffer survives a round trip).
 * - THE CONSERVATIVE DEFAULT: a fresh mixer starts in original-audio —
 *   nothing about playback changes until the user opts in.
 * - THE JITTER BUFFER: chunks play keyed by their SOURCE position at the
 *   playhead's pace; a late-but-recent chunk still plays (the lookback).
 * - THE BUFFER BOUND: a translated stream running far ahead drops
 *   oldest-first with the honest count (never silent, never unbounded).
 * - THE DRIFT LAW: drift is MEASURED (rendered − playhead); a stale
 *   buffer beyond tolerance is dropped whole with the correction's
 *   magnitude recorded — the source timeline is never rewritten.
 * - THE GAPS LAW: a step with no due chunk answers original-carries (the
 *   original at FULL gain — never silence) and the gap is counted with
 *   its real duration once it closes.
 * - MALFORMED CHUNKS never enter the buffer (the honest refusal).
 */

import { describe, expect, it } from "bun:test";

import {
  createTranslatedAudioOutputMixer,
  type TranslatedAudioChunkInput,
} from "../src/platform/translated-audio-output";

// ---------------------------------------------------------------------------
// The deterministic world
// ---------------------------------------------------------------------------

function makeClock(startMs = 0): { readonly nowMs: () => number; readonly advanceTo: (ms: number) => void } {
  let t = startMs;
  return { nowMs: (): number => t, advanceTo: (ms: number): void => { t = ms; } };
}

function chunk(positionMs: number, durationMs = 1_000, bytes = 16): TranslatedAudioChunkInput {
  return {
    positionMs,
    durationMs,
    samples: new Uint8Array(bytes),
    arrivedAtMs: 0,
  };
}

describe("R25-W3 — the translated-audio output mixer", () => {
  it("THE CONSERVATIVE DEFAULT — a fresh mixer answers original-audio (playback unchanged until opt-in)", () => {
    const mixer = createTranslatedAudioOutputMixer({ nowMs: makeClock().nowMs });
    const decision = mixer.step(0);
    expect(decision.mode).toBe("original-audio");
    expect(decision.originalGain).toBe(1);
    expect(decision.translatedChunk).toBeNull();
    expect(decision.continuity).toBe("original-only");
    expect(mixer.report().mode).toBe("original-audio");
  });

  it("THE MODE LAW — translated speech ducks the original (never erases) and plays the due chunks", () => {
    const mixer = createTranslatedAudioOutputMixer({ nowMs: makeClock().nowMs, duckGain: 0.25 });
    mixer.setMode("translated-speech");
    mixer.offer(chunk(0, 1_000));
    mixer.offer(chunk(1_000, 1_000));

    const first = mixer.step(0);
    expect(first.mode).toBe("translated-speech");
    expect(first.originalGain).toBe(0.25);
    expect(first.translatedChunk?.positionMs).toBe(0);
    expect(first.continuity).toBe("translated");

    const second = mixer.step(1_000);
    expect(second.translatedChunk?.positionMs).toBe(1_000);
    expect(second.originalGain).toBe(0.25);

    // The ducked original is still PRESENT (the mode law: available).
    expect(second.originalGain).toBeGreaterThan(0);
    expect(mixer.report().playedChunks).toBe(2);
  });

  it("THE MODE SWITCH is instant + lossless — the buffer survives a round trip", () => {
    const mixer = createTranslatedAudioOutputMixer({ nowMs: makeClock().nowMs });
    mixer.offer(chunk(0, 1_000));
    mixer.offer(chunk(1_000, 1_000));
    mixer.setMode("translated-speech");
    expect(mixer.step(0).translatedChunk?.positionMs).toBe(0);

    // Switch to original: the translated stream mutes; the original is full.
    mixer.setMode("original-audio");
    const original = mixer.step(1_000);
    expect(original.originalGain).toBe(1);
    expect(original.translatedChunk).toBeNull();

    // Switch back: the REMAINING buffered chunk resumes (no re-fetch).
    mixer.setMode("translated-speech");
    const back = mixer.step(1_000);
    expect(back.translatedChunk?.positionMs).toBe(1_000);
    expect(mixer.report().modeSwitches).toBe(3);
    expect(mixer.report().playedChunks).toBe(2);
  });

  it("THE LOOKBACK — a chunk slightly behind the playhead still plays (the provider paced it late)", () => {
    const mixer = createTranslatedAudioOutputMixer({ nowMs: makeClock().nowMs, dueLookbackMs: 400 });
    mixer.setMode("translated-speech");
    mixer.offer(chunk(1_000, 500));
    const late = mixer.step(1_300);
    expect(late.translatedChunk?.positionMs).toBe(1_000);
    // Far behind the lookback: it no longer plays.
    mixer.offer(chunk(5_000, 500));
    const stale = mixer.step(90_000);
    expect(stale.translatedChunk).toBeNull();
  });

  it("THE BUFFER BOUND — a stream running far ahead drops oldest-first with the honest count", () => {
    const mixer = createTranslatedAudioOutputMixer({
      nowMs: makeClock().nowMs,
      bufferBoundMs: 10_000,
    });
    mixer.setMode("translated-speech");
    // The provider races ahead: 20 chunks × 1s = 20s ahead of the tail.
    for (let i = 0; i < 20; i += 1) {
      mixer.offer(chunk(i * 1_000, 1_000));
    }
    const report = mixer.report();
    expect(report.acceptedChunks).toBe(20);
    // The bound holds ~10s: the oldest chunks were dropped.
    expect(report.droppedByBufferBound).toBeGreaterThan(0);
    expect(report.bufferedChunks).toBeLessThan(20);
    // The playhead catches up and plays the SURVIVING newest chunks.
    const decision = mixer.step(18_000);
    expect(decision.translatedChunk).not.toBeNull();
  });

  it("THE DRIFT LAW — drift is measured; a stale buffer is dropped whole with the magnitude recorded", () => {
    const mixer = createTranslatedAudioOutputMixer({
      nowMs: makeClock().nowMs,
      driftToleranceMs: 2_500,
    });
    mixer.setMode("translated-speech");
    mixer.offer(chunk(0, 1_000));
    mixer.offer(chunk(1_000, 1_000));

    // Playhead far ahead of the rendered stream: the whole buffer is stale.
    const decision = mixer.step(60_000);
    expect(decision.translatedChunk).toBeNull();
    expect(decision.continuity).toBe("original-carries");
    const report = mixer.report();
    expect(report.droppedByDrift).toBe(2);
    expect(report.driftCorrections.count).toBe(1);
    expect(report.driftCorrections.lastMagnitudeMs).toBe(58_000); // 60_000 − (1_000 + 1_000)
    expect(report.bufferedChunks).toBe(0);
    // The drift was MEASURED before the drop (rendered − playhead).
    expect(report.lastDriftMs).toBe(-58_000);
  });

  it("THE GAPS LAW — a step with no due chunk answers original-carries at FULL gain (never silence)", () => {
    const clock = makeClock(1_000);
    const mixer = createTranslatedAudioOutputMixer({ nowMs: clock.nowMs });
    mixer.setMode("translated-speech");

    // No chunks at all: the original carries the moment at full gain.
    const gap = mixer.step(0);
    expect(gap.continuity).toBe("original-carries");
    expect(gap.originalGain).toBe(1);
    expect(gap.translatedChunk).toBeNull();

    // The gap is counted with its REAL duration once it closes.
    clock.advanceTo(2_500);
    mixer.offer(chunk(0, 500));
    const resumed = mixer.step(0);
    expect(resumed.continuity).toBe("translated");
    const report = mixer.report();
    expect(report.continuityGaps.count).toBe(1);
    expect(report.continuityGaps.totalMs).toBe(1_500);
  });

  it("MALFORMED CHUNKS never enter the buffer (the honest refusal)", () => {
    const mixer = createTranslatedAudioOutputMixer({ nowMs: makeClock().nowMs });
    mixer.setMode("translated-speech");
    mixer.offer({ positionMs: Number.NaN, durationMs: 1_000, samples: new Uint8Array(4), arrivedAtMs: 0 });
    mixer.offer({ positionMs: -1, durationMs: 1_000, samples: new Uint8Array(4), arrivedAtMs: 0 });
    mixer.offer({ positionMs: 0, durationMs: 0, samples: new Uint8Array(4), arrivedAtMs: 0 });
    mixer.offer({ positionMs: 0, durationMs: 1_000, samples: new Uint8Array(0), arrivedAtMs: 0 });
    mixer.offer(null as unknown as TranslatedAudioChunkInput);
    const report = mixer.report();
    expect(report.acceptedChunks).toBe(0);
    expect(report.bufferedChunks).toBe(0);
  });

  it("a garbage playhead answers the honest original-only decision (total over garbage)", () => {
    const mixer = createTranslatedAudioOutputMixer({ nowMs: makeClock().nowMs });
    mixer.setMode("translated-speech");
    mixer.offer(chunk(0, 1_000));
    const decision = mixer.step(Number.NaN);
    expect(decision.continuity).toBe("original-only");
    expect(decision.originalGain).toBe(0.25); // the mode's duck still applies
    expect(decision.translatedChunk).toBeNull();
  });

  it("the accounting is complete and honest (every chunk is accounted exactly once)", () => {
    const clock = makeClock(0);
    const mixer = createTranslatedAudioOutputMixer({ nowMs: clock.nowMs, bufferBoundMs: 5_000 });
    mixer.setMode("translated-speech");
    for (let i = 0; i < 8; i += 1) {
      mixer.offer(chunk(i * 1_000, 1_000));
    }
    // Positions 0..7_000 (span 7s): the 5s bound drops the 2 oldest.
    const report1 = mixer.report();
    expect(report1.acceptedChunks).toBe(8);
    expect(report1.droppedByBufferBound).toBe(2);
    expect(report1.bufferedChunks).toBe(6);
    // The playhead reaches the surviving chunks and plays two of them.
    mixer.step(2_000);
    mixer.step(3_000);
    const report2 = mixer.report();
    expect(report2.playedChunks).toBe(2);
    // Every chunk: played + buffered + dropped = accepted.
    expect(report2.playedChunks + report2.bufferedChunks + report2.droppedByBufferBound + report2.droppedByDrift).toBe(
      report2.acceptedChunks,
    );
  });
});
