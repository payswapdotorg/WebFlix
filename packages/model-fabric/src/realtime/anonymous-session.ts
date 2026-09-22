/**
 * @wfx/model-fabric — the anonymous realtime translation behavior
 * contracts (R25-J).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-J, extending
 * the R23 accountless-public-viewing law from
 * `@wfx/client-runtime`'s anonymous-viewing matrix): anonymous users
 * may use realtime translation for CURRENTLY PLAYABLE PUBLIC MEDIA
 * when the capability does not require durable identity. Login is
 * needed only when the user wants DURABLE things:
 *
 * - preferred translation language;
 * - translated-language voice settings;
 * - saved translated artifacts;
 * - synchronized subtitle preferences;
 * - cross-device translation history.
 *
 * THE NO-LOGIN-WALL LAW (machine-checkable): a non-durable realtime
 * translation session NEVER requires a WebFlix account —
 * {@link mayRequireLoginForRealtimeCapability} answers `true` only
 * for the durable capabilities, and
 * {@link anonymousRealtimeSessionReadiness} gates the anonymous
 * session on the two honest preconditions (the media is currently
 * playable public media, and the audio stream is legally available),
 * answering TYPED refusals — never a login redirect.
 *
 * WHAT THIS MODULE IS: the shared policy read model for the realtime
 * lane (pure data + derivations, the anonymous-viewing precedent).
 * The R23-A matrix owns viewing capabilities; this module owns the
 * REALTIME TRANSLATION capability rows that extend it, keyed by the
 * same `ViewerSessionKind` distinction.
 */

// ---------------------------------------------------------------------------
// The capability vocabulary (exactly the plan's R25-J lists)
// ---------------------------------------------------------------------------

/**
 * One realtime translation capability of the anonymous-behavior
 * matrix — the plan's two lists: the accountless session (anonymous)
 * and the durable preferences/artifacts/history (account).
 */
export type RealtimeAnonymousCapabilityId =
  /** Use realtime translation on currently playable public media, session-scoped — NO login. */
  | "anonymous-realtime-translation-session"
  // — durable: login is the honest prerequisite —
  /** Durable preferred translation language. */
  | "durable-translation-language-preference"
  /** Durable translated-language voice settings. */
  | "durable-translated-voice-settings"
  /** Saved translated artifacts. */
  | "saved-translated-artifacts"
  /** Synchronized subtitle preferences. */
  | "synchronized-subtitle-preferences"
  /** Cross-device translation history. */
  | "cross-device-translation-history";

/** Every capability, in matrix order. */
export const REALTIME_ANONYMOUS_CAPABILITY_IDS: readonly RealtimeAnonymousCapabilityId[] = [
  "anonymous-realtime-translation-session",
  "durable-translation-language-preference",
  "durable-translated-voice-settings",
  "saved-translated-artifacts",
  "synchronized-subtitle-preferences",
  "cross-device-translation-history",
] as const;

/** Runtime membership check against the capability union. */
export function isRealtimeAnonymousCapabilityId(
  x: unknown,
): x is RealtimeAnonymousCapabilityId {
  return (
    typeof x === "string" &&
    (REALTIME_ANONYMOUS_CAPABILITY_IDS as readonly string[]).includes(x)
  );
}

/**
 * The authorization class of one realtime capability — the R23-A
 * distinction this matrix extends: `anonymous` (no WebFlix account)
 * or `webflix-account` (durable identity is the honest prerequisite).
 */
export type RealtimeCapabilityAuthClass = "anonymous" | "webflix-account";

/** Every auth class. */
export const REALTIME_CAPABILITY_AUTH_CLASSES: readonly RealtimeCapabilityAuthClass[] = [
  "anonymous",
  "webflix-account",
] as const;

/** Runtime membership check against the auth-class union. */
export function isRealtimeCapabilityAuthClass(x: unknown): x is RealtimeCapabilityAuthClass {
  return (
    typeof x === "string" &&
    (REALTIME_CAPABILITY_AUTH_CLASSES as readonly string[]).includes(x)
  );
}

/**
 * The golden capability → auth-class mapping (pure; tested
 * exhaustively): the session capability is ANONYMOUS; every durable
 * preference/artifact/history capability requires the ACCOUNT.
 */
