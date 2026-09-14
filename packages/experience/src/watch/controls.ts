/**
 * @wfx/experience — playback control descriptors (WFX-027, Lane C).
 *
 * The quality/audio/subtitle control DESCRIPTORS of the Watch Feed
 * (docs/architecture/webflix-frozen-architecture.md, "Experience modes"):
 * a typed `PlaybackControlSet` generated from the realization + the device
 * profile. Providers DECLARE tracks and tiers; this model COMPOSES the
 * declarations — it never probes a stream, never enumerates a player, never
 * fabricates an option.
 *
 * Capability honesty (the frozen invariant 10 — "no hidden mocks; claimed
 * provider capability must be real or explicitly unsupported"):
 *
 * - `native` mode is the ONLY mode where WebFlix controls the media path
 *   (frozen precedence step 1's own words). There — and only there — the
 *   descriptor exposes the DECLARED quality tiers (filtered by what the
 *   device profile can decode) and the DECLARED audio/subtitle tracks.
 * - `embed`, `browser`, and `external` modes render through a provider-owned
 *   player / web surface / OS handoff. WebFlix cannot guarantee programmatic
 *   quality/track control through those pipelines, so every control is
 *   TYPED-ABSENT with an explicit reason — never a greyed-out lie, never a
 *   fabricated selector over a pipeline this model does not own.
 * - An empty declaration on a native realization is an HONEST absence
 *   (`available: false`, reason names it), not an empty success.
 *
 * Where declarations come from: the frozen `PlaybackRealization.capabilities`
 * is a free-form string array that cannot carry structured tier/track data.
 * Providers therefore declare control data through
 * `RealizationControlDeclaration` — the host derives it from connector
 * metadata (the same structural-typing forward-compatibility law the
 * WFX-025 request module uses for availability claims). This model composes
 * what was declared; nothing more.
 *
 * Determinism: pure function of the input; no I/O, no probing, no globals.
 * Malformed input throws the typed `ExperienceError` (caller misuse).
 */

import type {
  DeviceCapabilities,
  PlaybackMode,
  PlaybackRealization,
} from "@wfx/domain";
import {
  PLAYBACK_MODES,
  canPlay,
  isRecord,
  previewValue,
  validatePlaybackRealization,
} from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// Declared option types (providers declare; this model composes)
// ---------------------------------------------------------------------------

/** One declared quality tier of a realization. */
export interface QualityTier {
  /** Stable tier id (e.g. `"1080p"`). */
  id: string;
  /** Human-readable tier label (e.g. `"Full HD"`). */
  label: string;
  /** Vertical resolution in pixels (e.g. 1080). */
  heightPx: number;
  /** Required video codec, when declared (matched against the device profile). */
  codec?: string;
  /** Average bitrate in kbps, when declared. */
  bitrateKbps?: number;
}

/** The audio-track kinds (closed vocabulary). */
export type AudioTrackKind = "original" | "dubbed" | "descriptive" | "commentary";

/** Every `AudioTrackKind`, in union order. */
export const AUDIO_TRACK_KINDS: readonly AudioTrackKind[] = [
  "original",
  "dubbed",
  "descriptive",
  "commentary",
];

/** One declared audio track. */
export interface AudioTrack {
  /** Stable track id. */
  id: string;
  /** BCP-47 language tag (e.g. `"en"`, `"es-419"`). */
  language: string;
  /** Human-readable track label. */
  label: string;
  kind: AudioTrackKind;
  /** Audio codec, when declared. */
  codec?: string;
}

/** The subtitle-track kinds (closed vocabulary). */
export type SubtitleTrackKind = "subtitles" | "captions" | "sdh" | "forced";

/** Every `SubtitleTrackKind`, in union order. */
export const SUBTITLE_TRACK_KINDS: readonly SubtitleTrackKind[] = [
  "subtitles",
  "captions",
  "sdh",
  "forced",
];

