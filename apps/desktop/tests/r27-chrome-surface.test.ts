/**
 * R27-W3 — THE PLAYER CHROME TEST (the corpus control grammar, pinned).
 *
 * THE LAW: the Desktop chrome projects the corpus's exact control
 * grammar — order (play-pause · next-when-queued · volume · time ·
 * captions · settings · miniplayer · theater · fullscreen), the red
 * #f03 scrub (3→5px hover, 12px dot), the honest time readout, the ~3s
 * idle fade, THE KEYBOARD RETARGET (t = theater — the R27 corpus map),
 * and the two-level settings popup carrying the WebFlix capability rows
 * (Translate/Transcript/AI/Provenance/Where-to-watch) gated on truthful
 * availability — over the UNCHANGED R26 runtime semantics (the
 * verified-copy demotion law composed verbatim from the R24 surface).
 */

import { describe, expect, it } from "bun:test";

import type { PlaybackState } from "@wfx/client-runtime";

import {
  R27_CAPABILITY_TRUTH_UNAVAILABLE,
  R27_CHROME_CONTROL_ORDER,
  R27_KEYBOARD_BINDINGS,
  r27ChromeControlsOf,
  r27ChromeIdleView,
  r27ChromeScrubPlayability,
  r27ChromeScrubViewOf,
  r27ChromeTimeReadout,
  r27KeyboardCommandOf,
  r27SettingsMenuView,
  r27StageGeometryOf,
} from "../src/surface/r27-chrome-surface";

/** A truthful native playback state for the scrub/readout laws. */
function nativeState(over: Partial<PlaybackState> = {}): PlaybackState {
  const base: PlaybackState = {
    sessionId: "sess-1",
    itemId: "item-1",
    mode: "native",
    phase: "playing",
    positionMs: 60_000,
    bufferedMs: 30_000,
    durationMs: 465_000,
  } as PlaybackState;
  return { ...base, ...over } as PlaybackState;
}

/** The same state with the duration honestly ABSENT. */
function nativeStateNoDuration(): PlaybackState {
  const state = nativeState();
  delete (state as { durationMs?: number }).durationMs;
  return state;
}

describe("R27-W3 the chrome control bar (the corpus order)", () => {
  it("renders the corpus order, left→right", () => {
    expect(R27_CHROME_CONTROL_ORDER).toEqual([
      "play-pause",
      "next",
      "volume",
      "time",
      "captions",
      "settings",
      "miniplayer",
      "theater",
      "fullscreen",
    ]);
    const controls = r27ChromeControlsOf("native", { queueCount: 0 });
    expect(controls.map((control) => control.kind)).toEqual([...R27_CHROME_CONTROL_ORDER]);
  });

  it("next renders ONLY when the session queue holds an entry (the corpus law)", () => {
    const empty = r27ChromeControlsOf("native", { queueCount: 0 });
    expect(empty.find((control) => control.kind === "next")!.visible).toBe(false);
    const queued = r27ChromeControlsOf("native", { queueCount: 2 });
    expect(queued.find((control) => control.kind === "next")!.visible).toBe(true);
  });

  it("volume answers the honest per-rung truth (native: not-exposed-yet; embed: realization-exposed)", () => {
    const native = r27ChromeControlsOf("native", { queueCount: 0 });
    expect(native.find((control) => control.kind === "volume")!.backing).toBe("not-exposed-yet");
    const embed = r27ChromeControlsOf("embed", { queueCount: 0 });
    expect(embed.find((control) => control.kind === "volume")!.backing).toBe("realization-exposed");
    // Never a dead button: every non-next control is visible with a truth.
    for (const control of native) {
      if (control.kind !== "next") expect(control.visible).toBe(true);
      expect(control.detail.length).toBeGreaterThan(0);
    }
  });

  it("the time readout carries the honest numbers (cur / dur; cur-only while unknown)", () => {
    expect(r27ChromeTimeReadout(nativeState())).toBe("1:00 / 7:45");
    expect(r27ChromeTimeReadout(nativeStateNoDuration())).toBe("1:00");
  });
});

