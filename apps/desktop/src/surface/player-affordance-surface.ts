/**
 * @wfx/app-desktop — the native player affordance parity surface (R24-W3,
 * the plan's R24-B/C "familiar grammar on the native path").
 *
 * THE LAW THIS SURFACE PROJECTS (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md R24-C + the design
 * language's "Familiar video-product interaction grammar — R24" section):
 * the Desktop player carries the CONTROL GRAMMAR a mature video product's
 * viewer already knows — control placement, keyboard behavior,
 * direct-manipulation seek/scrub, the settings cluster, the up-next/queue
 * rail — while every affordance's BACKING is honest capability truth:
 *
 * - `runtime-command` — the shared PlaybackController executes it (the
 *   same transport every realization uses: provider, peer copy, local);
 * - `platform-affordance` — the shell/OS provides the mechanism (the
 *   window fullscreen, the OS share sheet, the OS notifications);
 * - `realization-exposed` — the realization itself carries the control
 *   (provider embed/browser volume, speed, quality);
 * - `shared-surface` — a shared runtime surface owns the semantics (the
 *   Library watchlist, the intents/attention policy, the Model Fabric
 *   caption/transcript paths);
 * - `session-affordance` — a session-scoped projection composing runtime
 *   operations only (the session queue, the up-next order);
 * - `not-exposed-yet` — honestly placed but not yet backed on this rung
 *   (native volume/rate until the frozen port contract is extended) —
 *   rendered as capability truth with the honest next path, NEVER a dead
 *   button and NEVER a fake control.
 *
 * THE HONEST-ABSENCE LAW: cast/second-screen is ABSENT from the Desktop
 * control grammar because the reference Desktop truthfully declares no
 * cast sink (`desktopDeviceCapabilities().casting === false`) — a cast
 * button that cannot cast is a dead button, which the design law forbids.
 *
 * WHAT THIS MODULE IS NOT: a second playback system (the runtime owns
 * playback semantics), a policy engine (the attention policy is the
 * runtime's own — the autoplay projection DERIVES from it), or a queue
 * business rule (every queue write is a runtime operation; the queue is
 * session-scoped ordering only). The shared autoplay/queue contracts are
 * Worker 1's R24-A seams — when they land, this surface consumes them and
 * the local derivations retire (the escalation is recorded in the R24-W3
 * report).
 */

import type { PlaybackController, PlaybackState } from "@wfx/client-runtime";
import type { ClientRuntime } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import type { PlaybackMode } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The affordance vocabulary (the closed control grammar)
// ---------------------------------------------------------------------------

/**
 * One affordance of the familiar player grammar. The union is CLOSED: a
 * new affordance is a parity-lab decision (a new row), never a silent
 * addition. `cast` is deliberately NOT a member — the honest-absence law.
 * `translate` joined the grammar with R25 (the plan's R25-G player-local
 * language control) — the parity-lab decision that added the row.
 */
export type PlayerAffordanceKind =
  | "play-pause"
  | "seek-scrub"
  | "volume"
  | "mute"
  | "fullscreen"
  | "miniplayer"
  | "speed"
  | "quality"
  | "captions"
  | "transcript"
  | "chapters"
  | "autoplay"
  | "up-next"
  | "queue"
  | "watchlist-save"
  | "share"
  | "feedback"
  | "translate";

/** Every affordance kind, in the control bar's familiar order. */
export const PLAYER_AFFORDANCE_KINDS: readonly PlayerAffordanceKind[] = [
  "play-pause",
  "seek-scrub",
  "volume",
  "mute",
  "fullscreen",
  "miniplayer",
  "speed",
  "quality",
  "captions",
  "transcript",
  "chapters",
  "autoplay",
  "up-next",
  "queue",
  "watchlist-save",
  "share",
  "feedback",
  "translate",
] as const;

/** The honest backing vocabulary (the surface's own truth discipline). */
export type PlayerAffordanceBacking =
  | "runtime-command"
  | "platform-affordance"
  | "realization-exposed"
  | "shared-surface"
  | "session-affordance"
  | "not-exposed-yet";

