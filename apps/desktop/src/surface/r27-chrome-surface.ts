/**
 * @wfx/app-desktop — THE R27 PLAYER CHROME SURFACE (the corpus control
 * grammar, projected — W3's chrome lane).
 *
 * THE LAW (docs/parity-lab/reference/design-tokens.md "Player chrome
 * anatomy" + watch-geometry.md "The player stage" + the W2 web chrome's
 * landed grammar): the Desktop player carries the SAME control grammar
 * the corpus pins — left→right: play/pause (next when queued), volume
 * (hover slider), time `cur / dur`, spacer, captions, settings gear
 * (TWO-LEVEL popup with back-arrow navigation), miniplayer, theater,
 * fullscreen — over the red `#f03` progress (3px→5px hover, 12px white
 * scrubber dot), the 48px bar overlaying the 16:9 stage bottom, the
 * gradient scrim, and the ~3s idle fade (mousemove/focus reveals).
 *
 * THE KEYBOARD RETARGET (R27, recorded): the corpus map is
 * `space`/`k` play-pause · `j`/`l` ±10s · `←`/`→` ±5s · `↑`/`↓` volume ·
 * `f` fullscreen · `t` THEATER · `m` mute · `c` captions · `0–9`
 * percent-seek · `Escape` exits · `?` the shortcut sheet. This SUPERSEDES
 * the R24 map's `t`-transcript binding (transcript now lives inside the
 * settings popup — the corpus's own placement for it; the R24 surface
 * and its battery stay untouched, this is the parity grammar the webview
 * renders).
 *
 * THE CAPABILITY-ROW LAW (the packet's C, verbatim): the WebFlix
 * capability rows — the Translate gate, the AI intelligence actions,
 * the transcript/chapters artifacts, the provenance, and Where to watch
 * — live INSIDE the settings popup (+ the watch page's own panels),
 * capability-truth-gated, never removed, never faked.
 *
 * WHAT RUNS UNDERNEATH IS UNCHANGED (the R26 law): the runtime's
 * playback semantics — seek, the session queue, the verified-copy
 * demotion (`playerScrubPlayability`'s honest needs-verified-range
 * answer) — stay exactly as they are; this surface only projects the
 * control grammar onto them.
 */

import type { PlaybackMode } from "@wfx/domain";

import {
  formatPlaybackTime,
  KEYBOARD_SEEK_JUMP_MS,
  KEYBOARD_SEEK_STEP_MS,
  playerScrubModelOf,
  playerScrubPlayability,
  playerScrubPreview,
  type PlayerChapterMarker,
  type PlayerScrubModel,
} from "./player-affordance-surface";
import type { PlaybackState } from "@wfx/client-runtime";
import { R27_GEOMETRY, R27_MOTION } from "./r27-parity-tokens";

// ---------------------------------------------------------------------------
// The control bar (the corpus order)
// ---------------------------------------------------------------------------

/** One control in the corpus's control-bar grammar. */
export type R27ChromeControlKind =
  | "play-pause"
  | "next"
  | "volume"
  | "time"
  | "captions"
  | "settings"
  | "miniplayer"
  | "theater"
  | "fullscreen";

/** THE corpus control order (left→right; the corpus's own anatomy). */
export const R27_CHROME_CONTROL_ORDER: readonly R27ChromeControlKind[] = [
  "play-pause",
  "next",
  "volume",
  "time",
  "captions",
  "settings",
  "miniplayer",
  "theater",
  "fullscreen",
] as const;

/** The honest backing vocabulary (the R24 discipline, same words). */
export type R27ChromeBacking =
  | "runtime-command"
  | "platform-affordance"
  | "realization-exposed"
  | "view-state"
  | "not-exposed-yet";

/** One projected control (placement + backing + the honest truth). */
export interface R27ChromeControlView {
  readonly kind: R27ChromeControlKind;
  /** The control's aria label (the familiar name, honest identity). */
  readonly label: string;
  readonly backing: R27ChromeBacking;
  /** The honest one-sentence truth of what backs the control HERE. */
  readonly detail: string;
  /**
   * Whether the control renders: `next` renders only when the session
   * queue holds an entry (the corpus: "next when queued"); every other
   * control always renders (with its honest backing, never a dead
   * button).
   */
  readonly visible: boolean;
}

/**
 * Project the control bar for one realization mode + queue truth. Every
 * control renders in the corpus order; the per-rung truths are the R24
 * affordance map's own (native volume/mute honestly not-exposed-yet;
 * provider ways realization-exposed).
 */
