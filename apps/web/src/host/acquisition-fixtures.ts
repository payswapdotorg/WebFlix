/**
 * @wfx/app-web — the DEV-ONLY acquisition fixture feed (R14).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * This module exists ONLY in fixtures mode (`WFX_DEV_FIXTURES=1` — the loud
 * dev badge): a deterministic, scripted acquisition feed that reports
 * PROTOCOL-FREE facts through the REAL runtime acquisition store
 * (`runtime.acquisition.report` → `mapAcquisitionStatus` → the views) —
 * the SAME code path every production adapter's facts flow through. It is
 * how the J21-J26 web surfaces are browser-validated before the service
 * lane serves real acquisition data. In service mode NOTHING here runs:
 * the seed never reports, the drive refuses, and the surfaces render
 * their honest empty states (a fixture is never silently presented as
 * production capability — frozen invariant 10).
 *
 * HONESTY LAWS KEPT HERE:
 * - READS NEVER ADVANCE THE SCRIPT: GETs are pure; only the typed POST
 *   actions (and the clearly-labeled dev "advance" drive) move the
 *   cursor — no fake progress on read.
 * - THE SCRIPTS ARE LAWFUL SEQUENCES: every adjacent pair of scripted
 *   fact sets is a DIRECT edge of the acquisition transition graph (the
 *   store's observation law enforces it — a broken script throws).
 * - THE DIAGNOSTICS ARE THE GATED VOCABULARY: protocol fields render
 *   ONLY through `AcquisitionDiagnosticsView` inside the explicitly
 *   gated advanced-diagnostics disclosure.
 *
 * THE DEV-SERVER SPLIT-MODULE REALITY (why the cursor state is
 * FILE-BACKED): the Turbopack dev server compiles every route as its own
 * module graph — the item page's runtime and the /api/acquisition route's
 * runtime are SEPARATE module instances with separate registries and
 * stores (the same dev-mode split that isolates the events route's watch
 * fold from the library page's read). The scripted CURSOR state therefore
 * lives in a small JSON file both module instances share: the POST
 * (route module) advances it; every page render (page module) re-reads it
 * and reports the current facts into THE PAGE'S OWN runtime store under
 * the page's own registry ids. Production (one server bundle) and the
 * in-process tests share one module — the same code path works unchanged.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AcquisitionDiagnosticsView,
  AcquisitionFacts,
  AcquisitionStatusView,
  ClientRuntime,
} from "@wfx/client-runtime";

// ---------------------------------------------------------------------------
// The scripted journeys (fixtures-mode-only content)
// ---------------------------------------------------------------------------

/** One scripted item: a stepwise fact sequence + its protocol overlay. */
interface ScriptedAcquisition {
  /** The stable cross-process key: the fixture catalog's external ref. */
  readonly externalRef: string;
  /** The search that learns the item's canonical id (deterministic). */
  readonly searchQuery: string;
  /** The lawful stepwise journey (step 0 is reported at seed). */
  readonly script: readonly AcquisitionFacts[];
  /** The protocol overlay (the GATED diagnostics vocabulary). */
  readonly protocol: {
    readonly infoHash: string;
    readonly peersConnected: number;
    readonly piecesVerified: number;
    readonly piecesTotal: number;
    readonly downloadBytesPerSec: number;
    readonly uploadBytesPerSec: number;
    readonly sourceId: string;
    readonly basis: string;
    readonly dataDir: string;
  };
  /**
   * R23-E — the item's authorized PEER COPY declaration (the first-class
   * torrent realization truth): `authorized` is the R11/R13 gate (every
   * fixture copy carries the user-owned/licensed provenance basis the
   * protocol overlay records); `browserCapable` is the honest per-SWARM
   * truth — which fixture swarms are WebRTC-hybrid (reachable from a
   * browser) and which are ordinary TCP/UDP-only swarms (the honest
   * Desktop next step on Web — the capability truth R23-C demands).
   */
  readonly torrent: {
    readonly authorized: true;
    readonly browserCapable: boolean;
  };
  /** The learned canonical item id (set at seed — PER MODULE INSTANCE). */
  itemId: string | null;
}