/** One projected affordance: placement + backing + the honest detail. */
export interface PlayerAffordanceView {
  readonly kind: PlayerAffordanceKind;
  /** Where the control sits (the familiar placement, not a YouTube clone). */
  readonly placement: string;
  readonly backing: PlayerAffordanceBacking;
  /** The user-facing label (stable terminology across surfaces). */
  readonly label: string;
  /** The honest one-sentence truth of what backs the control HERE. */
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// The per-rung affordance map (the realization truth per control)
// ---------------------------------------------------------------------------

/**
 * The affordance map for ONE playback realization mode. The transport
 * affordances are identical on every rung (the runtime's own commands);
 * the settings-cluster affordances answer the WHERE-THE-REALIZATION-
 * EXPOSES-IT truth (the plan's pairing vocabulary, verbatim).
 */
export function playerAffordanceMap(mode: PlaybackMode): readonly PlayerAffordanceView[] {
  const transport: readonly PlayerAffordanceView[] = [
    {
      kind: "play-pause",
      placement: "the transport bar's left cluster",
      backing: "runtime-command",
      label: "Play / Pause",
      detail:
        "The shared playback controller's own play/pause commands — the same transport every way of watching uses.",
    },
    {
      kind: "seek-scrub",
      placement: "the transport bar's progress bar",
      backing: "runtime-command",
      label: "Seek",
      detail:
        "Direct manipulation on the progress bar: the controller's typed seek, the truthful buffered runway, and the honest answer when a range is not verified yet.",
    },
  ];
  const rungSettings: readonly PlayerAffordanceView[] =
    mode === "native"
      ? [
          {
            kind: "volume",
            placement: "the transport bar's player-local cluster",
            backing: "not-exposed-yet",
            label: "Volume",
            detail:
              "The native path does not expose a volume command yet — use the device volume until the player's own volume control lands; the control appears the moment the rung exposes it.",
          },
          {
            kind: "mute",
            placement: "the transport bar's player-local cluster",
            backing: "not-exposed-yet",
            label: "Mute",
            detail:
              "The native path does not expose a mute command yet — the device volume is the honest path, and this control never pretends otherwise.",
          },
          {
            kind: "speed",
            placement: "the settings cluster",
            backing: "not-exposed-yet",
            label: "Playback speed",
            detail:
              "The native path does not expose a speed control yet — provider ways of watching carry their own speed control, and this one appears when the rung exposes it.",
          },
          {
            kind: "quality",
            placement: "the settings cluster",
            backing: "realization-exposed",
            label: "Quality",
            detail:
              "For a peer copy the chosen file IS the quality decision (made where you choose what to watch); provider ways carry their own quality menu.",
          },
        ]
      : [
          {
            kind: "volume",
            placement: "the transport bar's player-local cluster",
            backing: "realization-exposed",
            label: "Volume",
            detail:
              "This way of watching carries its own volume control — the provider's player answers volume directly.",
          },
          {
            kind: "mute",
            placement: "the transport bar's player-local cluster",
            backing: "realization-exposed",
            label: "Mute",
            detail: "This way of watching carries its own mute control.",
          },
          {
            kind: "speed",
            placement: "the settings cluster",
            backing: "realization-exposed",
            label: "Playback speed",
            detail: "This way of watching carries its own speed control.",
          },
          {
            kind: "quality",
            placement: "the settings cluster",
            backing: "realization-exposed",
            label: "Quality",
            detail: "This way of watching carries its own quality selection.",
          },
        ];
  const shared: readonly PlayerAffordanceView[] = [
    {
      kind: "fullscreen",
      placement: "the transport bar's right cluster",
      backing: "platform-affordance",
      label: "Fullscreen",
      detail:
        "The app window's own fullscreen state — the Desktop platform's affordance for the same familiar control.",
    },
    {
      kind: "miniplayer",
      placement: "the transport bar's right cluster",
      backing: "platform-affordance",
      label: "Miniplayer",
      detail:
        "The window's picture-in-picture/always-on-top state — placed here; the shell composition is the follow-up, honestly noted.",
    },
    {
      kind: "captions",
      placement: "the settings cluster",
      backing: "shared-surface",
      label: "Captions",
      detail:
        "The AI/provider/local subtitle paths — the same Model Fabric transformations the Web player uses.",
    },
    {
      kind: "transcript",
      placement: "the player's side panel",
      backing: "shared-surface",
      label: "Transcript",
      detail:
        "The timestamped transcript artifact — the same media-intelligence truth the Web player projects.",
    },
    {
      kind: "chapters",
      placement: "the progress bar's chapter markers + the side panel's list",
      backing: "shared-surface",
      label: "Chapters",
      detail:
        "The chapters/scenes artifact — markers on the same progress bar, jumps through the same typed seek.",
    },
    {
      kind: "autoplay",
      placement: "the Up-next card's toggle",
      backing: "shared-surface",
      label: "Autoplay",
      detail:
        "Derives from your attention mode — the same policy on every platform, never a raw always-on switch.",
    },
    {
      kind: "up-next",
      placement: "the Watch page's Up-next rail",
      backing: "session-affordance",
      label: "Up next",
      detail:
        "The next thing to watch, presented with the same card grammar as discovery.",
    },
    {
      kind: "queue",
      placement: "the Up-next rail's queue list",
      backing: "session-affordance",
      label: "Queue",
      detail:
        "Your session queue — add from any card, plays through the same playback path, saves into your Library.",
    },
    {
      kind: "watchlist-save",
      placement: "the title's action row",
      backing: "shared-surface",
      label: "Save",
      detail: "The Library's own watchlist write — the durable save, the same action everywhere.",
    },
    {
      kind: "share",
      placement: "the title's action row",
      backing: "platform-affordance",
      label: "Share",
      detail: "The OS share sheet carrying the canonical link — the Desktop platform's own share affordance.",
    },
    {
      kind: "feedback",
      placement: "the card/player feedback menu",
      backing: "shared-surface",
      label: "Feedback",
      detail:
        "The recommendation feedback you already know — More like this, Not interested, and the rest of the same vocabulary.",
    },
  ];
  // THE TRANSLATE ROW (R25-G — the player-local language control, added
  // with the R25 parity decision): the honest per-rung truth. The
  // WebFlix-owned rungs (native + browser) offer the realtime session
  // through the authorized capture paths; the provider's contained
  // surfaces keep their own captions — never a capture, never a bypass.
  const translateRow: PlayerAffordanceView =
    mode === "native" || mode === "browser"
      ? {
          kind: "translate",
          placement: "the settings cluster's language group",
          backing: "shared-surface",
          label: "Translate",
          detail:
            "Realtime translation through the shared session seam — the authorized capture paths (local files, authorized torrent copies, controlled live input); the original audio always stays available.",
        }
      : {
          kind: "translate",
          placement: "the settings cluster's language group",
          backing: "realization-exposed",
          label: "Translate",
          detail:
            "This way of watching plays inside the provider's own player — prefer its own captions/transcripts, or translate a subtitle file you provide; WebFlix never captures protected provider media. On WebFlix-owned ways of watching (local, torrent, live) the Translate control runs the realtime session.",
        };
  return [...transport, ...rungSettings, ...shared, translateRow];
}

/**
 * THE HONEST-ABSENCE LAW, projected: the cast affordance on this platform.
 * Answers the honest view (never a dead button) when the platform declares
 * no cast sink, and the honest cast view when a future platform adds one.
 */
export function castAffordanceOf(
  capabilities: Pick<PlatformCapabilities, "platform">,
  casting: boolean,
): { readonly available: false; readonly detail: string } | { readonly available: true; readonly detail: string } {
  if (!casting) {
    return {
      available: false,
      detail:
        capabilities.platform === "desktop"
          ? "This Desktop build declares no cast sink — no cast control is shown rather than a button that cannot cast; the honest second-screen path is continuing on another device."
          : "This platform declares no cast sink — no cast control is shown rather than a button that cannot cast.",
    };
  }
  return {
    available: true,
    detail: "This platform can hand playback to a cast sink — the control appears where the platform truthfully supports it.",
  };
}

// ---------------------------------------------------------------------------
// The keyboard grammar (the familiar viewer keyboard map)
// ---------------------------------------------------------------------------

/** One typed player command (the keyboard grammar's output). */
export type PlayerCommand =
  | { readonly kind: "toggle-play-pause" }
  | { readonly kind: "seek"; readonly deltaMs: number }
  | { readonly kind: "seek-percent"; readonly percent: number }
  | { readonly kind: "step-volume"; readonly direction: 1 | -1 }
  | { readonly kind: "toggle-mute" }
  | { readonly kind: "toggle-fullscreen" }
  | { readonly kind: "exit-fullscreen" }
  | { readonly kind: "toggle-miniplayer" }
  | { readonly kind: "toggle-captions" }
  | { readonly kind: "toggle-transcript" }
  | { readonly kind: "toggle-autoplay" }
  | { readonly kind: "stop" };

/** What executes one command kind (the backing discipline, per command). */
export type PlayerCommandBacking =
  | "runtime-command"
  | "platform-affordance"
  | "realization-exposed"
  | "view-state"
  | "not-exposed-yet";

/** The backing + honest detail for one command kind. */
export const PLAYER_COMMAND_BACKING: Readonly<
  Record<PlayerCommand["kind"], { readonly backing: PlayerCommandBacking; readonly detail: string }>
> = {
  "toggle-play-pause": {
    backing: "runtime-command",
    detail: "The controller's play/pause — Space or K, the keys viewers already know.",
  },
  seek: {
    backing: "runtime-command",
    detail: "The controller's typed seek — J/L for ten seconds, the arrow keys for five.",
  },
  "seek-percent": {
    backing: "runtime-command",
    detail: "The controller's typed seek — number keys jump to that tenth of the video.",
  },
  "step-volume": {
    backing: "not-exposed-yet",
    detail: "Volume is not exposed on the native rung yet — the device volume is the honest path.",
  },
  "toggle-mute": {
    backing: "not-exposed-yet",
    detail: "Mute is not exposed on the native rung yet — the device volume is the honest path.",
  },
  "toggle-fullscreen": {
    backing: "platform-affordance",
    detail: "The app window's own fullscreen state — F enters, Escape leaves.",
  },
  "exit-fullscreen": {
    backing: "platform-affordance",
    detail: "The app window's own fullscreen state — Escape leaves fullscreen.",
  },
  "toggle-miniplayer": {
    backing: "platform-affordance",
    detail: "The window's picture-in-picture state — I toggles the miniplayer.",
  },
  "toggle-captions": {
    backing: "view-state",
    detail: "The captions panel's visibility — C toggles captions over the shared subtitle paths.",
  },
  "toggle-transcript": {
    backing: "view-state",
    detail: "The transcript panel's visibility — T toggles the transcript side panel.",
  },
  "toggle-autoplay": {
    backing: "view-state",
    detail: "The session's autoplay choice — the toggle on the Up-next card.",
  },
  stop: {
    backing: "runtime-command",
    detail: "The controller's stop — closes the session honestly and records the watch state.",
  },
};

/** One keyboard binding (the grammar's table row, user-visible). */
export interface PlayerKeyboardBinding {
  /** The canonical key name (the KeyboardEvent.key vocabulary). */
  readonly key: string;
  /** The command the key issues. */
  readonly command: PlayerCommand;
  /** The one-line description the keyboard-shortcut sheet renders. */
  readonly description: string;
}

/** The seek step the arrow keys take (the familiar five seconds). */
export const KEYBOARD_SEEK_STEP_MS = 5_000;
/** The seek step J/L take (the familiar ten seconds). */
export const KEYBOARD_SEEK_JUMP_MS = 10_000;

/**
 * THE KEYBOARD GRAMMAR (the familiar viewer map — interaction grammar, not
 * branding): Space/K play-pause, J/L and arrows seek, 0-9 percent-jump,
 * M mute, F fullscreen, Escape exits, I miniplayer, C captions, T
 * transcript. Unbound keys answer null — never a guess.
 */
export const PLAYER_KEYBOARD_BINDINGS: readonly PlayerKeyboardBinding[] = [
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
  { key: "i", command: { kind: "toggle-miniplayer" }, description: "Miniplayer" },
  { key: "c", command: { kind: "toggle-captions" }, description: "Captions" },
  { key: "t", command: { kind: "toggle-transcript" }, description: "Transcript" },
  { key: "0", command: { kind: "seek-percent", percent: 0 }, description: "Jump to the start" },
  { key: "1", command: { kind: "seek-percent", percent: 10 }, description: "Jump to 10%" },
  { key: "2", command: { kind: "seek-percent", percent: 20 }, description: "Jump to 20%" },
  { key: "3", command: { kind: "seek-percent", percent: 30 }, description: "Jump to 30%" },
  { key: "4", command: { kind: "seek-percent", percent: 40 }, description: "Jump to 40%" },
  { key: "5", command: { kind: "seek-percent", percent: 50 }, description: "Jump to 50%" },
  { key: "6", command: { kind: "seek-percent", percent: 60 }, description: "Jump to 60%" },
  { key: "7", command: { kind: "seek-percent", percent: 70 }, description: "Jump to 70%" },
  { key: "8", command: { kind: "seek-percent", percent: 80 }, description: "Jump to 80%" },
  { key: "9", command: { kind: "seek-percent", percent: 90 }, description: "Jump to 90%" },
];

/**
 * Parse one keyboard event into the typed player command (pure; the
 * webview's key listener calls this). Unbound keys and modified combos
 * (Ctrl/Cmd/Alt/Meta — the OS and screen-reader chords stay theirs)
 * answer `null` — the grammar never guesses.
 */
export function playerKeyboardCommandOf(event: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}): PlayerCommand | null {
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;
  const binding = PLAYER_KEYBOARD_BINDINGS.find((candidate) => candidate.key === event.key);
  return binding !== undefined ? binding.command : null;
}