/** One declared subtitle track. */
export interface SubtitleTrack {
  /** Stable track id. */
  id: string;
  /** BCP-47 language tag. */
  language: string;
  /** Human-readable track label. */
  label: string;
  kind: SubtitleTrackKind;
}

// ---------------------------------------------------------------------------
// The descriptor shape (typed-absent, never greyed-out lies)
// ---------------------------------------------------------------------------

/** One excluded option with the reason it was excluded. */
export interface ControlExclusion {
  id: string;
  reason: string;
}

/**
 * One control of a `PlaybackControlSet`: either SELECTABLE with exactly the
 * options the realization supports (plus any device-profile exclusions with
 * reasons), or TYPED-ABSENT with an explicit reason. There is no third
 * "disabled but shown" state — an unavailable control is absent from the
 * descriptor, never a greyed-out lie.
 */
export type ControlDescriptor<T> =
  | { available: true; options: readonly T[]; excluded: readonly ControlExclusion[] }
  | { available: false; reason: string };

/** The typed control set of one realization on one device. */
export interface PlaybackControlSet {
  /** The realization mode the set was built for. */
  mode: PlaybackMode;
  quality: ControlDescriptor<QualityTier>;
  audio: ControlDescriptor<AudioTrack>;
  subtitles: ControlDescriptor<SubtitleTrack>;
}

// ---------------------------------------------------------------------------
// The declaration input
// ---------------------------------------------------------------------------

/**
 * The provider-declared control data for ONE realization: quality tiers and
 * audio/subtitle tracks as the provider reported them. Absent arrays are
 * honest absences (nothing declared) — never coerced into empty successes.
 */
export interface RealizationControlDeclaration {
  qualityTiers?: readonly QualityTier[];
  audioTracks?: readonly AudioTrack[];
  subtitleTracks?: readonly SubtitleTrack[];
}