const T0 = Date.parse("2026-09-18T12:00:00.000Z");

/**
 * J21→J24→J26 — the full honest journey (Asteroid Drift): available →
 * preparing (locating, choosing) → completing (the plain offline copy) →
 * buffering (playback declared before completion — J23) → playing (the
 * healthy truth) → buffering (the truthful rebuffer demotion) →
 * completing (background completion — J24) → verifying → completed →
 * ready-offline (the EARNED exposure — J26).
 */
const asteriodScript: readonly AcquisitionFacts[] = [
  { itemId: "PENDING", title: "Asteroid Drift" },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "locating", paused: false, progressFraction: null },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "choosing-files", paused: false, progressFraction: 0 },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.33 },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.45 },
    playback: { activity: "starting", runwaySeconds: 0, deadlineAtRisk: false, playableNow: false },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.55 },
    playback: { activity: "playing", runwaySeconds: 92, deadlineAtRisk: false, playableNow: true },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.58 },
    playback: { activity: "playing", runwaySeconds: 3, deadlineAtRisk: true, playableNow: true },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.8 },
    playback: { activity: "completing-in-background", runwaySeconds: null, deadlineAtRisk: false, playableNow: true },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "verifying", paused: false, progressFraction: 1 },
    playback: { activity: "completing-in-background", runwaySeconds: null, deadlineAtRisk: false, playableNow: true },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    transfer: { phase: "completed", paused: false, progressFraction: 1 },
  },
  {
    itemId: "PENDING",
    title: "Asteroid Drift",
    offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 88_912, exposedAtMs: T0 },
  },
];

/** J26 — an already-verified offline copy (Harbor Lights). */
const harborScript: readonly AcquisitionFacts[] = [
  {
    itemId: "PENDING",
    title: "Harbor Lights",
    offlineReady: { verified: true, degraded: false, assetCount: 2, sizeBytes: 1_572_864, exposedAtMs: T0 },
  },
];

/** J25 — an interrupted session resumed with real retained progress (Deep Field Diary). */
const deepFieldScript: readonly AcquisitionFacts[] = [
  {
    itemId: "PENDING",
    title: "Deep Field Diary",
    transfer: {
      phase: "transferring",
      paused: false,
      progressFraction: 0.62,
      resumed: { retainedFraction: 0.55, pieceMapReused: true },
    },
    playback: { activity: "completing-in-background", runwaySeconds: null, deadlineAtRisk: false, playableNow: true },
  },
  {
    itemId: "PENDING",
    title: "Deep Field Diary",
    transfer: {
      phase: "completed",
      paused: false,
      progressFraction: 1,
      resumed: { retainedFraction: 0.55, pieceMapReused: true },
    },
  },
  {
    itemId: "PENDING",
    title: "Deep Field Diary",
    offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 629_145, exposedAtMs: T0 },
  },
];

/** A RECOVERABLE failure with the typed retry (Desert Rain Doc). */
const desertScript: readonly AcquisitionFacts[] = [
  {
    itemId: "PENDING",
    title: "Desert Rain Doc",
    failure: { cause: "source-problem", detail: "The download source had a problem. You can try again." },
  },
  {
    itemId: "PENDING",
    title: "Desert Rain Doc",
    transfer: { phase: "locating", paused: false, progressFraction: null },
  },
  {
    itemId: "PENDING",
    title: "Desert Rain Doc",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.4 },
  },
  {
    itemId: "PENDING",
    title: "Desert Rain Doc",
    offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 943_718, exposedAtMs: T0 },
  },
];

/**
 * R17/J29 — the network-loss + interrupted-session journey (Static
 * Bloom): healthy transfer → connection lost (the MEASURED starvation
 * truth: nothing arriving, 0 B/s, 0 connected sources — never a fake
 * moving bar) → the session interrupted and paused with its retained
 * progress (the explicit resume-or-clean-restart choice) → resumed and
 * progressed (never fresh, never falsely complete) → earned offline.
 */
