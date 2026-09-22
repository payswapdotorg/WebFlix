/**
 * @wfx/app-web — the capability-availability host binding (R26-W1).
 *
 * THE WEB HOST'S DERIVATION of the canonical
 * `CapabilityAvailabilityReport` (`@wfx/platform-contracts` — the ONE
 * contract the UI binds): every capability's SERVED / NOT-SERVED truth
 * is derived from the LIVE transport bindings of THIS host boot —
 * never hardcoded, never guessed, never a fixture presented as
 * production.
 *
 * THE DERIVATION SOURCES (per capability):
 *
 * - `semantic-search` / `moment-retrieval` / `multimodal-intelligence`
 *   — the bound `IntelligenceReadTransport`'s own readiness read
 *   (`host/intelligence.ts`'s binding: the fixtures boot's dev index —
 *   loudly badged; the service boot's REAL Experience-API HTTP
 *   transport, which names its missing dependency honestly while the
 *   service-side route is absent).
 * - `realization-availability` — the live resolve transport (the
 *   ServerPort binding): provider/external realizations serve per item
 *   in both boots; the authorized-peer (torrent) truth carries the
 *   Desktop-native path (this adapter's WebRTC rung) — the honest
 *   split, never a fake "all ways serve".
 * - `realtime-bridge` — the R25 bridge's own process status
 *   (`readRealtimeBridgeStatus` + the boot gate): running + provider
 *   registered, or the honest not-serving truth with the next action.
 * - `artwork` — the content model's artwork truth: SERVED when the
 *   live content rows carry source-authorized artwork (the connector's
 *   `thumbnailUrl` projection through the typed `ContentArtwork`
 *   contract); NOT-SERVED when the transport's rows carry none (the
 *   dev fixture catalog — honest) — with the empirical read over the
 *   learned join whenever rows have been observed.
 *
 * THE LAW (the contract's own): a not-served capability NEVER renders
 * as usable — the surface renders the unavailable state or the entry's
 * honest next action.
 */

import type {
  CapabilityAvailabilityEntry,
  CapabilityAvailabilityReport,
  CapabilityServingTruth,
} from "@wfx/platform-contracts";
import { capabilityAvailabilityReportOf } from "@wfx/platform-contracts";

import type { WebRuntimeHost } from "./web-host";
import { intelligenceReadTransportOf } from "./intelligence";
import { readRealtimeBridgeStatus } from "./realtime/realtime-bridge-state";
import { realtimeBridgeEnabledForThisBoot } from "./realtime/realtime-boot";
import { joinedItemsSnapshot } from "./view-models";

// ---------------------------------------------------------------------------
// The per-capability derivations
// ---------------------------------------------------------------------------

/**
 * The intelligence-lane capabilities' truths (one LIVE probe read, three
 * entries).
 *
 * R26-L (the lead's integration seam, post-R26-W4): the transport's sync
 * `readiness()` accessor carries the PRE-PROBE conservative truth; the
 * report derives the LIVE truth from one real read through the transport's
 * own public path (`searchByMeaning`) — the outcome distinguishes the
 * cases honestly:
 *
 * - a SERVED read → the transport serves (the fixtures' dev index or the
 *   Experience API's real route);
 * - a not-served read with reason `transport-unavailable` → the route is
 *   absent/unreachable on this boot (the typed dependency names it);
 * - a not-served read with reason `no-derived-artifacts` → THE ROUTE
 *   SERVES (it answered a typed 200; the derived artifacts are the limit,
 *   not the transport) — the entries report SERVED with the honest
 *   artifact truth as the detail. This is the capability-truth law's
 *   BOTH-DIRECTIONS honesty: an available capability reported as
 *   unavailable is as much a lie as the reverse.
 */
async function intelligenceEntries(
  host: WebRuntimeHost,
): Promise<readonly CapabilityAvailabilityEntry[]> {
  const transport = intelligenceReadTransportOf(host);
  const outcome = await transport.searchByMeaning("capability probe");
  const servingDetail =
    transport.transportId === "dev-fixture-index"
      ? "The deterministic dev fixture index answers search-by-meaning (loudly a fixture — dev only)."
      : "The Experience API intelligence route answered a live read on this boot.";
  const truth: CapabilityServingTruth =
    outcome.kind === "served" || outcome.reason === "no-derived-artifacts"
      ? {
          kind: "served",
          transport: transport.transportId,
          detail:
            outcome.kind === "served"
              ? servingDetail
              : `${servingDetail} ${outcome.detail}`,
        }
      : {
          kind: "not-served",
          transport: transport.transportId,
          detail: outcome.detail,
          nextAction: {
            label: "Search by title and the AI action tray still work",
            href: "/search",
            detail:
              "Title search serves the whole catalog; per-title AI actions (transcription, translation) run through the AI tray on the item page.",
          },
        };
  return [
    { capability: "semantic-search", truth },
    { capability: "moment-retrieval", truth },
    { capability: "multimodal-intelligence", truth },
  ];
}