// ---------------------------------------------------------------------------
// The command execution (the transport subset routes to the controller)
// ---------------------------------------------------------------------------

/** The typed outcome of one player command execution. */
export type PlayerCommandOutcome =
  | { readonly kind: "executed"; readonly detail: string }
  | {
      readonly kind: "unsupported";
      readonly reason: "not-exposed-on-rung" | "no-active-session";
      readonly detail: string;
    }
  | { readonly kind: "failed"; readonly detail: string };

/**
 * Execute one typed player command against the active playback session.
 * ONLY the transport subset routes to the controller (play/pause, seek,
 * stop — the runtime's own commands); the volume/mute commands answer the
 * honest not-exposed truth on the native rung; the panel/platform
 * commands answer their backing truth (the view/shell executes them —
 * this function never fakes their effect).
 */
export async function executePlayerCommand(
  command: PlayerCommand,
  input: {
    readonly controller?: PlaybackController;
    readonly state?: PlaybackState;
  },
): Promise<PlayerCommandOutcome> {
  const { controller, state } = input;
  switch (command.kind) {
    case "toggle-play-pause": {
      if (controller === undefined) {
        return { kind: "unsupported", reason: "no-active-session", detail: "Nothing is playing yet." };
      }
      const phase = controller.state().phase;
      if (phase === "playing") {
        const result = await controller.pause();
        return result.ok
          ? { kind: "executed", detail: "Paused." }
          : { kind: "failed", detail: result.detail };
      }
      const result = await controller.play();
      return result.ok
        ? { kind: "executed", detail: "Playing." }
        : { kind: "failed", detail: result.detail };
    }
    case "seek":
    case "seek-percent": {
      if (controller === undefined || state === undefined) {
        return { kind: "unsupported", reason: "no-active-session", detail: "Nothing is playing yet." };
      }
      if (command.kind === "seek-percent" && state.durationMs === undefined) {
        // The honest no-duration answer: the percent jump needs duration
        // evidence (the registry's own truth) — the relative jumps still
        // work, and this never guesses a target.
        return {
          kind: "unsupported",
          reason: "not-exposed-on-rung",
          detail:
            "This video's duration isn't known yet, so the percent jump can't pick a spot — the second-by-second jumps work, and the percent jump appears once the duration is known.",
        };
      }
      const targetMs =
        command.kind === "seek"
          ? state.positionMs + command.deltaMs
          : Math.round(((state.durationMs ?? 0) * command.percent) / 100);
      const clamped = Math.max(0, Math.min(targetMs, state.durationMs ?? Number.MAX_SAFE_INTEGER));
      const result = await controller.seek(clamped);
      return result.ok
        ? { kind: "executed", detail: `Seeked to ${Math.round(clamped / 1000)}s.` }
        : { kind: "failed", detail: result.detail };
    }
    case "stop": {
      if (controller === undefined) {
        return { kind: "unsupported", reason: "no-active-session", detail: "Nothing is playing yet." };
      }
      const result = await controller.stop();
      return result.ok
        ? { kind: "executed", detail: "Stopped — your place is kept." }
        : { kind: "failed", detail: result.detail };
    }
    case "step-volume":
    case "toggle-mute": {
      const backing = PLAYER_COMMAND_BACKING[command.kind];
      return {
        kind: "unsupported",
        reason: "not-exposed-on-rung",
        detail: backing.detail,
      };
    }
    case "toggle-fullscreen":
    case "exit-fullscreen":
    case "toggle-miniplayer":
    case "toggle-captions":
    case "toggle-transcript":
    case "toggle-autoplay": {
      // The platform/view layer executes these (the window state, the panel
      // visibility, the session autoplay choice). This function answers the
      // backing truth — never a fabricated execution.
      return { kind: "executed", detail: PLAYER_COMMAND_BACKING[command.kind].detail };
    }
  }
}

