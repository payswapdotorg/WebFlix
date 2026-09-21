/**
 * @wfx/client-runtime — the first-class torrent realization contract
 * (R23-C).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-C): torrent
 * is a FIRST-CLASS realization/source path, not merely an offline-copy
 * subsystem — while PRESERVING the frozen Media Surface precedence
 * model.
 *
 * THE SHAPE OF THE LAW (exactly the plan's four clauses):
 *
 * 1. NO GENERIC `PlaybackMode = torrent`. The frozen playback modes stay
 *    native / embed / browser / external — enforced COMPILE-TIME by
 *    {@link TorrentIsNotAPlaybackMode} (the assertion fails to compile
 *    if the frozen union ever gains a torrent member) and RUNTIME by the
 *    rung mapping ({@link torrentPlaybackModeOf} only ever answers
 *    existing modes). Torrent enters as a TRANSPORT/SOURCE KIND a
 *    realization declares, never as a playback mode.
 * 2. ON DESKTOP an authorized torrent realization may satisfy the NATIVE
 *    rung (the full-power reference client's native media path — the
 *    existing NativeMediaPort open input already carries magnet /
 *    torrent bytes / local path).
 * 3. ON WEB a browser-capable torrent realization may satisfy a
 *    BROWSER rung where technically supported (the WebTorrent/WebRTC
 *    path — browser peers need WebRTC-capable peers; ordinary TCP/UDP
 *    peers are unreachable from the browser, so browser-capability is a
 *    TRUTHFUL per-realization declaration, never an assumption).
 * 4. OTHERWISE Web presents the SAME CANONICAL ITEM with an honest
 *    Desktop/native next step — never a dead "unavailable", never a
 *    hidden path. The torrent entry stays visible with the truthful
 *    next step (the R21 "unsupported is not undiscoverable" law).
 *
 * THE USER VOCABULARY (frozen here; Workers 2/3 render it verbatim):
 * "Where to watch -> Authorized peer copy" — NEVER merely "Offline
 * copy". The acquisition lifecycle keeps its own protocol-free
 * vocabulary (Available -> Preparing -> Buffering -> Playing ->
 * Completing -> Ready offline / Failed — the frozen AcquisitionState
 * union, reused verbatim, never reshaped).
 *
 * THE FIRST-CLASS PARITY SET: torrent and provider realizations share
 * canonical Entertainment Item identity, resume position, Like/Save
 * semantics where applicable, AI actions, recommendation feedback,
 * playback telemetry, Library integration, availability/realization
 * choice, and error/recovery vocabulary — typed as the closed
 * {@link TorrentParityDimension} union with the per-dimension parity
 * law, so no surface can demote a torrent realization to a second-class
 * citizen on any dimension.
 *
 * WHAT THIS MODULE IS: PURE derivations + typed data (the control-views
 * law). No torrent protocol logic (that lives behind the
 * native-media/torrent-engine boundary — the architecture's explicit
 * out-of-scope law), no fetching, no UI.
 *
 * WHAT THIS MODULE IS NOT: a torrent engine, a WebTorrent adapter
 * (R23-D is the browser adapter evaluation, Workers 2/3's lane), or the
 * Where-to-watch UI (R23-E). This module is the shared contract those
 * lanes build against.
 */

import type { AcquisitionState, PlaybackMode } from "@wfx/domain";
import type { PlatformKind } from "@wfx/platform-contracts";

import type { RealizationAccessClass } from "./anonymous-viewing";

// ---------------------------------------------------------------------------
// The no-new-playback-mode law (compile-time)
// ---------------------------------------------------------------------------

/**
 * COMPILE-TIME LAW: the frozen `PlaybackMode` union NEVER gains a
 * "torrent" member. If it ever does, this assertion resolves to `never`
 * and compilation fails — the lead must ratify any such change
 * explicitly (a generic PlaybackMode = torrent is the exact drift the
 * R23-C plan forbids).
 */