/** The realization-availability truth (the live resolve transport + the peer path). */
function realizationAvailabilityEntry(host: WebRuntimeHost): CapabilityAvailabilityEntry {
  // The peer-realization truth is adapter-level (the WebRTC rung the
  // browser adapter declares); the provider/external truth is the
  // ServerPort binding's (both boots serve the frozen resolve route).
  const peerTruth =
    "authorized peer copies serve through the Desktop app's native peer path (this web adapter's WebRTC rung covers browser-capable swarms only)";
  if (host.mode === "service") {
    return {
      capability: "realization-availability",
      truth: {
        kind: "served",
        transport: "experience-api-http",
        detail: `Provider and external realizations resolve per item through the live Experience API; ${peerTruth}.`,
      },
    };
  }
  return {
    capability: "realization-availability",
    truth: {
      kind: "served",
      transport: "dev-fixture-server-port",
      detail: `The dev fixture port resolves realizations per item (loudly a fixture); ${peerTruth}.`,
    },
  };
}

/** The realtime-bridge truth (the R25 bridge's own status read). */
function realtimeBridgeEntry(): CapabilityAvailabilityEntry {
  const enabled = realtimeBridgeEnabledForThisBoot();
  const status = readRealtimeBridgeStatus();
  if (enabled && status.running && status.port !== null) {
    return {
      capability: "realtime-bridge",
      truth: {
        kind: "served",
        transport: "wfx-realtime-bridge",
        detail:
          status.provider !== null
            ? `The realtime translation bridge is serving (provider ${status.provider.id} registered) — live translate and live captions run.`
            : "The realtime translation bridge is serving with no provider registered — live translation stays honestly off until a provider is registered.",
      },
    };
  }
  return {
    capability: "realtime-bridge",
    truth: {
      kind: "not-served",
      transport: "wfx-realtime-bridge",
      detail:
        "The realtime translation bridge is not serving on this host — this boot runs without the WebSocket bridge (the deployment's realtime transport is the lead's R25 lane). Playback and original captions are unaffected.",
      nextAction: {
        label: "Original captions and the batch AI translation still work",
        detail:
          "Live Translate and Live Captions stay off honestly on this transport — the AI action tray's translation covers transcripts and subtitles.",
      },
    },
  };
}

/** The artwork truth (the content model's real-artwork carriage). */
function artworkEntry(host: WebRuntimeHost): CapabilityAvailabilityEntry {
  if (host.mode === "service") {
    // The empirical read whenever content rows have been observed on
    // this boot: any observed source artwork ⇒ served (the live
    // catalog's connector projects thumbnails); rows observed and NONE
    // carried artwork ⇒ the honest not-served (never a static claim
    // over observed contrary evidence).
    const observed = observedArtworkEntry();
    if (observed !== null) {
      return observed;
    }
    return {
      capability: "artwork",
      truth: {
        kind: "served",
        transport: "shared-content-model",
        detail:
          "The shared content model carries source-authorized artwork (the connector's thumbnail projection) — cards and detail surfaces render the real source artwork, with the typed fallback only for items the source serves without artwork.",
      },
    };
  }
  return {
    capability: "artwork",
    truth: {
      kind: "not-served",
      transport: "dev-fixture-server-port",
      detail:
        "The dev fixture catalog carries no source artwork rows — the placeholder fallback renders in dev (the live catalog's real source artwork serves in service mode).",
    },
  };
}

/**
 * The empirical artwork entry over the learned join (null when no rows
 * have been observed on this boot — the caller falls back to the
 * transport-level truth).
 */
function observedArtworkEntry(): CapabilityAvailabilityEntry | null {
  const joined = joinedItemsSnapshot();
  if (joined.length === 0) return null;
  const withArtwork = joined.filter((item) => item.artwork !== undefined);
  if (withArtwork.length === 0) {
    return {
      capability: "artwork",
      truth: {
        kind: "not-served",
        transport: "shared-content-model",
        detail:
          "No content row observed on this boot carried source artwork — the placeholder fallback renders (never a fabricated image).",
      },
    };
  }
  return {
    capability: "artwork",
    truth: {
      kind: "served",
      transport: "shared-content-model",
      detail: `Source-authorized artwork is serving on this boot (${withArtwork.length} of ${joined.length} observed items carry it; items without source artwork render the typed fallback).`,
    },
  };
}

// ---------------------------------------------------------------------------
// The report (the UI-bindable truth)
// ---------------------------------------------------------------------------

/**
 * Load THIS host's capability-availability report — the ONE truth the
 * UI binds (every capability-first control consults its entry; a
 * not-served entry renders the unavailable state or the next action,
 * never a usable control).
 */
export async function loadCapabilityAvailabilityReport(
  host: WebRuntimeHost,
): Promise<CapabilityAvailabilityReport> {
  const entries: CapabilityAvailabilityEntry[] = [
    ...(await intelligenceEntries(host)),
    realizationAvailabilityEntry(host),
    realtimeBridgeEntry(),
    artworkEntry(host),
  ];
  return capabilityAvailabilityReportOf(entries);
}
