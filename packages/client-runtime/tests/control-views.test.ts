/**
 * @wfx/client-runtime — the contextual control view tests (R21-C).
 *
 * The pure projection laws:
 * - the Personalize view: active intents (scope labels + temporary
 *   expiry), the attention mode + label, the policy dials, and the full
 *   feedback-control vocabulary (immediate + reversible);
 * - the feed-mode choice view: every mode present (discoverable, never
 *   hidden), availability truth with recovery hints for the unavailable;
 * - the realization choice view: the active mode sentence + alternates
 *   with capability truth (an unusable native mode names the Desktop
 *   next step — never a dead end);
 * - attention-mode labels cover the frozen vocabulary.
 */

import { describe, expect, it } from "bun:test";

import type { IntentOperations } from "../src/intent";
import { IntentStore } from "../src/intent";
import {
  ATTENTION_MODE_LABELS,
  FEEDBACK_CONTROLS,
  feedModeChoiceView,
  personalizeControlView,
  realizationChoiceView,
} from "../src/control-views";
import { makeWebCapabilities, makeDesktopCapabilities } from "../src/index";

const T0 = Date.parse("2026-09-18T12:00:00.000Z");
const ids = { next: () => "00000000000000000000000001" };

function intentOps(): IntentOperations {
  const store = new IntentStore({ now: () => T0 }, ids);
  return store.operations();
}

describe("R21-C — the Personalize control view", () => {
  it("projects the empty state honestly (no intents, balanced default)", () => {
    const view = personalizeControlView(intentOps());
    expect(view.intents).toHaveLength(0);
    expect(view.attentionMode).toBe("balanced");
    expect(view.attentionLabel).toBe("Balanced");
    expect(view.dials.exploration).toBe(0.5);
    expect(view.feedbackControls).toHaveLength(4);
  });

  it("projects active intents with scope labels and temporary expiry truth", () => {
    const store = new IntentStore({ now: () => T0 }, ids);
    store.set({ objective: "cozy-comedy-tonight", scope: "temporary", expiresAt: new Date(T0 + 3600_000).toISOString() });
    store.set({ objective: "learn-cooking", scope: "persistent", weight: 2 });
    const view = personalizeControlView(store.operations());
    expect(view.intents).toHaveLength(2);
    const temporary = view.intents.find((intent) => intent.objective === "cozy-comedy-tonight");
    expect(temporary?.scopeLabel).toBe("tonight");
    expect(temporary?.expiresAt).toBe(new Date(T0 + 3600_000).toISOString());
    const persistent = view.intents.find((intent) => intent.objective === "learn-cooking");
    expect(persistent?.scopeLabel).toBe("for a while");
    expect(persistent?.expiresAt).toBeUndefined();
  });

  it("projects the policy view (attention mode + dials) after a policy set", () => {
    const store = new IntentStore({ now: () => T0 }, ids);
    store.setPolicy({ attentionMode: "mindful", exploration: 0.9, novelty: 0.2, socialInfluence: 0.1 });
    const view = personalizeControlView(store.operations());
    expect(view.attentionMode).toBe("mindful");
    expect(view.attentionLabel).toBe("Mindful");
    expect(view.dials).toEqual({ exploration: 0.9, novelty: 0.2, socialInfluence: 0.1 });
  });

  it("the feedback-control vocabulary is the frozen four, labeled in user words", () => {
    expect(FEEDBACK_CONTROLS.map((control) => control.kind)).toEqual([
      "more-like-this",
      "not-interested",
      "not-interested-source",
      "already-watched",
    ]);
    for (const control of FEEDBACK_CONTROLS) {
      expect(control.label.length).toBeGreaterThan(0);
      expect(/connector|protocol|R\d{1,2}/i.test(control.label)).toBe(false);
    }
  });

  it("the attention-mode labels cover the frozen vocabulary exactly", () => {
    expect(Object.keys(ATTENTION_MODE_LABELS).sort()).toEqual(
      ["balanced", "custom", "immersive", "mindful"].sort(),
    );
  });
});

describe("R21-C — the feed-mode choice view", () => {
  it("renders EVERY mode (discoverable, never hidden) with the frozen labels", () => {
    const view = feedModeChoiceView("foryou", { following: false, byof: false });
    expect(view.selected).toBe("foryou");
    expect(view.options.map((option) => option.mode)).toEqual([
      "foryou",
      "following",
      "byof",
      "hybrid",
    ]);
    expect(view.options[0]?.label).toBe("For you");
  });

  it("unavailable modes carry their honest explanation + recovery hint (never a dead end)", () => {
    const view = feedModeChoiceView("foryou", { following: false, byof: false });
    const byof = view.options.find((option) => option.mode === "byof");
    expect(byof?.available).toBe(false);
    expect(byof?.unavailableDetail).toContain("imported feed");
    expect(byof?.recoveryHint).toContain("Bring your feed");
    const following = view.options.find((option) => option.mode === "following");
    expect(following?.recoveryHint).toContain("Follow");
  });

  it("available modes carry no refusal fields (the truth is exactly the availability)", () => {
    const view = feedModeChoiceView("hybrid", { following: true, byof: true });
    for (const option of view.options) {
      expect(option.available).toBe(true);
      expect(option.unavailableDetail).toBeUndefined();
      expect(option.recoveryHint).toBeUndefined();
    }
    expect(view.selected).toBe("hybrid");
  });

  it("'For you' is always available even with nothing connected/imported", () => {
    const view = feedModeChoiceView("foryou", { following: false, byof: false });
    expect(view.options[0]?.available).toBe(true);
  });
});

describe("R21-C — the realization choice view (Where to watch)", () => {
  const REALIZATIONS: readonly { mode: "embed" | "native" | "external"; connectorId: string }[] = [
    { mode: "embed", connectorId: "conn-1" },
    { mode: "native", connectorId: "conn-2" },
    { mode: "external", connectorId: "conn-3" },
  ];
  const EMBED = REALIZATIONS[0]!;
  const NATIVE = REALIZATIONS[1]!;

  it("projects the active realization + the alternates with capability truth", () => {
    const view = realizationChoiceView({
      capabilities: makeWebCapabilities(),
      realizations: REALIZATIONS,
      active: EMBED,
    });
    expect(view.activeMode).toBe("embed");
    expect(view.activeLabel).toBe("Plays inside WebFlix");
    expect(view.options).toHaveLength(3);
    const native = view.options.find((option) => option.mode === "native");
    // Web cannot play native — the honest reason names the Desktop truth:
    expect(native?.usable).toBe(false);
    expect(native?.unusableReason).toContain("Desktop app");
  });

  it("Desktop CAN play native realizations (platform capability truth, not product policy)", () => {
    const view = realizationChoiceView({
      capabilities: makeDesktopCapabilities(),
      realizations: REALIZATIONS,
      active: NATIVE,
    });
    const native = view.options.find((option) => option.mode === "native");
    expect(native?.usable).toBe(true);
    expect(native?.unusableReason).toBeUndefined();
    expect(view.activeLabel).toBe("Plays natively in the Desktop app");
  });

  it("no active realization answers the honest 'nothing resolved yet' sentence", () => {
    const view = realizationChoiceView({
      capabilities: makeWebCapabilities(),
      realizations: REALIZATIONS,
      active: null,
    });
    expect(view.activeMode).toBeNull();
    expect(view.activeLabel).toBe("No way to watch yet");
  });
});