export function r27ChromeControlsOf(
  mode: PlaybackMode,
  input: { readonly queueCount: number },
): readonly R27ChromeControlView[] {
  const native = mode === "native";
  const views: Readonly<Record<R27ChromeControlKind, R27ChromeControlView>> = {
    "play-pause": {
      kind: "play-pause",
      label: "Play or pause",
      backing: "runtime-command",
      detail: "The shared playback controller's own play/pause — Space or K.",
      visible: true,
    },
    next: {
      kind: "next",
      label: "Next",
      backing: "runtime-command",
      detail:
        "Jumps to the session queue's head — the next thing you queued, played through the same path.",
      visible: input.queueCount > 0,
    },
    volume: {
      kind: "volume",
      label: "Volume",
      backing: native ? "not-exposed-yet" : "realization-exposed",
      detail: native
        ? "The native path does not expose a volume command yet — use the device volume until the player's own volume control lands; the control appears the moment the rung exposes it."
        : "This way of watching carries its own volume control — the provider's player answers volume directly.",
      visible: true,
    },
    time: {
      kind: "time",
      label: "Time",
      backing: "runtime-command",
      detail:
        "The current time over the duration — the session's own truthful numbers, never a ticker.",
      visible: true,
    },
    captions: {
      kind: "captions",
      label: "Captions (C)",
      backing: "view-state",
      detail: "The caption paths — the same Model Fabric subtitle transformations every surface uses.",
      visible: true,
    },
    settings: {
      kind: "settings",
      label: "Settings",
      backing: "view-state",
      detail:
        "Speed, quality, and WebFlix's own capabilities — Translate, Transcript, AI actions, Provenance, Where to watch — each gated on its truthful availability.",
      visible: true,
    },
    miniplayer: {
      kind: "miniplayer",
      label: "Miniplayer",
      backing: "platform-affordance",
      detail:
        "The window's picture-in-picture/always-on-top state — the Desktop platform's own affordance.",
      visible: true,
    },
    theater: {
      kind: "theater",
      label: "Theater mode (T)",
      backing: "view-state",
      detail:
        "The stage takes the window's full width — the same familiar mode, keyed to T (the corpus keyboard grammar).",
      visible: true,
    },
    fullscreen: {
      kind: "fullscreen",
      label: "Fullscreen (F)",
      backing: "platform-affordance",
      detail: "The app window's own fullscreen state — F enters, Escape leaves.",
      visible: true,
    },
  };
  return R27_CHROME_CONTROL_ORDER.map((kind) => views[kind]);
}

// ---------------------------------------------------------------------------
// The time readout (the honest numbers)
// ---------------------------------------------------------------------------

/** The in-bar time readout (`0:00 / 7:45`; current-only while unknown). */
export function r27ChromeTimeReadout(state: PlaybackState): string {
  if (state.durationMs === undefined) return formatPlaybackTime(state.positionMs);
  return `${formatPlaybackTime(state.positionMs)} / ${formatPlaybackTime(state.durationMs)}`;
}

// ---------------------------------------------------------------------------
// The scrub (the red #f03 grammar over the truthful runway)
// ---------------------------------------------------------------------------

/** The chrome's scrub view over the corpus spec. */
export interface R27ChromeScrubView {
  /** The scrub model (the runtime's own numbers, composed from R24). */
  readonly model: PlayerScrubModel;
  /** The track height at rest / hover (3→5px, from the geometry). */
  readonly trackHeightPx: number;
  readonly trackHoverHeightPx: number;
  /** The scrubber dot (12px, the corpus). */
  readonly scrubberDotPx: number;
  /** The played fill color (the red #f03 token). */
  readonly playedColor: string;
  /** The played fraction [0,1] (0 when the duration is still unknown). */
  readonly playedFraction: number;
  /** The buffered fraction [0,1] (the honest runway). */
  readonly bufferedFraction: number;
}

/** Project the scrub view (the corpus geometry + the honest fractions). */
export function r27ChromeScrubViewOf(
  state: PlaybackState,
  chapters: readonly PlayerChapterMarker[] = [],
): R27ChromeScrubView {
  const model = playerScrubModelOf(state, chapters);
  const duration = model.durationMs ?? 0;
  return {
    model,
    trackHeightPx: R27_GEOMETRY.playerScrubTrackHeight,
    trackHoverHeightPx: R27_GEOMETRY.playerScrubTrackHoverHeight,
    scrubberDotPx: R27_GEOMETRY.playerScrubberDot,
    playedColor: "#f03",
    playedFraction: duration > 0 ? Math.min(1, model.positionMs / duration) : 0,
    bufferedFraction:
      duration > 0 ? Math.min(1, (model.positionMs + model.bufferedMs) / duration) : 0,
  };
}

