/**
 * @wfx/app-web — the first-class torrent REALIZATION read model (R23-E).
 *
 * THE LAW THIS MODULE BINDS (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-E, over
 * Worker 1's R23-C contract): torrent is a FIRST-CLASS realization —
 * "Where to watch -> Authorized peer copy", never merely "Offline copy"
 * — eligible for the PRIMARY play decision, never hidden under Settings
 * or a diagnostics panel (those stay progressively disclosed).
 *
 * THE FROZEN VOCABULARY consumed verbatim (never re-derived):
 * - `TORRENT_REALIZATION_VIEW` — the primary entry label/detail;
 * - `WHERE_TO_WATCH_GROUP_VIEWS` — the grouping vocabulary (WebFlix
 *   source first, the authorized peer copy second, other realizations
 *   last) — Web renders the IDENTICAL grouping the Desktop renders;
 * - `torrentRungSatisfaction` — the platform rung decision (the Web
 *   adapter's declared browser-torrent capability from R23-D);
 * - `TORRENT_ACQUISITION_STATES` — the protocol-free lifecycle,
 *   reused verbatim (Available -> Preparing -> Buffering -> Playing ->
 *   Completing -> Ready offline / Failed).
 *
 * HONEST DATA TRUTH: the per-item authorized peer copy declarations are
 * a HOST read — the DEV fixtures feed provides them in fixtures mode
 * (the loud dev badge — the same law as the acquisition script feed);
 * SERVICE mode has no peer-copy data exposed by the transport yet, so
 * the read honestly answers `null` (the entry never renders — a fixture
 * is never silently presented as production capability).
 */

import {
  TORRENT_REALIZATION_VIEW,
  torrentRungSatisfaction,
} from "@wfx/client-runtime";
import type {
  TorrentRealizationDeclaration,
  TorrentRungSatisfaction,
} from "@wfx/client-runtime";

import { WEB_BROWSER_TORRENT_SUPPORTED } from "@/platform/browser-torrent";
import type { WebRuntimeHost } from "./web-host";
import { torrentRealizationFixtureOf } from "./acquisition-fixtures";

// ---------------------------------------------------------------------------
// The platform truth (R23-D's adapter-declared capability)
// ---------------------------------------------------------------------------

/**
 * The Web platform truth every rung decision on this adapter consumes —
 * the R23-D adapter-declared browser torrent capability (never an
 * assumption: the browser adapter is wired, and the per-realization
 * `browserCapable` + per-environment WebRTC truths decide each play).
 */
export const WEB_TORRENT_PLATFORM_TRUTH = {
  platform: "web" as const,
  browserTorrentSupported: WEB_BROWSER_TORRENT_SUPPORTED,
};

// ---------------------------------------------------------------------------
// The view (one item's authorized peer copy, first-class)
// ---------------------------------------------------------------------------

/** One item's authorized peer copy as a WHERE-TO-WATCH entry. */
export interface TorrentRealizationView {
  /** The R23-C declaration (authorized + browser-capable truth). */
  readonly declaration: TorrentRealizationDeclaration;
  /** The frozen primary entry label ("Authorized peer copy"). */
  readonly label: string;
  /** The frozen one-sentence detail (rendered verbatim). */
  readonly detail: string;
  /** The platform rung decision for THIS adapter (R23-C, verbatim). */
  readonly rung: TorrentRungSatisfaction;
  /**
   * Whether this adapter can PLAY the peer copy now (the browser rung
   * is satisfied — the "Play this way" path is real).
   */
  readonly playableHere: boolean;
  /**
   * Present when a typed reason keeps this adapter from playing it (the
   * honest Desktop next step / the authorization gate) — rendered as
   * the entry's truth, never a dead "unavailable".
   */
  readonly notPlayableHereReason: string | null;
}

/** Derive one declaration's view (pure; the rung decision, verbatim). */
export function torrentRealizationViewOf(
  declaration: TorrentRealizationDeclaration,
): TorrentRealizationView {
  const rung = torrentRungSatisfaction(WEB_TORRENT_PLATFORM_TRUTH, declaration);
  return {
    declaration,
    label: TORRENT_REALIZATION_VIEW.label,
    detail: TORRENT_REALIZATION_VIEW.detail,
    rung,
    playableHere: rung.kind === "satisfies-browser-rung",
    notPlayableHereReason:
      rung.kind === "desktop-next-step"
        ? rung.detail
        : rung.kind === "requires-authorization"
          ? rung.detail
          : null,
  };
}

/**
 * The per-item authorized peer copy read (the host's honest data truth):
 * the fixtures feed in fixtures mode (loudly badged), the honest `null`
 * in service mode (no transport-exposed peer-copy data yet — the entry
 * never renders there until the service carries one).
 */
export function torrentRealizationOf(
  host: WebRuntimeHost,
  externalRef: string,
): TorrentRealizationView | null {
  if (host.mode !== "fixtures") return null;
  const declaration = torrentRealizationFixtureOf(externalRef);
  if (declaration === null) return null;
  return torrentRealizationViewOf(declaration);
}