describe("R27-W3 the scrub (the red #f03 grammar over the truthful runway)", () => {
  it("pins the corpus geometry + the red fill + the honest fractions", () => {
    const scrub = r27ChromeScrubViewOf(nativeState());
    expect(scrub.trackHeightPx).toBe(3);
    expect(scrub.trackHoverHeightPx).toBe(5);
    expect(scrub.scrubberDotPx).toBe(12);
    expect(scrub.playedColor).toBe("#f03");
    expect(scrub.playedFraction).toBeCloseTo(60 / 465, 5);
    expect(scrub.bufferedFraction).toBeCloseTo(90 / 465, 5);
  });

  it("the verified-copy demotion law stays UNCHANGED underneath (R26)", () => {
    const scrub = r27ChromeScrubViewOf(nativeState());
    // Inside the verified runway: playable.
    expect(r27ChromeScrubPlayability(scrub.model, 80_000).kind).toBe("playable");
    // Behind the position: playable.
    expect(r27ChromeScrubPlayability(scrub.model, 10_000).kind).toBe("playable");
    // Far beyond the runway on the NATIVE rung: the honest answer, never a fake jump.
    const beyond = r27ChromeScrubPlayability(scrub.model, 400_000);
    expect(beyond.kind).toBe("needs-verified-range");
    expect(beyond.detail).toContain("isn't fetched yet");
    // Provider ways answer playable (their own players own the seek).
    const embedScrub = r27ChromeScrubViewOf(nativeState({ mode: "embed" as never }));
    expect(r27ChromeScrubPlayability(embedScrub.model, 400_000).kind).toBe("playable");
  });
});

describe("R27-W3 the idle fade (the corpus motion)", () => {
  it("fades at ~3s idle; mousemove/focus reveals; the fade is 300ms", () => {
    expect(r27ChromeIdleView(500, false).visible).toBe(true);
    expect(r27ChromeIdleView(2_999, false).visible).toBe(true);
    expect(r27ChromeIdleView(3_001, false).visible).toBe(false);
    expect(r27ChromeIdleView(60_000, true).visible).toBe(true); // focus keeps it
    const view = r27ChromeIdleView(0, false);
    expect(view.idleThresholdMs).toBe(3000);
    expect(view.fadeMs).toBe(300);
  });
});

describe("R27-W3 the keyboard map (the corpus retarget: t = theater)", () => {
  it("binds the corpus keys", () => {
    const byKey = (key: string) => R27_KEYBOARD_BINDINGS.find((b) => b.key === key);
    expect(byKey(" ")?.command.kind).toBe("toggle-play-pause");
    expect(byKey("k")?.command.kind).toBe("toggle-play-pause");
    expect(byKey("j")?.command).toEqual({ kind: "seek", deltaMs: -10_000 });
    expect(byKey("l")?.command).toEqual({ kind: "seek", deltaMs: 10_000 });
    expect(byKey("ArrowLeft")?.command).toEqual({ kind: "seek", deltaMs: -5_000 });
    expect(byKey("ArrowRight")?.command).toEqual({ kind: "seek", deltaMs: 5_000 });
    expect(byKey("ArrowUp")?.command).toEqual({ kind: "step-volume", direction: 1 });
    expect(byKey("ArrowDown")?.command).toEqual({ kind: "step-volume", direction: -1 });
    expect(byKey("m")?.command.kind).toBe("toggle-mute");
    expect(byKey("f")?.command.kind).toBe("toggle-fullscreen");
    expect(byKey("Escape")?.command.kind).toBe("exit-fullscreen");
    expect(byKey("c")?.command.kind).toBe("toggle-captions");
    expect(byKey("?")?.command.kind).toBe("toggle-shortcut-sheet");
    // THE RETARGET: t = theater (the corpus keyboard grammar).
    expect(byKey("t")?.command).toEqual({ kind: "toggle-theater" });
    // The transcript key binding is GONE from the map (transcript lives in the settings popup).
    expect(byKey("t")?.command.kind).not.toBe("toggle-transcript");
    // 0–9 percent-seek.
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(byKey(String(digit))?.command).toEqual({ kind: "seek-percent", percent: digit * 10 });
    }
  });

  it("parses events; unbound keys and modified chords answer null", () => {
    expect(r27KeyboardCommandOf({ key: "t" })).toEqual({ kind: "toggle-theater" });
    expect(r27KeyboardCommandOf({ key: "5" })).toEqual({ kind: "seek-percent", percent: 50 });
    expect(r27KeyboardCommandOf({ key: "x" })).toBeNull();
    expect(r27KeyboardCommandOf({ key: "t", ctrlKey: true })).toBeNull();
    expect(r27KeyboardCommandOf({ key: "t", metaKey: true })).toBeNull();
    expect(r27KeyboardCommandOf({ key: "t", altKey: true })).toBeNull();
  });
});