/** The scrub preview at one target (R24's own, composed). */
export function r27ChromeScrubPreview(model: PlayerScrubModel, targetMs: number) {
  return playerScrubPreview(model, targetMs);
}

/**
 * The scrub TRUTH at one target — the verified-copy demotion law
 * (R26, UNCHANGED underneath): playable inside the verified runway;
 * the honest needs-verified-range answer outside it (the peer copy
 * plays as it arrives; the chrome never fakes the jump).
 */
export function r27ChromeScrubPlayability(model: PlayerScrubModel, targetMs: number) {
  return playerScrubPlayability(model, targetMs);
}

// ---------------------------------------------------------------------------
// The idle fade (the corpus motion)
// ---------------------------------------------------------------------------

/** The chrome's visibility over the idle clock (the ~3s fade). */
export interface R27ChromeIdleView {
  /** Whether the chrome renders visible (mousemove/focus resets the idle). */
  readonly visible: boolean;
  /** The idle threshold actually applied (the corpus: ~3s). */
  readonly idleThresholdMs: number;
  /** The fade transition duration (300ms ease). */
  readonly fadeMs: number;
}

/** Project the idle state (pure: the caller owns the interaction clock). */
export function r27ChromeIdleView(lastInteractionAgoMs: number, focused: boolean): R27ChromeIdleView {
  return {
    visible: focused || lastInteractionAgoMs < R27_MOTION.idleFadeMs,
    idleThresholdMs: R27_MOTION.idleFadeMs,
    fadeMs: R27_MOTION.chromeFadeMs,
  };
}

// ---------------------------------------------------------------------------
// The keyboard map (the corpus grammar, the R27 retarget)
// ---------------------------------------------------------------------------

/** The R27 chrome command (the R24 transport + the theater surface mode). */
export type R27ChromeCommand =
  | { readonly kind: "toggle-play-pause" }
  | { readonly kind: "seek"; readonly deltaMs: number }
  | { readonly kind: "seek-percent"; readonly percent: number }
  | { readonly kind: "step-volume"; readonly direction: 1 | -1 }
  | { readonly kind: "toggle-mute" }
  | { readonly kind: "toggle-fullscreen" }
  | { readonly kind: "exit-fullscreen" }
  | { readonly kind: "toggle-miniplayer" }
  | { readonly kind: "toggle-captions" }
  | { readonly kind: "toggle-theater" }
  | { readonly kind: "toggle-shortcut-sheet" };

/** One R27 keyboard binding (the grammar's table row). */
export interface R27KeyboardBinding {
  readonly key: string;
  readonly command: R27ChromeCommand;
  readonly description: string;
}

/**
 * THE R27 KEYBOARD GRAMMAR (the corpus map, verbatim — the retarget that
 * supersedes R24's t-transcript for the parity surfaces): space/k
 * play-pause · j/l ±10s · arrows ±5s / volume · f fullscreen ·
 * t THEATER · m mute · c captions · 0–9 percent · Escape exits ·
 * ? the shortcut sheet.
 */
export const R27_KEYBOARD_BINDINGS: readonly R27KeyboardBinding[] = [
  { key: " ", command: { kind: "toggle-play-pause" }, description: "Play or pause" },
  { key: "k", command: { kind: "toggle-play-pause" }, description: "Play or pause" },
  { key: "j", command: { kind: "seek", deltaMs: -KEYBOARD_SEEK_JUMP_MS }, description: "Back ten seconds" },
  { key: "l", command: { kind: "seek", deltaMs: KEYBOARD_SEEK_JUMP_MS }, description: "Forward ten seconds" },
  { key: "ArrowLeft", command: { kind: "seek", deltaMs: -KEYBOARD_SEEK_STEP_MS }, description: "Back five seconds" },
  { key: "ArrowRight", command: { kind: "seek", deltaMs: KEYBOARD_SEEK_STEP_MS }, description: "Forward five seconds" },
  { key: "ArrowUp", command: { kind: "step-volume", direction: 1 }, description: "Volume up (device volume until the player's own control lands)" },
  { key: "ArrowDown", command: { kind: "step-volume", direction: -1 }, description: "Volume down (device volume until the player's own control lands)" },
  { key: "m", command: { kind: "toggle-mute" }, description: "Mute (device volume until the player's own control lands)" },
  { key: "f", command: { kind: "toggle-fullscreen" }, description: "Fullscreen" },
  { key: "Escape", command: { kind: "exit-fullscreen" }, description: "Exit fullscreen" },
  { key: "t", command: { kind: "toggle-theater" }, description: "Theater mode — the stage takes the window's full width" },
  { key: "c", command: { kind: "toggle-captions" }, description: "Captions" },
  { key: "?", command: { kind: "toggle-shortcut-sheet" }, description: "The keyboard shortcut sheet" },
  ...Array.from({ length: 10 }, (_, digit) => ({
    key: String(digit),
    command: { kind: "seek-percent", percent: digit * 10 } as const,
    description: `Jump to ${digit * 10}%`,
  })),
] as const;