const CAPABILITY_AUTH_CLASS: Readonly<Record<RealtimeAnonymousCapabilityId, RealtimeCapabilityAuthClass>> =
  {
    "anonymous-realtime-translation-session": "anonymous",
    "durable-translation-language-preference": "webflix-account",
    "durable-translated-voice-settings": "webflix-account",
    "saved-translated-artifacts": "webflix-account",
    "synchronized-subtitle-preferences": "webflix-account",
    "cross-device-translation-history": "webflix-account",
  };

/** The auth class of one realtime capability (pure, total). */
export function realtimeCapabilityAuthClass(
  capability: RealtimeAnonymousCapabilityId,
): RealtimeCapabilityAuthClass {
  return CAPABILITY_AUTH_CLASS[capability];
}

/**
 * THE NO-LOGIN-WALL LAW, machine-checkable: does this capability
 * require a WebFlix login? True ONLY for the durable capabilities.
 * A non-durable realtime translation session NEVER requires login —
 * forcing one is drift.
 */
export function mayRequireLoginForRealtimeCapability(
  capability: RealtimeAnonymousCapabilityId,
): boolean {
  return CAPABILITY_AUTH_CLASS[capability] === "webflix-account";
}

/**
 * THE ACCOUNTLESS SESSION LAW, machine-checkable: is the anonymous
 * realtime translation session accountless BY DEFINITION? Always
 * true — the constant the acceptance battery asserts by name (the
 * `isLawfulLoginRedirect` precedent's realtime twin).
 */
export function isAnonymousRealtimeSessionAccountless(): true {
  return true;
}

// ---------------------------------------------------------------------------
// The anonymous-session readiness gate (the honest preconditions)
// ---------------------------------------------------------------------------

/**
 * The preconditions an anonymous realtime translation session must
 * declare (the R25-J law's two honest gates):
 * - `currentlyPlayablePublicMedia` — the media is currently playable
 *   AND public (the accountless lane applies to playable public
 *   media; restricted/provider-authenticated surfaces answer their
 *   own truth);
 * - `audioStreamLegallyAvailable` — WebFlix has a lawful audio path
 *   (the R25-E gate; no circumvention, ever).
 */
export interface RealtimeAnonymousSessionPreconditions {
  readonly currentlyPlayablePublicMedia: boolean;
  readonly audioStreamLegallyAvailable: boolean;
}

/** The typed readiness truth of an anonymous realtime session. */
export type RealtimeAnonymousSessionReadiness =
  | { kind: "ready"; detail: string }
  | {
      /** The media is not currently playable public media — the honest accountless boundary. */
      kind: "not-currently-playable-public-media";
      readonly detail: string;
    }
  | {
      /** No lawful audio path — no capture circumvention, ever. */
      kind: "audio-not-legally-available";
      readonly detail: string;
    };

/**
 * The anonymous-session readiness gate (pure): ready ONLY when both
 * preconditions hold. Every refusal is TYPED and honest — it names
 * the boundary and NEVER suggests a login redirect (the accountless
 * law) or a capture workaround (the R25-E law).
 */
export function anonymousRealtimeSessionReadiness(
  preconditions: RealtimeAnonymousSessionPreconditions,
): RealtimeAnonymousSessionReadiness {
  if (preconditions.currentlyPlayablePublicMedia !== true) {
    return {
      kind: "not-currently-playable-public-media",
      detail:
        "Anonymous realtime translation covers currently playable public media — this media is not in that state right now, so the accountless session stays off for it (provider-provided captions or user-provided text translation may still apply where permitted).",
    };
  }
  if (preconditions.audioStreamLegallyAvailable !== true) {
    return {
      kind: "audio-not-legally-available",
      detail:
        "Realtime translation needs an audio stream WebFlix is legally allowed to process — this content's audio is not available to WebFlix, so live translation stays off for it (there is no bypass, by design).",
    };
  }
  return {
    kind: "ready",
    detail:
      "Anonymous realtime translation is available for this currently playable public media — no WebFlix account is needed for the session itself; login is only for durable preferences, saved artifacts, and cross-device history.",
  };
}