const staticBloomScript: readonly AcquisitionFacts[] = [
  { itemId: "PENDING", title: "Static Bloom" },
  {
    itemId: "PENDING",
    title: "Static Bloom",
    transfer: { phase: "locating", paused: false, progressFraction: null },
  },
  {
    itemId: "PENDING",
    title: "Static Bloom",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.35 },
  },
  {
    itemId: "PENDING",
    title: "Static Bloom",
    transfer: {
      phase: "transferring",
      paused: false,
      progressFraction: 0.35,
      starved: { stalledMs: 92_000, bytesPerSecond: 0, sourcesConnected: 0 },
    },
  },
  {
    itemId: "PENDING",
    title: "Static Bloom",
    transfer: {
      phase: "transferring",
      paused: true,
      progressFraction: 0.35,
      resumed: { retainedFraction: 0.35, pieceMapReused: true },
    },
  },
  {
    itemId: "PENDING",
    title: "Static Bloom",
    transfer: {
      phase: "transferring",
      paused: false,
      progressFraction: 0.55,
      resumed: { retainedFraction: 0.35, pieceMapReused: true },
    },
  },
  {
    itemId: "PENDING",
    title: "Static Bloom",
    offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 753_664, exposedAtMs: T0 },
  },
];

/**
 * R17 — the metadata-failure journey (Midnight Scoop): the details could
 * not be found (the named `details-not-found` state with its retry) → the
 * retry lands preparing → transfers → earned offline. The UX mirror of
 * the engine's typed `metadata-failed` dead end.
 */
const midnightScoopScript: readonly AcquisitionFacts[] = [
  { itemId: "PENDING", title: "Midnight Scoop" },
  {
    itemId: "PENDING",
    title: "Midnight Scoop",
    transfer: { phase: "locating", paused: false, progressFraction: null },
  },
  {
    itemId: "PENDING",
    title: "Midnight Scoop",
    failure: {
      cause: "details-not-found",
      detail: "The details for this title could not be found right now. You can try again — the source may come back.",
    },
  },
  {
    itemId: "PENDING",
    title: "Midnight Scoop",
    transfer: { phase: "locating", paused: false, progressFraction: null },
  },
  {
    itemId: "PENDING",
    title: "Midnight Scoop",
    transfer: { phase: "transferring", paused: false, progressFraction: 0.5 },
  },
  {
    itemId: "PENDING",
    title: "Midnight Scoop",
    offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 524_288, exposedAtMs: T0 },
  },
];