// ---------------------------------------------------------------------------
// The scrub model (direct-manipulation seek over truthful evidence)
// ---------------------------------------------------------------------------

/** One chapter marker on the scrub bar (the artifact's own truth). */
export interface PlayerChapterMarker {
  readonly title: string;
  readonly startMs: number;
}

/**
 * The scrub model: the direct-manipulation seek surface over ONE playback
 * state's truthful evidence. `positionMs`/`bufferedMs`/`durationMs` are the
 * runtime's own numbers (never a ticker, never a guess); the chapters are
 * the artifact's own markers when present.
 */
export interface PlayerScrubModel {
  readonly positionMs: number;
  readonly bufferedMs: number;
  readonly durationMs: number | undefined;
  readonly chapters: readonly PlayerChapterMarker[];
  /** The session's mode (the honest per-rung scrub truth). */
  readonly mode: PlaybackMode;
}

/** Derive the scrub model from one playback state (+ optional chapters). */
export function playerScrubModelOf(
  state: PlaybackState,
  chapters: readonly PlayerChapterMarker[] = [],
): PlayerScrubModel {
  return {
    positionMs: state.positionMs,
    bufferedMs: state.bufferedMs,
    durationMs: state.durationMs,
    chapters: [...chapters],
    mode: state.mode,
  };
}

