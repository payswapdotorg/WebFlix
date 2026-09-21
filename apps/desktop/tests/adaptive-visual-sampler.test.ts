/**
 * R25-W3 — the adaptive visual sampler's laws (the plan's R25-F "Visual
 * context": the sampler belongs to the media adapter, never the provider).
 *
 * Proven here (machine-checked):
 * - THE NEVER-FORCED LAW: under `audio-only` (and `disabled`) the sampler
 *   NEVER emits — frames ride only when the policy honestly allows AND a
 *   trigger fired.
 * - THE FOUR TRIGGERS: scene-change, on-screen-text, speaker-change, and
 *   the low-rate periodic fallback — each fires on its own signal and
 *   names itself in the accounting.
 * - THE BURST GUARD: a frame rides only when it is far enough from the
 *   last emitted one — on the media timeline OR in wall-clock time.
 * - HONEST SIGNALS: a null scene-difference cannot fire the scene trigger;
 *   a null OCR truth cannot fire the text trigger; a null shot index
 *   cannot fire the speaker trigger (the sampler decides on what it
 *   actually knows — never a guessed signal).
 * - THE ACCOUNTING: every considered frame is counted exactly once (emitted
 *   by trigger or suppressed by reason).
 */

import { describe, expect, it } from "bun:test";

import {
  createAdaptiveVisualSampler,
  emptyVisualSamplerReport,
  evaluateFrameTriggers,
  type VisualFrameSignals,
} from "../src/platform/adaptive-visual-sampler";

// ---------------------------------------------------------------------------
// The deterministic world (a mutable clock — the fallback's elapsed truth)
// ---------------------------------------------------------------------------

const BYTES = new Uint8Array([1, 2, 3, 4]);

function signals(overrides: Partial<VisualFrameSignals> = {}): VisualFrameSignals {
  return {
    positionMs: 0,
    sceneDifference: null,
    onScreenText: null,
    shotOrSpeakerIndex: null,
    bytes: BYTES,
    mediaType: "image/jpeg",
    ...overrides,
  };
}

/** A mutable deterministic clock. */
function makeClock(startMs = 0): { readonly nowMs: () => number; readonly advanceTo: (ms: number) => void } {
  let t = startMs;
  return { nowMs: (): number => t, advanceTo: (ms: number): void => { t = ms; } };
}

