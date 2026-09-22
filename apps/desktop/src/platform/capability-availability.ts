/**
 * @wfx/app-desktop — the capability-availability Desktop binding
 * (R26-W3, the Desktop parity of Worker 1's R26-W1 canonical contract).
 *
 * THE DESKTOP HOST'S DERIVATION of the canonical
 * `CapabilityAvailabilityReport` (`@wfx/platform-contracts` — the ONE
 * contract the UI binds): every capability's SERVED / NOT-SERVED truth
 * is derived from THIS composition's live bindings — never hardcoded,
 * never guessed, never a fixture presented as production. The Web host
 * binds the identical contract over ITS bindings (the parity law: the
 * same capability vocabulary, the same honest next-action law, the
 * platform's own truthful transport names).
 *
 * THE DERIVATION SOURCES (per capability, on the Desktop):
 *
 * - `semantic-search` / `moment-retrieval` / `multimodal-intelligence`
 *   — the local model runtime's own probe (the R23-J packaging truth:
 *   a build that packages the runtime SERVES locally; the default build
 *   answers the honest not-served with the real next action — the
 *   self-hosted endpoint path, never a fabricated local capability).
 * - `realization-availability` — the acquisition block's binding: the
 *   NATIVE peer path (the R23-C binding over the real engine) + the
 *   runtime's resolve over the `WFX_API_BASE` transport; absent
 *   acquisition ⇒ the honest not-served (never a claimed peer path).
 * - `realtime-bridge` — the R25 realtime translation composition's own
 *   status (the frozen realtime contract + the rebind seam): running ⇒
 *   served through the native seam; otherwise the honest not-served
 *   with the playback-first next action.
 * - `artwork` — the Desktop's catalog surfaces: the authorized peer
 *   catalog ALWAYS carries source-authorized artwork (the films' own
 *   official URLs, typed through the R26-W1 `ContentArtwork` contract);
 *   the server rows' artwork rides the API-side carriage (Worker 1's
 *   named `thumbnailUrl` dependency — the same honest split the Web
 *   reports).
 */

import type {
  CapabilityAvailabilityEntry,
  CapabilityAvailabilityReport,
  CapabilityServingTruth,
} from "@wfx/platform-contracts";
import { capabilityAvailabilityReportOf } from "@wfx/platform-contracts";

// ---------------------------------------------------------------------------
// The input (the composition's own truths — never guessed)
// ---------------------------------------------------------------------------

/** Options for {@link desktopCapabilityAvailability}. */
export interface DesktopCapabilityAvailabilityInput {
  /**
   * Whether the torrent-engine ACQUISITION block is bound (the native
   * peer path's truth — `app.acquisition.bound`).
   */
  readonly acquisitionBound: boolean;
  /**
   * The local model runtime's packaging truth (the R23-J probe's answer —
   * `kind: "ready"` serves the intelligence-lane capabilities locally).
   */
  readonly localModelRuntime: {
    readonly kind: "ready" | "unavailable";
    /** The probe's own reason/detail (verbatim — never re-derived). */
    readonly detail: string;
    /** The probe's own recovery hint when one exists. */
    readonly recoveryHint?: string;
  };
  /**
   * The R25 realtime translation composition's status (the frozen
   * contract's own truth — the rebind seam's live answer).
   */
  readonly realtimeTranslation: {
    readonly running: boolean;
    /** The transport's own name when running (e.g. the native seam). */
    readonly transport?: string;
  };
  /**
   * Whether the server-side catalog carriage carries artwork (the
   * API-side `thumbnailUrl` projection — the named dependency; the
   * DESKTOP's peer catalog always carries its own).
   */
  readonly serverArtworkCarried: boolean;
}

// ---------------------------------------------------------------------------
// The per-capability derivations (pure)
// ---------------------------------------------------------------------------