/**
 * Parse one keyboard event into the R27 command (pure; the webview's key
 * listener calls this). Unbound keys and modified chords answer null.
 */
export function r27KeyboardCommandOf(event: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}): R27ChromeCommand | null {
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;
  const binding = R27_KEYBOARD_BINDINGS.find((candidate) => candidate.key === event.key);
  return binding !== undefined ? binding.command : null;
}

// ---------------------------------------------------------------------------
// The settings popup (two-level, back-arrow; the capability rows)
// ---------------------------------------------------------------------------

/** One menu row's truth state (capability-truth-gated). */
export interface R27MenuRowView {
  readonly id: string;
  readonly label: string;
  /** The row's current value (e.g. "Normal", "CC BY 3.0"); null = none. */
  readonly value: string | null;
  /** Whether the row is truthfully available on THIS composition. */
  readonly available: boolean;
  /** The honest one-sentence truth (why-not when unavailable). */
  readonly detail: string;
  /** The submenu id the row opens (two-level navigation); null = action. */
  readonly submenu: string | null;
}

/** One submenu (the second level, reached through the back arrow). */
export interface R27MenuSubmenuView {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly R27MenuRowView[];
}

/** The settings menu view (root + submenus + the open level). */
export interface R27SettingsMenuView {
  /** The root rows (the corpus cluster + the WebFlix capability rows). */
  readonly root: readonly R27MenuRowView[];
  /** The second-level submenus (speed, quality). */
  readonly submenus: readonly R27MenuSubmenuView[];
  /** The open submenu id (null = the root level; the back arrow pops). */
  readonly openSubmenu: string | null;
}

/** The capability truths the settings rows gate on. */
export interface R27ChromeCapabilityTruth {
  /** The realtime Translate session truth (the R25 gate, per rung). */
  readonly translateAvailable: boolean;
  /** The transcript artifact's availability (the media-intelligence truth). */
  readonly transcriptAvailable: boolean;
  /** The AI intelligence actions' availability (the local AI truth). */
  readonly aiActionsAvailable: boolean;
  /** The provenance truth (the peer copy's lawful basis, when present). */
  readonly provenance: string | null;
}

/** The honest-unavailable default truths (never a fake-ready row). */
export const R27_CAPABILITY_TRUTH_UNAVAILABLE: R27ChromeCapabilityTruth = {
  translateAvailable: false,
  transcriptAvailable: false,
  aiActionsAvailable: false,
  provenance: null,
};

/**
 * Project the settings menu for one realization mode + capability
 * truths. THE PLACEMENT LAW: the WebFlix capability rows (Translate,
 * Transcript, AI actions, Provenance, Where to watch) live HERE — inside
 * the settings popup — progressively disclosed, each gated on its own
 * truthful availability, never removed, never faked.
 */