/** The scrub-preview view (what the scrub thumb shows at one target). */
export interface PlayerScrubPreview {
  readonly targetMs: number;
  /** The chapter the target lands in (the honest chapter-at-time answer). */
  readonly chapter: PlayerChapterMarker | null;
  /** The preview label (the time + the chapter title when present). */
  readonly label: string;
}

/** The scrub preview at one target position (pure). */
export function playerScrubPreview(model: PlayerScrubModel, targetMs: number): PlayerScrubPreview {
  const duration = model.durationMs ?? 0;
  const clamped = Math.max(0, Math.min(targetMs, duration > 0 ? duration : targetMs));
  // The chapter the target lands in: the LAST marker starting at/before the
  // target (the current chapter, not the first).
  let chapter: PlayerChapterMarker | null = null;
  for (const marker of model.chapters) {
    if (marker.startMs <= clamped) chapter = marker;
    else break;
  }
  const time = formatPlaybackTime(clamped);
  return {
    targetMs: clamped,
    chapter,
    label: chapter !== null ? `${time} — ${chapter.title}` : time,
  };
}

/**
 * The scrub TRUTH at one target: playable when the target sits inside the
 * verified runway (or behind the current position); the honest
 * needs-verified-range answer when it does not — the peer-copy-in-progress
 * law (the engine must fetch that part first; the player says so, never
 * fakes the jump).
 */