/** The builder input bundle. */
export interface PlaybackControlInput {
  realization: PlaybackRealization;
  device: DeviceCapabilities;
  declaration: RealizationControlDeclaration;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function deviceProblems(device: unknown): string[] {
  if (!isRecord(device)) {
    return [`input.device: expected a DeviceCapabilities object, got ${previewValue(device)}`];
  }
  const problems: string[] = [];
  if (
    !Array.isArray(device.playbackModes) ||
    !device.playbackModes.every(
      (mode) => typeof mode === "string" && (PLAYBACK_MODES as readonly string[]).includes(mode),
    )
  ) {
    problems.push(
      `input.device.playbackModes: expected an array of PlaybackMode values (${PLAYBACK_MODES.join(" | ")}), got ${previewValue(device.playbackModes)}`,
    );
  }
  if (
    !Array.isArray(device.codecs) ||
    !device.codecs.every((codec) => typeof codec === "string" && codec.length > 0)
  ) {
    problems.push(
      `input.device.codecs: expected an array of non-empty codec strings, got ${previewValue(device.codecs)}`,
    );
  }
  return problems;
}

function declarationProblems(declaration: unknown): string[] {
  if (!isRecord(declaration)) {
    return [
      `input.declaration: expected a RealizationControlDeclaration object, got ${previewValue(declaration)}`,
    ];
  }
  const problems: string[] = [];
  if (
    declaration.qualityTiers !== undefined &&
    !Array.isArray(declaration.qualityTiers)
  ) {
    problems.push(
      `input.declaration.qualityTiers: expected an array of QualityTier when present, got ${previewValue(declaration.qualityTiers)}`,
    );
  }
  if (declaration.audioTracks !== undefined && !Array.isArray(declaration.audioTracks)) {
    problems.push(
      `input.declaration.audioTracks: expected an array of AudioTrack when present, got ${previewValue(declaration.audioTracks)}`,
    );
  }
  if (declaration.subtitleTracks !== undefined && !Array.isArray(declaration.subtitleTracks)) {
    problems.push(
      `input.declaration.subtitleTracks: expected an array of SubtitleTrack when present, got ${previewValue(declaration.subtitleTracks)}`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the typed `PlaybackControlSet` for one realization on one device.
 *
 * Laws (see the module doc): native ⇒ the full DECLARED set (quality tiers
 * filtered by the device's decodable codecs, each exclusion reasoned);
 * embed/browser/external ⇒ every control typed-absent with the
 * pipeline-ownership reason. A native realization on a device that cannot
 * realize native playback at all is fully absent with the device reason.
 * Malformed input throws the typed `ExperienceError`.
 */
export function buildPlaybackControlSet(input: PlaybackControlInput): PlaybackControlSet {
  if (!isRecord(input)) {
    throw new ExperienceError("input: expected a PlaybackControlInput object");
  }
  const problems: string[] = [
    ...deviceProblems(input.device),
    ...declarationProblems(input.declaration),
  ];
  const realizationCheck = validatePlaybackRealization(input.realization);
  if (!realizationCheck.ok) {
    throw new ExperienceError([
      ...realizationCheck.errors.map((message) => `input.realization: ${message}`),
      ...problems,
    ]);
  }
  if (problems.length > 0) throw new ExperienceError(problems);

  const realization = realizationCheck.value;
  const mode = realization.mode;
  const declaration = input.declaration;

  // Non-native modes: the provider surface owns the pipeline — typed-absent.
  if (mode !== "native") {
    const ownership: Record<Exclude<PlaybackMode, "native">, string> = {
      embed: "the provider's embedded player owns quality, audio, and subtitle controls",
      browser: "the in-app browser surface owns playback controls",
      external: "external handoff delegates playback to the provider",
    };
    const reason = `${ownership[mode]} — WebFlix does not fabricate control over a provider-owned pipeline`;
    return {
      mode,
      quality: { available: false, reason },
      audio: { available: false, reason },
      subtitles: { available: false, reason },
    };
  }

  // Native mode, but the device cannot realize native playback at all.
  if (!canPlay(input.device, "native")) {
    const reason =
      "device cannot realize native playback (canPlay=false) — no native control surface exists on this device";
    return {
      mode,
      quality: { available: false, reason },
      audio: { available: false, reason },
      subtitles: { available: false, reason },
    };
  }

  // Native mode on a capable device: compose the DECLARED data honestly.
  const decodable = new Set(input.device.codecs.map((codec) => codec.toLowerCase()));

  // --- quality tiers (device-codec filtered) --------------------------------
  const declaredTiers = declaration.qualityTiers ?? [];
  const tierProblems: string[] = [];
  for (const tier of declaredTiers) {
    const prefix = `input.declaration.qualityTiers['${String(tier.id)}']`;
    if (!isNonEmptyString(tier.id)) {
      tierProblems.push(`${prefix}: id: expected a non-empty string, got ${previewValue(tier.id)}`);
    }
    if (!isNonEmptyString(tier.label)) {
      tierProblems.push(`${prefix}: label: expected a non-empty string, got ${previewValue(tier.label)}`);
    }
    if (!isPositiveFinite(tier.heightPx)) {
      tierProblems.push(
        `${prefix}: heightPx: expected a finite positive number, got ${previewValue(tier.heightPx)}`,
      );
    }
    if (tier.codec !== undefined && !isNonEmptyString(tier.codec)) {
      tierProblems.push(
        `${prefix}: codec: expected a non-empty string when present, got ${previewValue(tier.codec)}`,
      );
    }
    if (tier.bitrateKbps !== undefined && !isNonNegativeFinite(tier.bitrateKbps)) {
      tierProblems.push(
        `${prefix}: bitrateKbps: expected a finite non-negative number when present, got ${previewValue(tier.bitrateKbps)}`,
      );
    }
  }
  if (tierProblems.length > 0) throw new ExperienceError(tierProblems);

  const keptTiers: QualityTier[] = [];
  const tierExclusions: ControlExclusion[] = [];
  for (const tier of declaredTiers) {
    if (tier.codec !== undefined && !decodable.has(tier.codec.toLowerCase())) {
      tierExclusions.push({
        id: tier.id,
        reason: `codec '${tier.codec}' is not decodable by the device (device codecs: ${input.device.codecs.join(", ")})`,
      });
      continue;
    }
    keptTiers.push(tier);
  }
  const quality: ControlDescriptor<QualityTier> =
    keptTiers.length > 0
      ? { available: true, options: Object.freeze(keptTiers), excluded: Object.freeze(tierExclusions) }
      : {
          available: false,
          reason:
            declaredTiers.length === 0
              ? "no quality tiers declared by the realization"
              : `every declared quality tier was excluded by the device profile (${tierExclusions.map((exclusion) => exclusion.reason).join("; ")})`,
        };

  // --- audio tracks ----------------------------------------------------------
  const declaredAudio = declaration.audioTracks ?? [];
  const audioProblems: string[] = [];
  for (const track of declaredAudio) {
    if (!isNonEmptyString(track.id)) {
      audioProblems.push(`id: expected a non-empty string, got ${previewValue(track.id)}`);
    }
    if (!isNonEmptyString(track.language)) {
      audioProblems.push(`language: expected a non-empty string, got ${previewValue(track.language)}`);
    }
    if (!isNonEmptyString(track.label)) {
      audioProblems.push(`label: expected a non-empty string, got ${previewValue(track.label)}`);
    }
    if (!isMemberOf(AUDIO_TRACK_KINDS, track.kind)) {
      audioProblems.push(
        `kind: expected one of ${AUDIO_TRACK_KINDS.join(" | ")}, got ${previewValue(track.kind)}`,
      );
    }
    if (track.codec !== undefined && !isNonEmptyString(track.codec)) {
      audioProblems.push(
        `codec: expected a non-empty string when present, got ${previewValue(track.codec)}`,
      );
    }
  }
  if (audioProblems.length > 0) {
    throw new ExperienceError(
      audioProblems.map((message) => `input.declaration.audioTracks: ${message}`),
    );
  }
  const audio: ControlDescriptor<AudioTrack> =
    declaredAudio.length > 0
      ? { available: true, options: Object.freeze([...declaredAudio]), excluded: Object.freeze([]) }
      : { available: false, reason: "no audio tracks declared by the realization" };

  // --- subtitle tracks ---------------------------------------------------------
  const declaredSubtitles = declaration.subtitleTracks ?? [];
  const subtitleProblems: string[] = [];
  for (const track of declaredSubtitles) {
    if (!isNonEmptyString(track.id)) {
      subtitleProblems.push(`id: expected a non-empty string, got ${previewValue(track.id)}`);
    }
    if (!isNonEmptyString(track.language)) {
      subtitleProblems.push(
        `language: expected a non-empty string, got ${previewValue(track.language)}`,
      );
    }
    if (!isNonEmptyString(track.label)) {
      subtitleProblems.push(`label: expected a non-empty string, got ${previewValue(track.label)}`);
    }
    if (!isMemberOf(SUBTITLE_TRACK_KINDS, track.kind)) {
      subtitleProblems.push(
        `kind: expected one of ${SUBTITLE_TRACK_KINDS.join(" | ")}, got ${previewValue(track.kind)}`,
      );
    }
  }
  if (subtitleProblems.length > 0) {
    throw new ExperienceError(
      subtitleProblems.map((message) => `input.declaration.subtitleTracks: ${message}`),
    );
  }
  const subtitles: ControlDescriptor<SubtitleTrack> =
    declaredSubtitles.length > 0
      ? {
          available: true,
          options: Object.freeze([...declaredSubtitles]),
          excluded: Object.freeze([]),
        }
      : { available: false, reason: "no subtitle tracks declared by the realization" };

  return { mode, quality, audio, subtitles };
}
