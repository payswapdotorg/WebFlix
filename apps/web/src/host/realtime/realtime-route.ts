/**
 * @wfx/app-web — the R25 REALTIME ROUTE VIEW (R25-E/R25-G/R25-J: the
 * player's honest realtime-translation capability truth, bound to the
 * shared contracts).
 *
 * THE GATE ORDER (the R25-E honesty law, derived — never guessed):
 * 1. THE BRIDGE GATE — is the WebFlix realtime bridge serving on this
 *    host? (the dev fixtures boot: yes; the default service boot: the
 *    honest typed unavailability — the Vercel WebSocket-function
 *    deployment is the lead's R25 lane);
 * 2. THE PROVIDER GATE — is a realtime provider registered behind the
 *    seam? (the shared routing decision's registration truth; the
 *    fixtures boot registers the deterministic dev double — loudly
 *    labeled);
 * 3. THE LEGAL-AUDIO GATE — does THIS item declare a lawful audio path
 *    to WebFlix? (the shared `RealtimeSourceMediaIdentity` truth —
 *    fail-closed; no capture circumvention, ever);
 * 4. THE REALIZATION GATE (R25-E, the stage-level truth derived at the
 *    surface): full fidelity ONLY where WebFlix owns the media path
 *    (the authorized peer copy's browser rung; the WebFlix-owned
 *    pipeline; authorized local/live input). Provider iframe/embed and
 *    external rungs are RESTRICTED — the provider keeps the media path
 *    inside its contained surface: never a bypass, never a fabricated
 *    capability. The restricted view names the honest alternatives
 *    (the provider's own captions/transcript where the artifact exists
 *    + the batch text translation through the existing AI action tray)
 *    and marks live translation unavailable.
 *
 * THE ANONYMOUS TRUTH (R25-J, the shared laws verbatim): the session
 * capability is ACCOUNTLESS (the shared no-login-wall law); the five
 * durable capabilities honestly require the account (the shared
 * mapping) — sign-in is the OPTIONAL upgrade, never a gate.
 */

import {
  REALTIME_ANONYMOUS_CAPABILITY_IDS,
  isAnonymousRealtimeSessionAccountless,
  mayRequireLoginForRealtimeCapability,
} from "@wfx/model-fabric";

import { readRealtimeBridgeStatus } from "./realtime-bridge-state";
import { intelligenceFixtureOf } from "@/host/intelligence-fixtures";

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The player's realtime-translation capability view (the honest truth). */
export interface RealtimeRouteView {
  readonly kind: "realtime-route";
  /**
   * The composed readiness (the gate order above). "ready" carries the
   * bridge URL + the honest source-stream truth; every other state
   * carries the typed honest sentence — never a dead end.
   */
  readonly readiness:
    | {
        readonly kind: "ready";
        readonly bridgeUrl: string;
        /** "scripted-dev-double" in the fixtures boot (loudly labeled); "captured-audio" on the owned-stage production path. */
        readonly sourceStream: "scripted-dev-double" | "captured-audio";
        /** Whether the real owned-stage capture path would run (the production source). */
        readonly capturePathWired: boolean;
      }
    | { readonly kind: "audio-not-legally-available"; readonly detail: string }
    | {
        readonly kind: "restricted-realization";
        readonly detail: string;
        /** Whether the provider's captions/transcript artifact exists (the first honest alternative). */
        readonly transcriptAvailable: boolean;
        /** Whether the batch text translation is offered (the AI action tray — the second alternative). */
        readonly batchTranslateAvailable: boolean;
      }
    | { readonly kind: "bridge-unavailable"; readonly detail: string };
  /** The provider routing truth (present when the bridge gate passed). */
  readonly route:
    | {
        readonly kind: "registered-provider";
        readonly providerId: string;
        readonly detail: string;
        readonly reportedAverageLagMs: number;
      }
    | { readonly kind: "no-realtime-provider-registered"; readonly detail: string; readonly recovery: string }
    | null;
  /** The provider's declared target languages (the honest direction truth). */
  readonly targetLanguages: readonly { readonly code: string; readonly label: string }[];
  /** The anonymous truth (R25-J — the shared laws, rendered). */
  readonly anonymous: {
    /** The accountless session law (always true — the shared total law). */
    readonly accountless: boolean;
    /** The durable capabilities that honestly require the account (the shared mapping). */
    readonly durableCapabilities: readonly string[];
    /** The optional sign-in sentence (never a gate). */
    readonly signInSentence: string;
    readonly signInHref: string;
  };
}

// ---------------------------------------------------------------------------
// The load (the item-level + bridge-level truths)
// ---------------------------------------------------------------------------

/** The route view's input (the item identity + the item-level audio truth). */
export interface RealtimeRouteInput {
  readonly externalRef: string;
}

/**
 * Load the realtime route view (the bridge gate → the provider gate →
 * the item-level legal-audio gate; the realization-level restriction is
 * the surface's pure derivation — see {@link realtimeStageReadiness}).
 */