export function playerScrubPlayability(
  model: PlayerScrubModel,
  targetMs: number,
):
  | { readonly kind: "playable"; readonly detail: string }
  | { readonly kind: "needs-verified-range"; readonly detail: string } {
  const runwayEnd = model.positionMs + model.bufferedMs;
  if (targetMs <= runwayEnd || model.mode !== "native") {
    return { kind: "playable", detail: "That part is ready to play." };
  }
  const gapSeconds = Math.round((targetMs - runwayEnd) / 1000);
  return {
    kind: "needs-verified-range",
    detail: `That part isn't fetched yet — this copy plays as it arrives, so jumping ${gapSeconds}s ahead needs about that much of the video to download first.`,
  };
}

/** Format a playback time as the familiar m:ss / h:mm:ss label. */
export function formatPlaybackTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

// ---------------------------------------------------------------------------
// The autoplay law (derived from the attention policy — never a raw switch)
// ---------------------------------------------------------------------------

/** The attention mode vocabulary (the frozen policy's own union). */
export type PlayerAttentionMode = "mindful" | "balanced" | "immersive" | "custom";

/** The autoplay affordance's projected truth for one attention mode. */
export interface PlayerAutoplayView {
  readonly kind: "autoplay";
  /** The session default the policy derives (the honest derivation). */
  readonly enabledByDefault: boolean;
  readonly label: string;
  readonly detail: string;
}

/**
 * THE AUTOPLAY LAW: the autoplay toggle derives from the attention policy
 * — mindful keeps autoplay off (the user chose restraint), balanced keeps
 * the familiar default on, immersive stays on, and custom answers the
 * user's explicit choice (off until they choose otherwise — never a
 * silent maximize-time-on behavior). This is the Desktop projection of
 * the SHARED policy's semantics; the shared autoplay seam is Worker 1's
 * R24-A contract (the reconciliation is an recorded escalation).
 */
export function playerAutoplayAffordanceOf(mode: PlayerAttentionMode): PlayerAutoplayView {
  switch (mode) {
    case "mindful":
      return {
        kind: "autoplay",
        enabledByDefault: false,
        label: "Autoplay",
        detail: "Autoplay is off because your attention mode is Mindful — turn it on for this session if you want it.",
      };
    case "balanced":
      return {
        kind: "autoplay",
        enabledByDefault: true,
        label: "Autoplay",
        detail: "Autoplay is on, as the Balanced default — turn it off for this session any time.",
      };
    case "immersive":
      return {
        kind: "autoplay",
        enabledByDefault: true,
        label: "Autoplay",
        detail: "Autoplay is on because your attention mode is Immersive — turn it off for this session any time.",
      };
    case "custom":
      return {
        kind: "autoplay",
        enabledByDefault: false,
        label: "Autoplay",
        detail: "Autoplay follows your custom attention policy — it stays off until you turn it on for a session.",
      };
  }
}

// ---------------------------------------------------------------------------
// The session queue + the up-next projection
// ---------------------------------------------------------------------------

/** One session-queue entry's view (the ordered truth). */
export interface PlayerQueueEntryView {
  readonly position: number;
  readonly itemId: string;
  readonly title: string;
}