export function r27SettingsMenuView(
  mode: PlaybackMode,
  truth: R27ChromeCapabilityTruth,
  options?: { readonly openSubmenu?: string | null },
): R27SettingsMenuView {
  const native = mode === "native";
  const root: R27MenuRowView[] = [
    {
      id: "speed",
      label: "Playback speed",
      value: "Normal",
      available: true,
      detail: native
        ? "The native path does not expose a speed control yet — provider ways carry their own; this appears when the rung exposes it."
        : "This way of watching carries its own speed control.",
      submenu: "speed",
    },
    {
      id: "quality",
      label: "Quality",
      value: null,
      available: true,
      detail: native
        ? "For a peer copy the chosen file IS the quality decision — made where you choose what to watch."
        : "This way of watching carries its own quality selection.",
      submenu: "quality",
    },
    {
      id: "captions",
      label: "Captions",
      value: null,
      available: true,
      detail: "The Model Fabric caption paths — the same subtitle transformations every surface uses.",
      submenu: null,
    },
    {
      id: "translate",
      label: "Translate audio",
      value: null,
      available: truth.translateAvailable,
      detail: truth.translateAvailable
        ? "Realtime translation through the shared session seam — the authorized capture paths; the original audio always stays available."
        : "Translation is not available on this way of watching — the provider's own player keeps its captions; WebFlix never captures protected media.",
      submenu: null,
    },
    {
      id: "transcript",
      label: "Transcript",
      value: null,
      available: truth.transcriptAvailable,
      detail: truth.transcriptAvailable
        ? "The timestamped transcript artifact — the same media-intelligence truth the Web player projects."
        : "No transcript artifact exists for this title yet — the row appears the moment one does.",
      submenu: null,
    },
    {
      id: "ai-actions",
      label: "AI actions",
      value: null,
      available: truth.aiActionsAvailable,
      detail: truth.aiActionsAvailable
        ? "The media-intelligence actions over this title — summarize, explain, find moments."
        : "No AI runtime is available here — the row appears the moment one is bound.",
      submenu: null,
    },
    {
      id: "where-to-watch",
      label: "Where to watch",
      value: null,
      available: true,
      detail:
        "The ways to watch this title — the same viewing-source groups the watch page renders, including the authorized peer copy.",
      submenu: null,
    },
    {
      id: "provenance",
      label: "Provenance",
      value: truth.provenance,
      available: truth.provenance !== null,
      detail:
        truth.provenance !== null
          ? "This copy's lawful basis — who authorized it and under which license."
          : "No provenance is carried by this way of watching.",
      submenu: null,
    },
    {
      id: "keyboard",
      label: "Keyboard shortcuts",
      value: null,
      available: true,
      detail: "The shortcut sheet — every key the player answers.",
      submenu: "keyboard",
    },
  ];
  const submenus: R27MenuSubmenuView[] = [
    {
      id: "speed",
      title: "Playback speed",
      rows: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => ({
        id: `speed-${rate}`,
        label: rate === 1 ? "Normal" : `${rate}×`,
        value: rate === 1 ? "Normal" : null,
        available: !native,
        detail: !native
          ? "This way of watching carries its own speed control."
          : "The native path does not expose a speed control yet — provider ways carry their own.",
        submenu: null,
      })),
    },
    {
      id: "quality",
      title: "Quality",
      rows: native
        ? [
            {
              id: "quality-file",
              label: "The chosen file is the quality",
              value: null,
              available: true,
              detail:
                "For a peer copy the file you chose IS the quality decision — made where you choose what to watch.",
              submenu: null,
            },
          ]
        : [
            {
              id: "quality-provider",
              label: "The provider's own quality menu",
              value: null,
              available: true,
              detail: "This way of watching plays inside the provider's player, which owns quality.",
              submenu: null,
            },
          ],
    },
    {
      id: "keyboard",
      title: "Keyboard shortcuts",
      rows: R27_KEYBOARD_BINDINGS.map((binding) => ({
        id: `key-${binding.key === " " ? "space" : binding.key}`,
        label: binding.key === " " ? "Space" : binding.key,
        value: binding.description,
        available: true,
        detail: binding.description,
        submenu: null,
      })),
    },
  ];
  return {
    root,
    submenus,
    openSubmenu: options?.openSubmenu ?? null,
  };
}

// ---------------------------------------------------------------------------
// The stage modes (the surface's own presentation truth)
// ---------------------------------------------------------------------------

/** The player's surface mode (the familiar modes, keyed to T). */
export type R27StageMode = "default" | "theater" | "fullscreen";

/** The stage's geometry for one mode (the corpus stage law). */
export interface R27StageGeometryView {
  readonly mode: R27StageMode;
  /** The stage aspect (16:9 in default/theater; the window in fullscreen). */
  readonly aspectRatio: number | null;
  /** The stage radius (12px in default; 0 full-bleed in theater/fullscreen). */
  readonly radiusPx: number;
}

/** Project the stage geometry for one mode. */
export function r27StageGeometryOf(mode: R27StageMode): R27StageGeometryView {
  if (mode === "default") {
    return { mode, aspectRatio: 16 / 9, radiusPx: R27_GEOMETRY.playerRadius };
  }
  return { mode, aspectRatio: null, radiusPx: 0 };
}