export type TorrentIsNotAPlaybackMode = "torrent" extends PlaybackMode
  ? never
  : unknown;

/** Runtime companion of {@link TorrentIsNotAPlaybackMode}. */
const _torrentIsNotAPlaybackMode: TorrentIsNotAPlaybackMode = null;

// ---------------------------------------------------------------------------
// The transport/source-kind declaration
// ---------------------------------------------------------------------------

/**
 * HOW a playback/acquisition realization reaches its bytes — the
 * transport/source kind a realization DECLARES (the R23-C extension to
 * realization truth):
 *
 * - `"provider"` — the realization plays through a provider source
 *   (streaming embed / browser / external handoff / provider-backed
 *   native). The pre-R23 default; every existing realization carries it
 *   implicitly.
 * - `"torrent"` — the realization plays through an AUTHORIZED peer copy
 *   (the torrent path). This is a TRANSPORT KIND, never a playback
 *   mode: the rung it satisfies is still native / browser (see
 *   {@link torrentRungSatisfaction}).
 */
export type RealizationTransportKind = "provider" | "torrent";

/** Every value of {@link RealizationTransportKind}. */
export const REALIZATION_TRANSPORT_KINDS: readonly RealizationTransportKind[] = [
  "provider",
  "torrent",
] as const;

/** Runtime membership check against the transport-kind union. */
export function isRealizationTransportKind(
  x: unknown,
): x is RealizationTransportKind {
  return (
    typeof x === "string" &&
    (REALIZATION_TRANSPORT_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The torrent realization declaration (first-class realization truth)
// ---------------------------------------------------------------------------

/**
 * One torrent realization's DECLARED truth — what makes torrent a
 * first-class realization instead of an offline afterthought:
 *
 * - `transport: "torrent"` — the declared source kind (see
 *   {@link RealizationTransportKind});
 * - `authorized` — the R11/R13 authorization/provenance gate: the copy
 *   is user-owned / licensed / public-domain / Creative-Commons /
 *   otherwise permitted. An UNAUTHORIZED torrent realization is never
 *   offered as playback (the typed `requires-authorization` outcome);
 * - `browserCapable` — the per-realization WebTorrent capability truth:
 *   WebRTC-capable peers are reachable for this swarm. A truthful
 *   declaration, never an assumption (browser peers cannot reach
 *   ordinary TCP/UDP-only peers);
 * - `accessClass` — the R23-A/B authorization vocabulary: an authorized
 *   peer copy needs no provider sign-in, so the honest class is
 *   `"public"` (the field stays typed so the playback boundary consults
 *   the same vocabulary as provider realizations — never a special
 *   case).
 */
export interface TorrentRealizationDeclaration {
  readonly transport: "torrent";
  /** The R11/R13 authorization/provenance gate for this copy. */
  readonly authorized: boolean;
  /** Whether WebTorrent/WebRTC playback is possible for this swarm. */
  readonly browserCapable: boolean;
  /** The R23-A access class (an authorized peer copy is public). */
  readonly accessClass: RealizationAccessClass;
}

/** Structural guard for a claimed torrent realization declaration. */
export function isTorrentRealizationDeclaration(
  x: unknown,
): x is TorrentRealizationDeclaration {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (record.transport !== "torrent") return false;
  if (typeof record.authorized !== "boolean") return false;
  if (typeof record.browserCapable !== "boolean") return false;
  return (
    record.accessClass === "public" ||
    record.accessClass === "provider-authorization-required"
  );
}

// ---------------------------------------------------------------------------
// The rung-satisfaction model (preserving the Media Surface precedence)
// ---------------------------------------------------------------------------

/**
 * HOW a torrent realization participates in the frozen Media Surface
 * precedence on one platform — the four honest outcomes:
 *
 * - `satisfies-native-rung` — Desktop: the authorized torrent
 *   realization satisfies the NATIVE rung (native media path; playback
 *   possible before full completion per the R11/R12 scheduler laws);
 * - `satisfies-browser-rung` — Web (or any platform) where the
 *   realization is browser-capable AND the platform truthfully supports
 *   browser torrent playback: it satisfies a BROWSER rung;
 * - `desktop-next-step` — the platform cannot play this realization;
 *   the SAME CANONICAL ITEM stays presented with an honest Desktop/
 *   native next step (the R21 discoverability law — never hidden,
 *   never a dead unavailable);
 * - `requires-authorization` — the realization is not authorized; it is
 *   never offered as playback (the R11/R13 provenance gate).
 */
export type TorrentRungSatisfaction =
  | {
      kind: "satisfies-native-rung";
      /** The rung satisfied: always the frozen `"native"` mode. */
      readonly mode: PlaybackMode;
      /** The honest one-sentence truth. */
      readonly detail: string;
    }
  | {
      kind: "satisfies-browser-rung";
      /** The rung satisfied: always the frozen `"browser"` mode. */
      readonly mode: PlaybackMode;
      /** The honest one-sentence truth. */
      readonly detail: string;
    }
  | {
      kind: "desktop-next-step";
      /** The honest Desktop/native next step (user vocabulary). */
      readonly nextStep: TorrentDesktopNextStepView;
      /** The honest one-sentence truth. */
      readonly detail: string;
    }
  | {
      kind: "requires-authorization";
      /** The honest one-sentence truth of the gate. */
      readonly detail: string;
    };

/** The honest Desktop/native next step for a platform that cannot play it. */
export interface TorrentDesktopNextStepView {
  /** The next-step label (user vocabulary). */
  readonly label: string;
  /** One honest sentence about the Desktop/native path. */
  readonly detail: string;
}

/**
 * The frozen Desktop next-step vocabulary (the R21 pattern: truthful
 * next step, never a dead "not available"). The SAME CANONICAL ITEM
 * plays there — identity, resume position, library, and recovery stay
 * shared (the parity set below).
 */
export const TORRENT_DESKTOP_NEXT_STEP: TorrentDesktopNextStepView = {
  label: "Play this in the Desktop app",
  detail:
    "This authorized peer copy plays through the Desktop app's native player — the item, your position, and your library are the same there.",
};

/** The platform truth a torrent rung decision consumes. */
export interface TorrentPlatformTruth {
  /** The platform asking (web / desktop / mobile). */
  readonly platform: PlatformKind;
  /**
   * Whether THIS platform truthfully supports browser torrent playback
   * (the WebTorrent/WebRTC path — an adapter-declared capability, never
   * an assumption; `false` on today's Web boot until R23-D lands).
   */
  readonly browserTorrentSupported: boolean;
}

/**
 * THE RUNG DECISION (pure; the single derivation every surface consults
 * — preserving the Media Surface precedence model):
 *
 * | authorized | platform        | browserCapable | browserTorrentSupported | outcome                    |
 * |------------|-----------------|----------------|-------------------------|----------------------------|
 * | false      | (any)           | (any)          | (any)                   | requires-authorization     |
 * | true       | desktop         | (any)          | (any)                   | satisfies-native-rung      |
 * | true       | web/other       | true           | true                    | satisfies-browser-rung     |
 * | true       | web/other       | (any)          | false                   | desktop-next-step          |
 * | true       | web/other       | false          | true                    | desktop-next-step          |
 *
 * Desktop satisfies the native rung REGARDLESS of browser capability
 * (the native path is the full-power reference path). Mobile honestly
 * answers desktop-next-step until a real mobile torrent adapter exists
 * (no capability claim without a real adapter path).
 */
export function torrentRungSatisfaction(
  truth: TorrentPlatformTruth,
  realization: TorrentRealizationDeclaration,
): TorrentRungSatisfaction {
  if (!realization.authorized) {
    return {
      kind: "requires-authorization",
      detail:
        "This peer copy is not authorized — WebFlix only plays user-owned, licensed, public-domain, Creative-Commons, or otherwise permitted copies.",
    };
  }
  if (truth.platform === "desktop") {
    return {
      kind: "satisfies-native-rung",
      mode: "native",
      detail:
        "This authorized peer copy plays through the Desktop app's native player — playback can start before the full copy completes.",
    };
  }
  if (realization.browserCapable && truth.browserTorrentSupported) {
    return {
      kind: "satisfies-browser-rung",
      mode: "browser",
      detail:
        "This authorized peer copy plays right here in the browser through WebRTC-capable peers.",
    };
  }
  return {
    kind: "desktop-next-step",
    nextStep: TORRENT_DESKTOP_NEXT_STEP,
    detail:
      "This authorized peer copy needs the Desktop app's native player — the browser cannot reach this swarm's peers.",
  };
}

/**
 * The frozen playback mode a torrent rung maps onto — `null` when the
 * platform offers no rung (the honest Desktop next step). STRUCTURALLY
 * PROVES the no-new-mode law: torrent satisfies EXISTING rungs only
 * (native on Desktop; browser on a browser-capable platform); there is
 * and shall be no `PlaybackMode = "torrent"`.
 */
export function torrentPlaybackModeOf(
  satisfaction: TorrentRungSatisfaction,
): PlaybackMode | null {
  switch (satisfaction.kind) {
    case "satisfies-native-rung":
      return satisfaction.mode; // "native"
    case "satisfies-browser-rung":
      return satisfaction.mode; // "browser"
    case "desktop-next-step":
    case "requires-authorization":
      return null; // no rung on this platform / not offered
  }
}

// ---------------------------------------------------------------------------
// The user vocabulary ("Where to watch -> Authorized peer copy")
// ---------------------------------------------------------------------------

/**
 * The torrent realization's PRIMARY entry vocabulary — the one derivation
 * source every surface renders verbatim. The label is "Authorized peer
 * copy", NEVER merely "Offline copy" (the R23-C/E law).
 */
export interface TorrentRealizationView {
  /** The primary Where-to-watch entry label. */
  readonly label: string;
  /** One honest sentence about what this way of watching is. */
  readonly detail: string;
}

/** The frozen primary view of the torrent realization. */
export const TORRENT_REALIZATION_VIEW: TorrentRealizationView = {
  label: "Authorized peer copy",
  detail:
    "A copy you are permitted to play, fetched peer-to-peer — it plays like any other way of watching, keeps your place, and lands in your Library.",
};

/**
 * Labels a surface may NEVER present as the torrent realization's
 * PRIMARY entry (the "never merely Offline copy" law). "Offline"
 * vocabulary belongs to the acquisition LIFECYCLE ("Ready offline" — the
 * completion state), never to the realization CHOICE.
 */
export const TORRENT_FORBIDDEN_PRIMARY_LABELS: readonly string[] = [
  "offline copy",
  "download",
  "torrent download",
  "download copy",
  "offline download",
];

/**
 * THE VOCABULARY LAW (machine-checkable): is `label` a lawful PRIMARY
 * label for the torrent realization entry? Lawful labels name the peer
 * copy honestly (contain "peer copy", case-insensitive); labels that
 * are merely offline/download vocabulary are FORBIDDEN as the primary
 * entry (they demote a first-class realization to a download utility).
 */
export function isLawfulTorrentPrimaryLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (!normalized.includes("peer copy")) return false;
  // A label that IS only a forbidden label can never be lawful (the
  // "never MERELY Offline copy" law — "Offline copy (peer copy)"-style
  // compound labels stay lawful because the peer-copy concept leads).
  return !TORRENT_FORBIDDEN_PRIMARY_LABELS.includes(normalized);
}

// ---------------------------------------------------------------------------
// The Where-to-watch grouping vocabulary (R23-E's frozen seam)
// ---------------------------------------------------------------------------

/**
 * The Where-to-watch entry groups (the R23-E item/detail surface's
 * frozen vocabulary — frozen HERE so Web/Desktop render the identical
 * grouping): the WebFlix source first, the authorized peer copy second
 * (the first-class torrent entry), other available realizations last.
 */
export type WhereToWatchEntryKind =
  | "webflix-source"
  | "authorized-peer-copy"
  | "other-realizations";

/** Every value of {@link WhereToWatchEntryKind}, in frozen order. */
export const WHERE_TO_WATCH_ENTRY_KINDS: readonly WhereToWatchEntryKind[] = [
  "webflix-source",
  "authorized-peer-copy",
  "other-realizations",
] as const;

/** Runtime membership check against the entry-kind union. */
export function isWhereToWatchEntryKind(
  x: unknown,
): x is WhereToWatchEntryKind {
  return (
    typeof x === "string" &&
    (WHERE_TO_WATCH_ENTRY_KINDS as readonly string[]).includes(x)
  );
}

/** One Where-to-watch group's frozen user vocabulary. */
export interface WhereToWatchGroupView {
  readonly kind: WhereToWatchEntryKind;
  readonly label: string;
  readonly detail: string;
}

/** The frozen Where-to-watch group vocabulary (the one derivation source). */
export const WHERE_TO_WATCH_GROUP_VIEWS: Readonly<
  Record<WhereToWatchEntryKind, WhereToWatchGroupView>
> = {
  "webflix-source": {
    kind: "webflix-source",
    label: "WebFlix source",
    detail: "Watch this through the WebFlix source.",
  },
  "authorized-peer-copy": {
    kind: "authorized-peer-copy",
    label: TORRENT_REALIZATION_VIEW.label,
    detail: TORRENT_REALIZATION_VIEW.detail,
  },
  "other-realizations": {
    kind: "other-realizations",
    label: "Other ways to watch",
    detail: "More ways to watch this item from your connected sources.",
  },
};

// ---------------------------------------------------------------------------
// The acquisition lifecycle (protocol-free, reused verbatim)
// ---------------------------------------------------------------------------

/**
 * The torrent realization's acquisition lifecycle is the FROZEN
 * protocol-free vocabulary, verbatim — `Available -> Preparing ->
 * Buffering -> Playing -> Completing -> Ready offline / Failed` — never
 * torrent jargon in the primary UX (the acquisition.ts transition law
 * owns the state machine; this alias binds the torrent path to it).
 */
export const TORRENT_ACQUISITION_STATES: readonly AcquisitionState[] = [
  "available",
  "preparing",
  "buffering",
  "playing",
  "completing",
  "ready-offline",
  "failed",
] as const;

// ---------------------------------------------------------------------------
// The first-class parity set
// ---------------------------------------------------------------------------

/**
 * ONE dimension of first-class parity between torrent and provider
 * realizations. The closed union — exactly the plan's list:
 *
 * - `canonical-item-identity` — the torrent realization carries the SAME
 *   canonical Entertainment Item identity (source identity is
 *   secondary; the registry stays the one identity owner);
 * - `resume-position` — playback through a torrent realization resumes
 *   at the same canonical position (and feeds the same
 *   session-scoped/durable progress law);
 * - `like-save-semantics` — Like/Save work where applicable, with the
 *   same typed action/receipt semantics (source-supported or honest
 *   unsupported — never silently missing);
 * - `ai-actions` — the AI tray's transformations apply to the item being
 *   watched through a torrent realization exactly as through a provider
 *   one;
 * - `recommendation-feedback` — More like this / Not interested /
 *   already-watched feedback is offered and folded identically;
 * - `playback-telemetry` — playback observations (started/progress/
 *   ended) flow through the same watch-state mirroring;
 * - `library-integration` — the verified asset lands in the Library and
 *   replays with the same semantics as any library entry;
 * - `availability-realization-choice` — the torrent realization appears
 *   in the same Where-to-watch choice with the same availability truth
 *   (available/unknown/unavailable — never hidden behind Settings or
 *   diagnostics);
 * - `error-recovery-vocabulary` — failures use the same typed
 *   error/recovery vocabulary (recoverable vs fatal, retry/dismiss
 *   next actions) as any other realization.
 */
export type TorrentParityDimension =
  | "canonical-item-identity"
  | "resume-position"
  | "like-save-semantics"
  | "ai-actions"
  | "recommendation-feedback"
  | "playback-telemetry"
  | "library-integration"
  | "availability-realization-choice"
  | "error-recovery-vocabulary";

/** Every value of {@link TorrentParityDimension}, in plan order. */
export const TORRENT_PARITY_DIMENSIONS: readonly TorrentParityDimension[] = [
  "canonical-item-identity",
  "resume-position",
  "like-save-semantics",
  "ai-actions",
  "recommendation-feedback",
  "playback-telemetry",
  "library-integration",
  "availability-realization-choice",
  "error-recovery-vocabulary",
] as const;

/** Runtime membership check against the parity union. */
export function isTorrentParityDimension(
  x: unknown,
): x is TorrentParityDimension {
  return (
    typeof x === "string" &&
    (TORRENT_PARITY_DIMENSIONS as readonly string[]).includes(x)
  );
}

/** One parity dimension's frozen contract statement. */
export interface TorrentParityClause {
  readonly dimension: TorrentParityDimension;
  /** The dimension's user label. */
  readonly label: string;
  /** The parity law in one sentence (the one derivation source). */
  readonly law: string;
}

/** The frozen parity contract: all nine dimensions, one read model. */
export const TORRENT_PARITY_CONTRACT: readonly TorrentParityClause[] = [
  {
    dimension: "canonical-item-identity",
    label: "Same item",
    law: "An authorized peer copy is the SAME canonical item — its title, details, and history never fork from the provider-backed ways to watch.",
  },
  {
    dimension: "resume-position",
    label: "Same place",
    law: "Watching through an authorized peer copy keeps and resumes your position exactly like any other way of watching.",
  },
  {
    dimension: "like-save-semantics",
    label: "Same Like and Save",
    law: "Like and Save work the same where the item supports them — the same receipts, the same honest unsupported states, never silently missing.",
  },
  {
    dimension: "ai-actions",
    label: "Same AI actions",
    law: "The AI tray applies to the item being watched through an authorized peer copy exactly as through a provider.",
  },
  {
    dimension: "recommendation-feedback",
    label: "Same feedback",
    law: "More like this, Not interested, and already-watched feedback is offered and folded identically for peer-copy watching.",
  },
  {
    dimension: "playback-telemetry",
    label: "Same playback truth",
    law: "Playback through an authorized peer copy reports the same honest started/progress/ended observations.",
  },
  {
    dimension: "library-integration",
    label: "Same Library",
    law: "A verified peer copy lands in the Library and replays with the same semantics as any entry.",
  },
  {
    dimension: "availability-realization-choice",
    label: "Same choice",
    law: "The authorized peer copy appears in Where to watch with the same availability truth — never hidden behind Settings or diagnostics.",
  },
  {
    dimension: "error-recovery-vocabulary",
    label: "Same recovery",
    law: "Peer-copy failures use the same typed error and recovery vocabulary as any other realization — retry when recoverable, dismiss when fatal, never a silent loss of state.",
  },
];

/**
 * The parity audit a surface must pass: does the torrent realization
 * participate in EVERY parity dimension? (Pure; total over the closed
 * union — a missing dimension is drift.)
 */
export function torrentParityDimensionCovered(
  dimension: TorrentParityDimension,
): boolean {
  return TORRENT_PARITY_CONTRACT.some(
    (clause) => clause.dimension === dimension,
  );
}