/** The scripted items (fixture content — deterministic order). */
const SCRIPTED: readonly ScriptedAcquisition[] = [
  {
    externalRef: "fake:movie-1",
    torrent: { authorized: true, browserCapable: true },
    searchQuery: "Asteroid",
    script: asteriodScript,
    protocol: {
      infoHash: "0123456789abcdef0123456789abcdef01234567",
      peersConnected: 7,
      piecesVerified: 20,
      piecesTotal: 61,
      downloadBytesPerSec: 262_144,
      uploadBytesPerSec: 32_768,
      sourceId: "vault:family-media",
      basis: "user-owned",
      dataDir: "<app-data>/webflix/native-media/sessions/wfx-ts-1/data",
    },
    itemId: null,
  },
  {
    externalRef: "fake:series-1",
    torrent: { authorized: true, browserCapable: false },
    searchQuery: "Harbor",
    script: harborScript,
    protocol: {
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
      peersConnected: 0,
      piecesVerified: 61,
      piecesTotal: 61,
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
      sourceId: "vault:family-media",
      basis: "user-owned",
      dataDir: "<app-data>/webflix/native-media/sessions/wfx-ts-2/data",
    },
    itemId: null,
  },
  {
    externalRef: "fake:video-1",
    torrent: { authorized: true, browserCapable: true },
    searchQuery: "Deep Field",
    script: deepFieldScript,
    protocol: {
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      peersConnected: 4,
      piecesVerified: 34,
      piecesTotal: 55,
      downloadBytesPerSec: 131_072,
      uploadBytesPerSec: 16_384,
      sourceId: "vault:family-media",
      basis: "user-owned",
      dataDir: "<app-data>/webflix/native-media/sessions/wfx-ts-3/data",
    },
    itemId: null,
  },
  {
    externalRef: "fake:video-3",
    torrent: { authorized: true, browserCapable: false },
    searchQuery: "Desert Rain",
    script: desertScript,
    protocol: {
      infoHash: "9876543210fedcba9876543210fedcba98765432",
      peersConnected: 0,
      piecesVerified: 0,
      piecesTotal: 40,
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
      sourceId: "vault:family-media",
      basis: "user-owned",
      dataDir: "<app-data>/webflix/native-media/sessions/wfx-ts-4/data",
    },
    itemId: null,
  },
  {
    // R17 fix (lead integration): re-keyed from fake:video-2 (whose
    // no-metadata catalog entry is a frozen law — the item page can never
    // mount the acquisition panel for it) to the metadata-bearing
    // fake:video-4 "Signal Fade" catalog item (query-collision-free — the
    // "bloom" feed-fallback test keeps its single-card truth). The script
    // facts keep the "Static Bloom" view title (tests assert it by title).
    externalRef: "fake:video-4",
    torrent: { authorized: true, browserCapable: true },
    searchQuery: "Signal Fade",
    script: staticBloomScript,
    protocol: {
      infoHash: "5555555555555555555555555555555555555555",
      peersConnected: 0,
      piecesVerified: 14,
      piecesTotal: 40,
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
      sourceId: "vault:family-media",
      basis: "user-owned",
      dataDir: "<app-data>/webflix/native-media/sessions/wfx-ts-5/data",
    },
    itemId: null,
  },
  {
    externalRef: "fake:short-2",
    torrent: { authorized: true, browserCapable: false },
    searchQuery: "Midnight Scoop",
    script: midnightScoopScript,
    protocol: {
      infoHash: "4444444444444444444444444444444444444444",
      peersConnected: 0,
      piecesVerified: 0,
      piecesTotal: 24,
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
      sourceId: "vault:family-media",
      basis: "user-owned",
      dataDir: "<app-data>/webflix/native-media/sessions/wfx-ts-6/data",
    },
    itemId: null,
  },
];

// ---------------------------------------------------------------------------
// The file-backed cursor state (shared by the dev server's route modules)
// ---------------------------------------------------------------------------

/** The shared dev-state file (fixed path: the page + route modules agree). */
const FIXTURE_STATE_PATH = join(tmpdir(), "wfx-dev-acquisition-fixtures.json");

/** The per-item drive state (the only mutable fixture truth). */
interface FixtureDriveState {
  readonly cursor: number;
  readonly paused: boolean;
  readonly dismissed: boolean;
  /** R17 — the clean-restart marker: the saved progress was discarded; the store clears before reporting (a fresh attempt, never a false continuation). */
  readonly restarted: boolean;
}

const INITIAL_DRIVE: FixtureDriveState = { cursor: 0, paused: false, dismissed: false, restarted: false };

/** Read the whole drive state (missing/corrupt file ⇒ the initial state). */
function readDriveState(): Map<string, FixtureDriveState> {
  const byRef = new Map<string, FixtureDriveState>();
  if (!existsSync(FIXTURE_STATE_PATH)) return byRef;
  try {
    const parsed = JSON.parse(readFileSync(FIXTURE_STATE_PATH, "utf8")) as {
      byRef?: Record<string, Partial<FixtureDriveState>>;
    };
    for (const [externalRef, raw] of Object.entries(parsed.byRef ?? {})) {
      byRef.set(externalRef, {
        cursor: typeof raw.cursor === "number" ? raw.cursor : 0,
        paused: raw.paused === true,
        dismissed: raw.dismissed === true,
        restarted: raw.restarted === true,
      });
    }
  } catch {
    // A corrupt file is the initial state (the dev harness is disposable).
  }
  return byRef;
}