export function loadRealtimeRouteView(input: RealtimeRouteInput): RealtimeRouteView {
  const status = readRealtimeBridgeStatus();
  const anonymousCapabilities = REALTIME_ANONYMOUS_CAPABILITY_IDS.filter((capability) =>
    mayRequireLoginForRealtimeCapability(capability),
  );
  const anonymous = {
    accountless: isAnonymousRealtimeSessionAccountless(),
    durableCapabilities: anonymousCapabilities,
    signInSentence:
      "Realtime translation needs no account — sign in (optional) to remember your translation language, voice, and history across devices.",
    signInHref: "/settings?section=general",
  };

  // 1. THE BRIDGE GATE.
  if (!status.running || status.port === null) {
    return {
      kind: "realtime-route",
      readiness: {
        kind: "bridge-unavailable",
        detail:
          "The realtime translation bridge is not serving on this host — this boot runs without the WebSocket bridge (the deployment's realtime transport is the lead's lane). Playback and original captions are unaffected.",
      },
      route: null,
      targetLanguages: [],
      anonymous,
    };
  }
  const bridgeUrl = `ws://localhost:${status.port}`;

  // 2. THE PROVIDER GATE (the shared routing decision's registration truth).
  if (status.provider === null) {
    return {
      kind: "realtime-route",
      readiness: { kind: "ready", bridgeUrl, sourceStream: "scripted-dev-double", capturePathWired: true },
      route: {
        kind: "no-realtime-provider-registered",
        detail: "no realtime translation provider is registered on this host",
        recovery: "A registered Model-Fabric realtime provider serves this lane — check Model & AI settings.",
      },
      targetLanguages: [],
      anonymous,
    };
  }

  // 3. THE LEGAL-AUDIO GATE (the item-level truth — fail-closed).
  const fixtureRow = intelligenceFixtureOf(input.externalRef);
  const audioLegallyAvailable = fixtureRow?.audioStreamLegallyAvailable ?? false;
  if (!audioLegallyAvailable) {
    return {
      kind: "realtime-route",
      readiness: {
        kind: "audio-not-legally-available",
        detail:
          "This item declares no audio stream WebFlix can lawfully reach — live translation stays off (WebFlix never bypasses DRM, cross-origin, or access controls to obtain audio).",
      },
      route: null,
      targetLanguages: [...status.targetLanguages],
      anonymous,
    };
  }

  return {
    kind: "realtime-route",
    readiness: {
      kind: "ready",
      bridgeUrl,
      sourceStream: "scripted-dev-double",
      capturePathWired: true,
    },
    route: {
      kind: "registered-provider",
      providerId: status.provider.id,
      detail: status.provider.detail,
      reportedAverageLagMs: 2_300,
    },
    targetLanguages: [...status.targetLanguages],
    anonymous,
  };
}

// ---------------------------------------------------------------------------
// The realization-level derivation (the surface's pure composition)
// ---------------------------------------------------------------------------

/** The stage context the realization gate derives over. */
export interface RealtimeStageContext {
  /** Whether WebFlix owns THIS stage's media path (the peer-copy browser rung). */
  readonly webflixOwnsStage: boolean;
  /** The resolved realization's mode. */
  readonly surfaceMode: string;
  /** Whether the item carries a transcript artifact (the first alternative). */
  readonly transcriptAvailable: boolean;
}

/**
 * Derive the STAGE-level readiness (R25-E's realization truth — pure):
 * full fidelity ONLY on WebFlix-owned stages; provider iframe/embed and
 * external rungs are restricted with the honest alternatives named.
 */
export function realtimeStageReadiness(
  view: RealtimeRouteView,
  stage: RealtimeStageContext,
): RealtimeRouteView["readiness"] {
  if (view.readiness.kind !== "ready") {
    return view.readiness;
  }
  if (stage.webflixOwnsStage) {
    // Full fidelity: WebFlix owns the media path — the real capture
    // path runs in production; the fixtures boot drives the scripted
    // double (loudly labeled in the surface).
    return view.readiness;
  }
  const providerKeepsMedia =
    stage.surfaceMode === "embed"
      ? "the provider's contained embed keeps the media path inside its own player"
      : stage.surfaceMode === "browser"
        ? "the contained web playback keeps the media path on the source's own page"
        : "the source keeps the media path — this way of watching opens on the source";
  return {
    kind: "restricted-realization",
    detail: `Live translation is unavailable on this way of watching: ${providerKeepsMedia}, and WebFlix never bypasses DRM, cross-origin, or access controls to reach it.`,
    transcriptAvailable: stage.transcriptAvailable,
    batchTranslateAvailable: true,
  };
}

/** The restricted view's honest alternatives sentence (rendered under the row). */
export function realtimeRestrictedAlternativesSentence(readiness: RealtimeRouteView["readiness"]): string | null {
  if (readiness.kind !== "restricted-realization") return null;
  const parts: string[] = [];
  if (readiness.transcriptAvailable) {
    parts.push("the original transcript below stays available");
    parts.push("its text can be translated through the AI actions on this page");
  } else {
    parts.push("the original captions remain available where the surface shows them");
  }
  return `${parts.join("; ")} — switching to the authorized peer copy (Where to watch) opens the full-fidelity live lane.`;
}