/** The typed outcome of one queue play-through. */
export type PlayerQueuePlayOutcome =
  | {
      readonly kind: "started";
      readonly entry: PlayerQueueEntryView;
      readonly detail: string;
    }
  | { readonly kind: "empty"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

/** The typed outcome of one save-queue-to-watchlist pass. */
export interface PlayerQueueSaveOutcome {
  readonly saved: readonly { readonly itemId: string; readonly ok: boolean }[];
  readonly detail: string;
}

/**
 * THE SESSION QUEUE (the familiar queue grammar, session-scoped): an
 * ordered list of canonical items whose play-through delegates to the
 * composition's own play actions (the SAME actions the primary play
 * performs — the queue owns ordering only, never playback rules), with
 * save-queue-to-watchlist as the Library bridge (every write is the
 * runtime's own library operation). The queue is NOT durable state: it is
 * the session's order, the watchlist is the durable save.
 */
export interface DesktopPlayerSessionQueue {
  /** Enqueue one item (deduplicated — the same item never queues twice). */
  enqueue(input: { readonly itemId: string; readonly title: string }): PlayerQueueEntryView;
  /** Remove one queued item (typed absent answer when not queued). */
  remove(itemId: string): { readonly removed: boolean; readonly view: readonly PlayerQueueEntryView[] };
  /** Move one queued item to a position (the reorder grammar; typed bounds). */
  move(itemId: string, toPosition: number): { readonly moved: boolean; readonly view: readonly PlayerQueueEntryView[] };
  /** The ordered view. */
  view(): readonly PlayerQueueEntryView[];
  /**
   * THE PLAY-THROUGH: play the head item through the composition's own
   * play action, remove it from the queue, and answer the typed outcome.
   */
  playNext(input: {
    readonly play: (entry: PlayerQueueEntryView) => Promise<{ readonly ok: boolean; readonly detail: string }>;
  }): Promise<PlayerQueuePlayOutcome>;
  /**
   * THE LIBRARY BRIDGE: save every queued item into the watchlist through
   * the runtime's own library write (the durable path — one save per item,
   * honestly reported per item).
   */
  saveQueueToWatchlist(): Promise<PlayerQueueSaveOutcome>;
}

/** Options for the session queue. */
export interface DesktopPlayerSessionQueueOptions {
  /** The shared runtime (the watchlist writes' own operations). */
  readonly runtime: ClientRuntime;
}

/** Create the session queue (the composition's play actions drive it). */
export function createDesktopPlayerSessionQueue(
  options: DesktopPlayerSessionQueueOptions,
): DesktopPlayerSessionQueue {
  const { runtime } = options;
  const entries: { itemId: string; title: string }[] = [];

  const view = (): readonly PlayerQueueEntryView[] =>
    entries.map((entry, index) => ({ position: index + 1, itemId: entry.itemId, title: entry.title }));

  return {
    enqueue(input: { readonly itemId: string; readonly title: string }): PlayerQueueEntryView {
      const existing = entries.find((entry) => entry.itemId === input.itemId);
      if (existing !== undefined) {
        const position = entries.indexOf(existing) + 1;
        return { position, itemId: existing.itemId, title: existing.title };
      }
      entries.push({ itemId: input.itemId, title: input.title });
      return { position: entries.length, itemId: input.itemId, title: input.title };
    },

    remove(itemId: string): { readonly removed: boolean; readonly view: readonly PlayerQueueEntryView[] } {
      const index = entries.findIndex((entry) => entry.itemId === itemId);
      if (index === -1) return { removed: false, view: view() };
      entries.splice(index, 1);
      return { removed: true, view: view() };
    },

    move(itemId: string, toPosition: number): { readonly moved: boolean; readonly view: readonly PlayerQueueEntryView[] } {
      const index = entries.findIndex((entry) => entry.itemId === itemId);
      if (index === -1) return { moved: false, view: view() };
      const target = Math.max(0, Math.min(toPosition - 1, entries.length - 1));
      const [entry] = entries.splice(index, 1);
      entries.splice(target, 0, entry!);
      return { moved: true, view: view() };
    },

    view(): readonly PlayerQueueEntryView[] {
      return view();
    },

    async playNext(input: {
      readonly play: (entry: PlayerQueueEntryView) => Promise<{ readonly ok: boolean; readonly detail: string }>;
    }): Promise<PlayerQueuePlayOutcome> {
      const head = entries[0];
      if (head === undefined) {
        return { kind: "empty", detail: "The queue is empty — things you add play in order." };
      }
      const headView: PlayerQueueEntryView = { position: 1, itemId: head.itemId, title: head.title };
      const result = await input.play(headView);
      if (!result.ok) {
        return { kind: "failed", detail: result.detail };
      }
      entries.shift();
      return { kind: "started", entry: headView, detail: result.detail };
    },

    async saveQueueToWatchlist(): Promise<PlayerQueueSaveOutcome> {
      if (entries.length === 0) {
        return { saved: [], detail: "The queue is empty — nothing to save yet." };
      }
      const saved: { itemId: string; ok: boolean }[] = [];
      for (const entry of [...entries]) {
        const result = await runtime.libraryOps.save({ itemId: entry.itemId });
        saved.push({ itemId: entry.itemId, ok: result.ok });
      }
      const okCount = saved.filter((item) => item.ok).length;
      return {
        saved,
        detail:
          okCount === saved.length
            ? `Saved ${okCount} of ${saved.length} to your Library — they stay in the queue for this session too.`
            : `Saved ${okCount} of ${saved.length} to your Library — the ones that failed stayed honest (nothing silently succeeded).`,
      };
    },
  };
}

/** The up-next view (the queue's head + the autoplay truth). */
export interface PlayerUpNextView {
  readonly kind: "up-next";
  /** The head entry (null when the queue is empty — honestly absent). */
  readonly next: PlayerQueueEntryView | null;
  /** The autoplay truth (the policy-derived default + the session choice). */
  readonly autoplay: PlayerAutoplayView;
  readonly detail: string;
}

/** Project the up-next card (the queue head + the autoplay truth). */
export function playerUpNextView(
  queue: readonly PlayerQueueEntryView[],
  autoplay: PlayerAutoplayView,
  sessionAutoplayEnabled: boolean,
): PlayerUpNextView {
  const next = queue[0] ?? null;
  return {
    kind: "up-next",
    next,
    autoplay,
    detail:
      next !== null
        ? sessionAutoplayEnabled
          ? `Up next: ${next.title} — it plays automatically when this one ends.`
          : `Up next: ${next.title}.`
        : "Nothing is queued — anything you add shows up here.",
  };
}

// ---------------------------------------------------------------------------
// The composed surface (the composition root's one binding)
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopPlayerAffordanceSurface}. */
export interface DesktopPlayerAffordanceOptions {
  /** The shared runtime (the transport commands' own executor). */
  readonly runtime: ClientRuntime;
  /** The truthful Desktop capability bundle. */
  readonly capabilities: PlatformCapabilities;
  /**
   * The cast-sink truth (the adapter's own device-capability derivation —
   * `desktopDeviceCapabilities().casting`; the reference Desktop answers
   * false honestly).
   */
  readonly casting: boolean;
}