/** Persist the whole drive state (best-effort — dev harness only). */
function writeDriveState(byRef: Map<string, FixtureDriveState>): void {
  const serializable: Record<string, FixtureDriveState> = {};
  for (const [externalRef, state] of byRef) serializable[externalRef] = state;
  try {
    writeFileSync(FIXTURE_STATE_PATH, JSON.stringify({ byRef: serializable }, null, 2));
  } catch {
    // A failed write leaves the previous state (dev harness only).
  }
}

// ---------------------------------------------------------------------------
// The per-module-instance seeding + reporting (through the REAL store)
// ---------------------------------------------------------------------------

let seeded = false;

/** Whether the fixture feed is active (fixtures mode, post-seed). */
export function acquisitionFixturesActive(): boolean {
  return seeded;
}

/** The scripted item of an item id (null when not scripted — per instance). */
function scriptedOf(itemId: string): ScriptedAcquisition | undefined {
  return SCRIPTED.find((item) => item.itemId === itemId);
}

/** The scripted item of a stable external ref (the cross-module key). */
function scriptedByRef(ref: string): ScriptedAcquisition | undefined {
  return SCRIPTED.find((item) => item.externalRef === ref);
}

/**
 * R23-E — the item's authorized peer-copy DECLARATION (the first-class
 * torrent realization truth) or the honest `null` (no authorized copy is
 * known for the item). FIXTURES MODE ONLY (the loud dev badge); the
 * shape is the shared `TorrentRealizationDeclaration` (R23-C), consumed
 * verbatim by the Where-to-watch surface — never re-derived.
 */
export function torrentRealizationFixtureOf(externalRef: string): {
  readonly transport: "torrent";
  readonly authorized: boolean;
  readonly browserCapable: boolean;
  readonly accessClass: "public";
} | null {
  const item = scriptedByRef(externalRef);
  if (item === undefined) return null;
  // The authorized peer copy needs no provider sign-in: the honest R23-A
  // access class is public (the R23-C declaration law).
  return {
    transport: "torrent",
    authorized: item.torrent.authorized === true,
    browserCapable: item.torrent.browserCapable,
    accessClass: "public",
  };
}

/**
 * Learn each scripted item's canonical id through the runtime's own search
 * (the registry's per-instance mint — deterministic within the module).
 * Idempotent per module instance.
 */
async function learnItemIds(runtime: ClientRuntime): Promise<void> {
  for (const item of SCRIPTED) {
    if (item.itemId !== null) continue;
    const model = await runtime.search({ query: item.searchQuery });
    const hit = model.hits[0];
    if (hit === undefined) continue; // the fixture catalog is fixed; cannot happen
    item.itemId = hit.canonicalItemId;
  }
}

/** The CURRENT facts of one scripted item at a drive state (pure). */
function factsAt(item: ScriptedAcquisition, drive: FixtureDriveState): AcquisitionFacts {
  const base = { ...item.script[Math.min(drive.cursor, item.script.length - 1)]!, itemId: item.itemId! };
  if (base.transfer !== undefined && drive.paused) {
    return { ...base, transfer: { ...base.transfer, paused: true } };
  }
  return base;
}

/**
 * Report EVERY scripted item's CURRENT facts (from the shared drive state)
 * into THIS runtime's acquisition store — the per-render refresh the page
 * renders from (and the boot-time seed). Dismissed items are cleared and
 * re-reported at step 0 (the honest reset).
 */
export function reportAcquisitionFixtures(host: {
  readonly mode: "fixtures" | "service";
  readonly runtime: ClientRuntime;
}): void {
  if (host.mode !== "fixtures") return;
  if (!seeded) return;
  const byRef = readDriveState();
  for (const item of SCRIPTED) {
    if (item.itemId === null) continue;
    const drive = byRef.get(item.externalRef) ?? INITIAL_DRIVE;
    if (drive.dismissed || drive.restarted) {
      // The dismissal/clean-restart path: the old view is cleared first —
      // the next report is a FRESH observation (never a false continuation
      // of the discarded attempt).
      host.runtime.acquisition.clear(item.itemId);
      host.runtime.acquisition.report(factsAt(item, drive));
      continue;
    }
    host.runtime.acquisition.report(factsAt(item, drive));
  }
}