/** The intelligence-lane capabilities' truths (the local runtime probe). */
function intelligenceEntries(
  input: DesktopCapabilityAvailabilityInput,
): readonly CapabilityAvailabilityEntry[] {
  const truth: CapabilityServingTruth =
    input.localModelRuntime.kind === "ready"
      ? {
          kind: "served",
          transport: "desktop-local-model-runtime",
          detail: input.localModelRuntime.detail,
        }
      : {
          kind: "not-served",
          transport: "desktop-local-model-runtime",
          detail: input.localModelRuntime.detail,
          nextAction: {
            label: "Search by title and the AI action tray still work",
            detail:
              "Title search serves the whole catalog; per-title AI actions run through the AI tray, and this build can also reach a self-hosted model endpoint from Settings, under Model & AI.",
          },
        };
  return [
    { capability: "semantic-search", truth },
    { capability: "moment-retrieval", truth },
    { capability: "multimodal-intelligence", truth },
  ];
}

/** The realization-availability truth (the native peer path + the resolve transport). */
function realizationAvailabilityEntry(
  input: DesktopCapabilityAvailabilityInput,
): CapabilityAvailabilityEntry {
  if (input.acquisitionBound) {
    return {
      capability: "realization-availability",
      truth: {
        kind: "served",
        transport: "desktop-native-peer-path",
        detail:
          "Provider and external realizations resolve per item through the Experience API transport, and authorized peer copies play through the Desktop app's native peer path — the engine-backed rung with playback before completion.",
      },
    };
  }
  return {
    capability: "realization-availability",
    truth: {
      kind: "not-served",
      transport: "desktop-native-peer-path",
      detail:
        "This composition did not bind the torrent-engine acquisition block — the native peer path is honestly unavailable (provider realizations still resolve through the Experience API transport).",
      nextAction: {
        label: "Watch through the provider ways",
        detail:
          "The provider realizations on each item's Where to watch remain the honest paths; the authorized peer copy returns when the engine is bound in this build.",
      },
    },
  };
}

/** The realtime-bridge truth (the R25 composition's own status). */
function realtimeBridgeEntry(
  input: DesktopCapabilityAvailabilityInput,
): CapabilityAvailabilityEntry {
  if (input.realtimeTranslation.running) {
    return {
      capability: "realtime-bridge",
      truth: {
        kind: "served",
        transport: input.realtimeTranslation.transport ?? "desktop-realtime-translation-seam",
        detail:
          "Realtime translation serves through the Desktop composition's native seam — playback never waits for it, and a failure falls back to the original audio and captions.",
      },
    };
  }
  return {
    capability: "realtime-bridge",
    truth: {
      kind: "not-served",
      transport: "desktop-realtime-translation-seam",
      detail:
        "The realtime translation seam is not serving in this composition — the player's Translate control answers the honest unavailable state.",
      nextAction: {
        label: "Playback and captions still work",
        detail:
          "Base playback and any source captions never depend on the translation bridge; it returns when the realtime composition is bound.",
      },
    },
  };
}

/** The artwork truth (the peer catalog's own + the server carriage). */
function artworkEntry(input: DesktopCapabilityAvailabilityInput): CapabilityAvailabilityEntry {
  if (input.serverArtworkCarried) {
    return {
      capability: "artwork",
      truth: {
        kind: "served",
        transport: "source-artwork-carriage",
        detail:
          "The authorized peer catalog carries its films' official artwork, and the server catalog's rows carry their sources' thumbnails — every discovery surface renders real artwork with the typed placeholder beneath.",
      },
    };
  }
  return {
    capability: "artwork",
    truth: {
      kind: "served",
      transport: "peer-catalog-source-artwork",
      detail:
        "The authorized peer catalog carries its films' official artwork (the films' own sites, typed through the shared artwork contract); the server catalog's artwork carriage is the named API-side dependency.",
    },
  };
}

// ---------------------------------------------------------------------------
// The report derivation (the ONE truth the Desktop UI binds)
// ---------------------------------------------------------------------------

/**
 * Derive the Desktop host's capability-availability report from the
 * composition's own truths (pure; the canonical contract's report
 * builder assembles + validates the entries — the same builder the Web
 * host uses, so the two hosts can never drift in shape).
 */
export function desktopCapabilityAvailability(
  input: DesktopCapabilityAvailabilityInput,
): CapabilityAvailabilityReport {
  return capabilityAvailabilityReportOf([
    ...intelligenceEntries(input),
    realizationAvailabilityEntry(input),
    realtimeBridgeEntry(input),
    artworkEntry(input),
  ]);
}