describe("R27-W3 the settings popup (two-level; the capability rows live inside)", () => {
  it("carries EVERY WebFlix capability row — gated on truthful availability, never removed", () => {
    const menu = r27SettingsMenuView("native", R27_CAPABILITY_TRUTH_UNAVAILABLE);
    const ids = menu.root.map((row) => row.id);
    for (const id of [
      "speed", "quality", "captions",
      "translate", "transcript", "ai-actions",
      "where-to-watch", "provenance", "keyboard",
    ]) {
      expect(ids).toContain(id);
    }
    // The honest-unavailable truths (never fake-ready):
    expect(menu.root.find((row) => row.id === "translate")!.available).toBe(false);
    expect(menu.root.find((row) => row.id === "transcript")!.available).toBe(false);
    expect(menu.root.find((row) => row.id === "ai-actions")!.available).toBe(false);
    expect(menu.root.find((row) => row.id === "provenance")!.available).toBe(false);
    // Where-to-watch + captions are always real (their surfaces exist):
    expect(menu.root.find((row) => row.id === "where-to-watch")!.available).toBe(true);
    expect(menu.root.find((row) => row.id === "captions")!.available).toBe(true);
  });

  it("the gates flip with the truth (capability truth BOTH directions)", () => {
    const menu = r27SettingsMenuView("native", {
      translateAvailable: true,
      transcriptAvailable: true,
      aiActionsAvailable: true,
      provenance: "CC BY 3.0 — authorized by the rights holder",
    });
    expect(menu.root.find((row) => row.id === "translate")!.available).toBe(true);
    expect(menu.root.find((row) => row.id === "provenance")!.value).toBe(
      "CC BY 3.0 — authorized by the rights holder",
    );
  });

  it("the two-level navigation: speed/quality submenus + the back-arrow pop", () => {
    const root = r27SettingsMenuView("native", R27_CAPABILITY_TRUTH_UNAVAILABLE);
    expect(root.openSubmenu).toBeNull();
    expect(root.root.find((row) => row.id === "speed")!.submenu).toBe("speed");
    const opened = r27SettingsMenuView("native", R27_CAPABILITY_TRUTH_UNAVAILABLE, {
      openSubmenu: "speed",
    });
    expect(opened.openSubmenu).toBe("speed");
    const speed = opened.submenus.find((menu) => menu.id === "speed")!;
    expect(speed.rows.map((row) => row.label)).toContain("Normal");
    expect(speed.rows).toHaveLength(8);
    // The keyboard submenu renders the shortcut sheet rows.
    const keyboard = opened.submenus.find((menu) => menu.id === "keyboard")!;
    expect(keyboard.rows.length).toBe(R27_KEYBOARD_BINDINGS.length);
  });

  it("the quality submenu answers the honest per-rung truth", () => {
    const native = r27SettingsMenuView("native", R27_CAPABILITY_TRUTH_UNAVAILABLE, {
      openSubmenu: "quality",
    });
    expect(native.submenus.find((m) => m.id === "quality")!.rows[0]!.detail).toContain(
      "the file you chose IS the quality",
    );
    const embed = r27SettingsMenuView("embed", R27_CAPABILITY_TRUTH_UNAVAILABLE, {
      openSubmenu: "quality",
    });
    expect(embed.submenus.find((m) => m.id === "quality")!.rows[0]!.detail).toContain(
      "provider's player, which owns quality",
    );
  });
});

describe("R27-W3 the stage modes (the corpus stage law)", () => {
  it("default: 16:9 radius 12; theater/fullscreen: full-bleed radius 0", () => {
    expect(r27StageGeometryOf("default")).toEqual({ mode: "default", aspectRatio: 16 / 9, radiusPx: 12 });
    expect(r27StageGeometryOf("theater")).toEqual({ mode: "theater", aspectRatio: null, radiusPx: 0 });
    expect(r27StageGeometryOf("fullscreen")).toEqual({ mode: "fullscreen", aspectRatio: null, radiusPx: 0 });
  });
});