/**
 * Seed the fixture feed (fixtures mode ONLY — the caller enforces the
 * environment law): learn the canonical ids, then report every item's
 * CURRENT facts. Idempotent per module instance.
 */
export async function seedAcquisitionFixtures(host: {
  readonly mode: "fixtures" | "service";
  readonly runtime: ClientRuntime;
}): Promise<void> {
  if (host.mode !== "fixtures") {
    throw new Error("seedAcquisitionFixtures: fixtures mode only (the 050 environment law)");
  }
  if (seeded) return;
  await learnItemIds(host.runtime);
  seeded = true;
  reportAcquisitionFixtures(host);
}

/** The typed result the drive answers with. */
export type AcquisitionDriveResult =
  | { readonly ok: true; readonly view: AcquisitionStatusView }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * Drive one scripted item (the fixtures-mode POST path): the typed
 * actions + the clearly-labeled dev "advance" step, persisted to the
 * SHARED drive-state file (both dev-server route modules see it) and
 * reported into THIS runtime's store (the in-process/tests path). READS
 * NEVER ADVANCE.
 */
export function driveAcquisitionFixture(
  host: {
    readonly mode: "fixtures" | "service";
    readonly runtime: ClientRuntime;
  },
  input: { readonly itemId: string; readonly action: string; readonly ref?: string },
): AcquisitionDriveResult {
  if (host.mode !== "fixtures") {
    return {
      ok: false,
      status: 503,
      error:
        "native acquisition actions run in the WebFlix desktop app — the web transport serves reads only",
    };
  }
  // The external ref is the STABLE cross-module key (the dev server's route
  // modules carry separate registries): resolve by ref first, then by the
  // itemId this module instance minted.
  const item = (input.ref !== undefined ? scriptedByRef(input.ref) : undefined) ?? scriptedOf(input.itemId);
  if (item === undefined || item.itemId === null) {
    return { ok: false, status: 404, error: `no acquisition is known for '${input.itemId}'` };
  }
  const runtime = host.runtime;
  const byRef = readDriveState();
  const drive = byRef.get(item.externalRef) ?? INITIAL_DRIVE;

  const persist = (next: FixtureDriveState): AcquisitionStatusView => {
    byRef.set(item.externalRef, next);
    writeDriveState(byRef);
    if (next.dismissed) {
      runtime.acquisition.clear(item.itemId!);
      runtime.acquisition.report(factsAt(item, { ...INITIAL_DRIVE }));
    } else {
      runtime.acquisition.report(factsAt(item, next));
    }
    return runtime.acquisition.view(item.itemId!)!;
  };

  switch (input.action) {
    case "advance": {
      if (drive.dismissed) {
        return { ok: false, status: 409, error: "the failure was dismissed — start a new offline copy" };
      }
      const last = item.script.length - 1;
      if (drive.cursor >= last) {
        return { ok: true, view: persist(drive) }; // the script's end (idempotent)
      }
      // R17 — a post-restart advance returns to normal observation (the
      // fresh attempt is now an ordinary session).
      return {
        ok: true,
        view: persist({ ...drive, cursor: drive.cursor + 1, restarted: false }),
      };
    }
    case "acquire": {
      if (drive.cursor !== 0 || drive.dismissed) {
        return { ok: false, status: 409, error: "the offline copy is already being prepared" };
      }
      return { ok: true, view: persist({ ...INITIAL_DRIVE, cursor: 1 }) };
    }
    case "retry": {
      const current = runtime.acquisition.view(item.itemId!);
      if (current === null || current.state !== "failed" || current.failure?.recoverable !== true) {
        return { ok: false, status: 409, error: "retry applies to a recoverable failure" };
      }
      return { ok: true, view: persist({ ...INITIAL_DRIVE, cursor: 1 }) };
    }
    case "restart": {
      // R17 — the CLEAN RESTART of an interrupted session: discard the
      // saved progress and start over. The marker clears the old view
      // before the fresh attempt reports (a fresh observation — never a
      // false continuation, never a silent progress reset).
      const current = runtime.acquisition.view(item.itemId!);
      if (current === null || !current.resumed) {
        return {
          ok: false,
          status: 409,
          error: "restart applies to an interrupted session with saved progress (use retry for failures)",
        };
      }
      runtime.acquisition.clear(item.itemId!);
      const next: FixtureDriveState = { ...INITIAL_DRIVE, cursor: 1, restarted: true };
      byRef.set(item.externalRef, next);
      writeDriveState(byRef);
      runtime.acquisition.report(factsAt(item, next));
      return { ok: true, view: runtime.acquisition.view(item.itemId!)! };
    }
    case "pause":
    case "resume": {
      if (drive.dismissed) {
        return { ok: false, status: 409, error: `${input.action} applies to an in-progress download` };
      }
      const facts = factsAt(item, drive);
      if (facts.transfer === undefined) {
        return { ok: false, status: 409, error: `${input.action} applies to an in-progress download` };
      }
      return {
        ok: true,
        view: persist({ ...drive, paused: input.action === "pause", restarted: false }),
      };
    }
    case "dismiss": {
      if (!drive.dismissed) {
        return { ok: true, view: persist({ ...INITIAL_DRIVE, dismissed: true }) };
      }
      return { ok: true, view: persist(drive) }; // idempotent
    }
    default:
      return { ok: false, status: 400, error: `unknown acquisition action '${input.action}'` };
  }
}

