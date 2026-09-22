/**
 * @wfx/app-desktop — the PRODUCTION torrent-engine wiring (R26-W3, the
 * corrective production-boot composition).
 *
 * THE GAP THIS MODULE CLOSES (the takeover's forensic truth): the R23-C
 * binding, the R23-E Where-to-watch surface, and the whole R11-R14
 * engine chain landed GREEN — but the production composition never
 * spawned the real engine or wired an authorized realization source, so
 * the capability existed only through the test harness (the exact
 * "engineering evidence, never production acceptance evidence" failure
 * the operator rejected). This module is the REAL production wiring the
 * Desktop boot composes:
 *
 * - THE ENGINE: `createTorrentEngine` over the PINNED production library
 *   seam (`createWebTorrentLibrary` — webtorrent@3.0.21, the frozen
 *   invariant-6 choice), with the data root under the shell's app-data
 *   area (`<appData>/wfx-desktop/torrent-engine`) and the authorized-
 *   source registry (the peer catalog's vault + the composition's
 *   additional sources). NO stubEngine, no fixture fallback — the same
 *   construction law `packages/torrent-engine` freezes.
 * - THE ADAPTER: `createTorrentEngineAdapter` over that engine + the R10
 *   asset store under the same app-data area (the offline-ready
 *   exposure read the acquisition surface consumes).
 * - THE PROVENANCE MINT: the registry's own `authorizeProvenance` — the
 *   ONLY lawful `AuthorizedProvenance` construction path (invariant 5;
 *   the engine re-gates every ingestion through it).
 *
 * Sandbox honesty (the J21-J25 doctrine, unchanged): the deterministic
 * tests inject the scripted engine double; THIS module's construction is
 * proven by the shell-simulator boot (the real composition over the
 * real construction path with the injected library double) and by the
 * lead's real-toolchain procedure (journeys/desktop/README.md). No test
 * path imports this module with a fake library — production code paths
 * only.
 */

import { createTorrentEngine } from "@wfx/torrent-engine";
import type { TorrentEngine } from "@wfx/torrent-engine";
import { createTorrentEngineAdapter } from "@wfx/torrent-engine";
import type { TorrentEngineAdapter, TorrentResult } from "@wfx/torrent-engine";
import { authorizeProvenance } from "@wfx/torrent-engine";
import type {
  AuthorizedProvenance,
  AuthorizedSource,
  AuthorizedSourceRegistry,
} from "@wfx/torrent-engine";
import { createWebTorrentLibrary } from "@wfx/torrent-engine";
import type { TorrentLibrary } from "@wfx/torrent-engine";

import { createPeerCatalogSourceRegistry } from "./peer-catalog";

// ---------------------------------------------------------------------------
// The production engine block (the acquisition seam's real construction)
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopTorrentEngine}. */
export interface DesktopTorrentEngineOptions {
  /**
   * The app-data directory (the shell's `info().appDataDir`); the engine
   * owns `<appData>/wfx-desktop/torrent-engine` beneath it.
   */
  readonly appDataDir: string;
  /**
   * The ADDITIONAL authorized sources the composition carries (the
   * user's media vault…). The peer catalog's source is ALWAYS registered
   * (the production discoverability truth); additional sources with an
   * unlawful basis are dropped (the engine would reject them anyway).
   */
  readonly additionalSources?: readonly AuthorizedSource[];
  /**
   * The library seam — INJECTED. Production leaves this absent (the
   * pinned webtorrent binding); the deterministic shell-simulator boot
   * injects the library double to prove THIS construction path without
   * network contact.
   */
  readonly library?: TorrentLibrary;
  /** Wall clock; defaults to `Date.now`. */
  readonly clock?: () => number;
}

/** The composed production torrent block (the acquisition seam's shape). */
export interface DesktopTorrentEngineBlock {
  /** The real engine (the R11-R14 chain over the injected library). */
  readonly engine: TorrentEngine;
  /** The narrow-seam adapter (the R13 offline-ready exposure read). */
  readonly adapter: TorrentEngineAdapter;
  /** The authorized-source registry (the provenance mint's truth). */
  readonly sources: AuthorizedSourceRegistry;
  /**
   * THE PROVENANCE MINT — the registry's own `authorizeProvenance` (the
   * only lawful construction path; the composition root binds this into
   * the R23-C binding's `mintProvenance`).
   */
  readonly mintProvenance: (sourceId: string) => TorrentResult<AuthorizedProvenance>;
  /** The engine's data root (the app-data area it owns). */
  readonly dataRoot: string;
}

/**
 * Construct the Desktop's PRODUCTION torrent block: the real engine over
 * the pinned webtorrent library, the adapter over the R10 asset store,
 * the authorized-source registry (the peer catalog's vault + the
 * composition's additional sources), and the provenance mint. This is
 * the block `createDesktopApp({ acquisition: … })` consumes in the
 * production boot.
 */
export function createDesktopTorrentEngine(
  options: DesktopTorrentEngineOptions,
): DesktopTorrentEngineBlock {
  if (typeof options.appDataDir !== "string" || options.appDataDir.length === 0) {
    throw new Error(
      "createDesktopTorrentEngine: appDataDir must be a non-empty string (the shell's own app-data truth)",
    );
  }
  const dataRoot = `${options.appDataDir.replace(/\/+$/, "")}/wfx-desktop/torrent-engine`;
  const library =
    options.library ??
    createWebTorrentLibrary({
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
    });
  const sources =
    options.additionalSources !== undefined && options.additionalSources.length > 0
      ? createPeerCatalogSourceRegistry(options.additionalSources)
      : createPeerCatalogSourceRegistry();
  const engine = createTorrentEngine({
    library,
    dataRoot,
    sources,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  });
  const adapter = createTorrentEngineAdapter({
    engine,
    store: { root: `${dataRoot}/assets` },
  });
  return {
    engine,
    adapter,
    sources,
    mintProvenance: (sourceId: string) => authorizeProvenance(sources, sourceId),
    dataRoot,
  };
}