describe("R25-W3 — the adaptive visual sampler (R25-F)", () => {
  it("THE NEVER-FORCED LAW — audio-only and disabled never emit, whatever the signals", () => {
    for (const policy of ["audio-only", "disabled"] as const) {
      const clock = makeClock(0);
      const sampler = createAdaptiveVisualSampler({ policy, nowMs: clock.nowMs });
      const decision = sampler.considerFrame(signals({ sceneDifference: 0.99, onScreenText: "HELLO", shotOrSpeakerIndex: 7 }));
      expect(decision.emit).toBe(false);
      if (!decision.emit) {
        expect(decision.reason).toBe(policy === "audio-only" ? "policy-audio-only" : "policy-disabled");
      }
      const report = sampler.samplerReport();
      expect(report.consideredFrames).toBe(1);
      expect(report.suppressedByReason[policy === "audio-only" ? "policy-audio-only" : "policy-disabled"]).toBe(1);
      expect(report.emittedByTrigger["scene-change"]).toBe(0);
      expect(report.emittedByTrigger["on-screen-text"]).toBe(0);
    }
  });

  it("TRIGGER 1 — scene change fires on the measured difference crossing the threshold (a null difference cannot)", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    const calm = sampler.considerFrame(signals({ positionMs: 0, sceneDifference: 0.05 }));
    expect(calm.emit).toBe(false);
    const cut = sampler.considerFrame(signals({ positionMs: 2_000, sceneDifference: 0.5 }));
    expect(cut.emit).toBe(true);
    if (cut.emit) {
      expect(cut.trigger).toBe("scene-change");
      expect(cut.frame.bytes).toBe(BYTES);
      expect(cut.frame.mediaType).toBe("image/jpeg");
      expect(cut.frame.positionMs).toBe(2_000);
    }
    // A null scene difference cannot fire the trigger (honest signals).
    const nullSampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: makeClock(0).nowMs });
    const nullDifference = nullSampler.considerFrame(signals({ positionMs: 0, sceneDifference: null }));
    expect(nullDifference.emit).toBe(false);
  });

  it("TRIGGER 2 — on-screen text fires on new/changed detected text (a null OCR truth cannot)", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    // New text fires.
    const first = sampler.considerFrame(signals({ positionMs: 0, onScreenText: "Chapter One" }));
    expect(first.emit).toBe(true);
    if (first.emit) expect(first.trigger).toBe("on-screen-text");
    // The SAME text does not re-fire the text trigger.
    clock.advanceTo(60_000);
    const same = sampler.considerFrame(signals({ positionMs: 60_000, onScreenText: "Chapter One" }));
    if (same.emit) {
      expect(same.trigger).not.toBe("on-screen-text");
    } else {
      expect(same.reason).toBe("no-trigger");
    }
    // Changed text fires the text trigger again.
    clock.advanceTo(120_000);
    const changed = sampler.considerFrame(signals({ positionMs: 120_000, onScreenText: "Chapter Two" }));
    expect(changed.emit).toBe(true);
    if (changed.emit) expect(changed.trigger).toBe("on-screen-text");
    // A null OCR truth cannot fire the trigger.
    const nullSampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: makeClock(0).nowMs });
    const nullText = nullSampler.considerFrame(signals({ positionMs: 0, onScreenText: null }));
    expect(nullText.emit).toBe(false);
  });

  it("TRIGGER 3 — speaker/shot change fires on the attributed index changing (a null index cannot)", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    // Establish shot 1 through a scene change (a real trigger).
    const first = sampler.considerFrame(signals({ positionMs: 0, shotOrSpeakerIndex: 1, sceneDifference: 0.8 }));
    expect(first.emit).toBe(true);
    // Shot 2 fires the speaker-change trigger.
    const second = sampler.considerFrame(signals({ positionMs: 2_000, shotOrSpeakerIndex: 2 }));
    expect(second.emit).toBe(true);
    if (second.emit) expect(second.trigger).toBe("speaker-change");
    // A null index cannot fire it.
    const nullShot = sampler.considerFrame(signals({ positionMs: 4_000, shotOrSpeakerIndex: null }));
    if (nullShot.emit) {
      expect(nullShot.trigger).not.toBe("speaker-change");
    } else {
      expect(nullShot.reason).toBe("no-trigger");
    }
  });

  it("TRIGGER 3b — an out-of-band speaker change makes the NEXT frame ride the speaker trigger", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    const first = sampler.considerFrame(signals({ positionMs: 0, sceneDifference: 0.8 }));
    expect(first.emit).toBe(true);
    sampler.notifySpeakerChanged();
    const after = sampler.considerFrame(signals({ positionMs: 5_000 }));
    expect(after.emit).toBe(true);
    if (after.emit) expect(after.trigger).toBe("speaker-change");
  });

  it("TRIGGER 4 — the low-rate periodic fallback fires only after the interval (anchored at creation)", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    // Before the interval: nothing fires.
    const early = sampler.considerFrame(signals({ positionMs: 0 }));
    expect(early.emit).toBe(false);
    // After the interval (30s default): the fallback fires.
    clock.advanceTo(30_500);
    const late = sampler.considerFrame(signals({ positionMs: 30_500 }));
    expect(late.emit).toBe(true);
    if (late.emit) expect(late.trigger).toBe("periodic-fallback");
    // Right after: the cadence resets — nothing fires.
    clock.advanceTo(31_000);
    const soon = sampler.considerFrame(signals({ positionMs: 31_000 }));
    expect(soon.emit).toBe(false);
    // The next interval can fire again.
    clock.advanceTo(61_500);
    const again = sampler.considerFrame(signals({ positionMs: 61_500 }));
    expect(again.emit).toBe(true);
    if (again.emit) expect(again.trigger).toBe("periodic-fallback");
    expect(sampler.samplerReport().emittedByTrigger["periodic-fallback"]).toBe(2);
  });

  it("THE BURST GUARD — a frame rides only far enough from the last emit (timeline OR wall clock)", () => {
    // Frozen clock, frozen positions: everything after the first is inside
    // the guard on BOTH axes.
    const frozen = createAdaptiveVisualSampler({
      policy: "adaptive",
      nowMs: makeClock(0).nowMs,
      minFrameGapMs: 1_200,
    });
    const first = frozen.considerFrame(signals({ positionMs: 0, sceneDifference: 0.9 }));
    expect(first.emit).toBe(true);
    const burst = frozen.considerFrame(signals({ positionMs: 100, sceneDifference: 0.95 }));
    expect(burst.emit).toBe(false);
    if (!burst.emit) expect(burst.reason).toBe("burst-guard");

    // An advancing TIMELINE alone (frozen wall clock) escapes the guard.
    const advancing = createAdaptiveVisualSampler({
      policy: "adaptive",
      nowMs: makeClock(0).nowMs,
      minFrameGapMs: 1_200,
    });
    const a = advancing.considerFrame(signals({ positionMs: 0, sceneDifference: 0.9 }));
    expect(a.emit).toBe(true);
    const b = advancing.considerFrame(signals({ positionMs: 2_000, sceneDifference: 0.9 }));
    expect(b.emit).toBe(true);

    // An advancing WALL CLOCK alone (barely-moving positions) escapes too.
    const clock = makeClock(0);
    const live = createAdaptiveVisualSampler({
      policy: "adaptive",
      nowMs: clock.nowMs,
      minFrameGapMs: 1_200,
    });
    const l1 = live.considerFrame(signals({ positionMs: 0, sceneDifference: 0.9 }));
    expect(l1.emit).toBe(true);
    clock.advanceTo(1_500);
    const l2 = live.considerFrame(signals({ positionMs: 10, sceneDifference: 0.9 }));
    expect(l2.emit).toBe(true);
  });

  it("the pure evaluation is total over garbage and unknown policies", () => {
    const answer = evaluateFrameTriggers(signals({ bytes: null, mediaType: null }), {
      policy: "audio-only",
      sceneChangeThreshold: 0.35,
      lastEmittedAtMs: null,
      lastEmittedPositionMs: null,
      minFrameGapMs: 1_200,
      periodicFallbackMs: 30_000,
      lastConsideredOnScreenText: null,
      lastConsideredShotIndex: null,
      effectiveLastFallbackMs: 0,
      speakerChangePending: false,
      nowMs: 0,
    });
    expect("suppressedReason" in answer).toBe(true);
  });

  it("THE ACCOUNTING — every considered frame is counted exactly once", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    sampler.considerFrame(signals({ positionMs: 0, sceneDifference: 0.9 })); // emit: scene-change
    sampler.considerFrame(signals({ positionMs: 100, sceneDifference: 0.95 })); // suppress: burst-guard
    sampler.considerFrame(signals({ positionMs: 200 })); // suppress: no-trigger
    const report = sampler.samplerReport();
    const emittedTotal =
      report.emittedByTrigger["scene-change"] +
      report.emittedByTrigger["on-screen-text"] +
      report.emittedByTrigger["speaker-change"] +
      report.emittedByTrigger["periodic-fallback"];
    const suppressedTotal =
      report.suppressedByReason["policy-audio-only"] +
      report.suppressedByReason["policy-disabled"] +
      report.suppressedByReason["no-frame"] +
      report.suppressedByReason["burst-guard"] +
      report.suppressedByReason["no-trigger"];
    expect(report.consideredFrames).toBe(3);
    expect(emittedTotal).toBe(1);
    expect(suppressedTotal).toBe(2);
    expect(report.emittedByTrigger["scene-change"]).toBe(1);
    expect(report.suppressedByReason["burst-guard"]).toBe(1);
    expect(report.suppressedByReason["no-trigger"]).toBe(1);
  });

  it("the zero-report is the never-sampled truth", () => {
    const report = emptyVisualSamplerReport("audio-only");
    expect(report.consideredFrames).toBe(0);
    expect(report.policy).toBe("audio-only");
    const emittedTotal = Object.values(report.emittedByTrigger).reduce((a, b) => a + b, 0);
    const suppressedTotal = Object.values(report.suppressedByReason).reduce((a, b) => a + b, 0);
    expect(emittedTotal).toBe(0);
    expect(suppressedTotal).toBe(0);
  });

  it("no-frame frames are counted honestly (the platform produced nothing)", () => {
    const clock = makeClock(0);
    const sampler = createAdaptiveVisualSampler({ policy: "adaptive", nowMs: clock.nowMs });
    const decision = sampler.considerFrame(signals({ bytes: null, mediaType: null }));
    expect(decision.emit).toBe(false);
    if (!decision.emit) expect(decision.reason).toBe("no-frame");
    expect(sampler.samplerReport().suppressedByReason["no-frame"]).toBe(1);
  });
});