/**
 * The GATED diagnostics of one item (fixtures mode): the protocol overlay
 * composed with the current scripted phase (read from the shared state).
 * Protocol vocabulary — renders ONLY inside the advanced-diagnostics
 * disclosure.
 */
export function fixtureAcquisitionDiagnostics(itemId: string): AcquisitionDiagnosticsView | null {
  const item = scriptedOf(itemId);
  if (item === undefined || item.itemId === null) return null;
  const drive = readDriveState().get(item.externalRef) ?? INITIAL_DRIVE;
  const facts = drive.dismissed ? factsAt(item, INITIAL_DRIVE) : factsAt(item, drive);
  const sessionState =
    facts.failure !== undefined
      ? "failed"
      : facts.offlineReady !== undefined && facts.offlineReady.verified
        ? "completed"
        : facts.transfer === undefined
          ? "idle"
          : facts.transfer.phase === "locating"
            ? "discovering-metadata"
            : facts.transfer.phase === "choosing-files"
              ? "selecting"
              : facts.transfer.phase === "transferring"
                ? "downloading"
                : facts.transfer.phase === "verifying"
                  ? "verifying"
                  : "completed";
  const schedulerState =
    facts.playback === undefined
      ? "idle"
      : facts.playback.activity === "starting"
        ? "startup"
        : facts.playback.activity === "playing"
          ? "steady"
          : facts.playback.activity === "seeking"
            ? "seeking"
            : facts.playback.activity === "completing-in-background"
              ? "background-completion"
              : "idle";
  return {
    itemId,
    sessionState,
    schedulerState,
    infoHash: item.protocol.infoHash,
    peersConnected: item.protocol.peersConnected,
    piecesVerified: item.protocol.piecesVerified,
    piecesTotal: item.protocol.piecesTotal,
    downloadBytesPerSec: item.protocol.downloadBytesPerSec,
    uploadBytesPerSec: item.protocol.uploadBytesPerSec,
    stallKind: item.protocol.peersConnected > 0 ? "none" : "no-completion-path",
    provenance: { sourceId: item.protocol.sourceId, basis: item.protocol.basis },
    dataDir: item.protocol.dataDir,
  };
}

// ---------------------------------------------------------------------------
// TEST SEAM (host/testing.ts consumes this — never a production path)
// ---------------------------------------------------------------------------

/** TEST-ONLY: reset the fixture feed to pristine (ids, seed flag, the file). */
export function resetAcquisitionFixturesForTests(): void {
  for (const item of SCRIPTED) {
    item.itemId = null;
  }
  seeded = false;
  try {
    rmSync(FIXTURE_STATE_PATH, { force: true });
  } catch {
    // An absent file is already pristine.
  }
}