/** The Desktop player-affordance surface (the native-parity projection). */
export interface DesktopPlayerAffordanceSurface {
  /** The affordance map for one realization mode (the control-placement truth). */
  affordances(mode: PlaybackMode): readonly PlayerAffordanceView[];
  /** The cast affordance's honest truth (the honest-absence law). */
  castAffordance(): ReturnType<typeof castAffordanceOf>;
  /** The keyboard grammar (the binding table the shortcut sheet renders). */
  keyboardBindings(): readonly PlayerKeyboardBinding[];
  /** Parse one key event into the typed command (null when unbound). */
  keyboardCommandOf(event: {
    readonly key: string;
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly altKey?: boolean;
  }): PlayerCommand | null;
  /**
   * Execute one typed command against the ACTIVE session (newest live
   * controller when the caller does not pin one). The transport subset
   * routes to the controller; the rest answer their backing truth.
   */
  execute(
    command: PlayerCommand,
    input?: { readonly sessionId?: string },
  ): Promise<PlayerCommandOutcome>;
  /** The scrub model for one active session (null when unknown). */
  scrubModel(sessionId: string, chapters?: readonly PlayerChapterMarker[]): PlayerScrubModel | null;
  /** The autoplay truth for the CURRENT attention policy (the policy-derived view). */
  autoplayAffordance(mode: PlayerAttentionMode): PlayerAutoplayView;
  /** The session queue (the familiar queue grammar, session-scoped). */
  readonly queue: DesktopPlayerSessionQueue;
  /** The up-next view (the queue head + the autoplay truth). */
  upNext(autoplay: PlayerAutoplayView, sessionAutoplayEnabled: boolean): PlayerUpNextView;
}

/**
 * Project the Desktop player-affordance surface over the shared runtime.
 * Pure projection + composition: the transport commands are the runtime's
 * own, the queue's writes are the runtime's own, the autoplay truth
 * derives from the shared policy, the cast truth is the adapter's own
 * capability declaration — ZERO new product policy (the adapter layering
 * law; the shared autoplay/queue seams are Worker 1's R24-A contracts,
 * recorded as the reconciliation escalation).
 */
export function createDesktopPlayerAffordanceSurface(
  options: DesktopPlayerAffordanceOptions,
): DesktopPlayerAffordanceSurface {
  const { runtime, capabilities, casting } = options;
  const queue = createDesktopPlayerSessionQueue({ runtime });

  return {
    affordances(mode: PlaybackMode): readonly PlayerAffordanceView[] {
      return playerAffordanceMap(mode);
    },

    castAffordance(): ReturnType<typeof castAffordanceOf> {
      return castAffordanceOf(capabilities, casting);
    },

    keyboardBindings(): readonly PlayerKeyboardBinding[] {
      return [...PLAYER_KEYBOARD_BINDINGS];
    },

    keyboardCommandOf(event: {
      readonly key: string;
      readonly ctrlKey?: boolean;
      readonly metaKey?: boolean;
      readonly altKey?: boolean;
    }): PlayerCommand | null {
      return playerKeyboardCommandOf(event);
    },

    async execute(
      command: PlayerCommand,
      input?: { readonly sessionId?: string },
    ): Promise<PlayerCommandOutcome> {
      const controller =
        input?.sessionId !== undefined
          ? runtime.playback.controller(input.sessionId)
          : runtime.playback.active()[0] !== undefined
            ? runtime.playback.controller(runtime.playback.active()[0]!.sessionId)
            : undefined;
      const state = controller?.state();
      return executePlayerCommand(command, {
        ...(controller !== undefined ? { controller } : {}),
        ...(state !== undefined ? { state } : {}),
      });
    },

    scrubModel(sessionId: string, chapters: readonly PlayerChapterMarker[] = []): PlayerScrubModel | null {
      const state = runtime.playback.controller(sessionId)?.state();
      return state !== undefined ? playerScrubModelOf(state, chapters) : null;
    },

    autoplayAffordance(mode: PlayerAttentionMode): PlayerAutoplayView {
      return playerAutoplayAffordanceOf(mode);
    },

    queue,

    upNext(autoplay: PlayerAutoplayView, sessionAutoplayEnabled: boolean): PlayerUpNextView {
      return playerUpNextView(queue.view(), autoplay, sessionAutoplayEnabled);
    },
  };
}
