/**
 * @wfx/app-web — the DEV-ONLY BYOF feed-import fixture drive (R20-D).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * This module exists ONLY in fixtures mode (`WFX_DEV_FIXTURES=1` — the loud
 * dev badge): the deterministic scripted BYOF capture the Web onboarding and
 * feed surfaces browser-validate against (J33). It follows EXACTLY the
 * R14 acquisition-fixture and R17 source-auth-fixture laws:
 *
 * - THE SCRIPTED SOURCE IS THE FIXTURE CATALOG'S OWN SOURCE
 *   (`fake-source`): its authorization truth is the SHARED scripted
 *   source-auth lifecycle (host/source-auth-fixtures.ts — the J28 drive).
 *   An EXPIRED or SIGNED-OUT authorization refuses the feed capture with
 *   the TYPED `unauthorized` failure — never a silent fallback, never a
 *   fake success. Reads never advance any script.
 * - THE CAPTURE LAW (the R20-B projection truth, mirrored): the scripted
 *   items carry SOURCE-NATIVE order (`sourceOrder` — the position the
 *   source itself reports), the relationship's container (`sourceRef`:
 *   the playlist id, 'LL' for likes; follows carry none — the follow
 *   graph IS the relationship), and the source's own titles/timestamps
 *   verbatim. Follow targets reference the CHANNEL id — a channel is NOT
 *   an EntertainmentItem (the WFX-054 projection law; no canonical typing
 *   is fabricated here).
 * - THE SNAPSHOT TRUTH: the `api` method captures a CONTINUOUSLY
 *   RE-READABLE route (`continuousSync: true` — a later sync can
 *   reconcile); the `official-export` method is a ONE-TIME artifact
 *   (`continuousSync: false` — a sync is the typed `unsupported` verdict:
 *   re-import through a fresh preview instead of a fake refresh).
 * - THE DEV-SERVER SPLIT-MODULE REALITY: the BYOF state (imports +
 *   records + the scripted source REVISION) lives in a small JSON file
 *   the page and route module instances share — the same file-backed
 *   cursor law the acquisition/source-auth fixtures follow.
 * - `revise-source` is the CLEARLY-LABELED dev drive (like `expire` and
 *   the acquisition `advance`): it moves the scripted source to its NEXT
 *   revision so a SYNC has something honest to reconcile (a follow
 *   removed, one added, a playlist item added, a title changed, a like
 *   re-ordered). Only the typed POST moves it; reads never advance.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ConnectorFeedItem,
  ConnectorFeedSnapshot,
  FeedImportMethod,
  FeedRelationship,
  FeedSyncState,
} from "@wfx/domain";
import { FEED_RELATIONSHIPS, FOLLOWING_RELATIONSHIPS } from "@wfx/domain";

import { FIXTURE_SOURCE_CONNECTOR_ID, fixtureSourceReadFailure } from "../source-auth-fixtures";

// ---------------------------------------------------------------------------
// The shared state file (the dev-server module-split law)
// ---------------------------------------------------------------------------

/** The shared dev-state file (fixed path: the page + route modules agree). */
export const BYOF_FIXTURE_STATE_FILE = join(tmpdir(), "wfx-dev-byof-fixtures.json");

/**
 * The deterministic capture base time (the same T0 the acquisition and
 * source-auth fixtures anchor on; each REVISION is one hour later so every
 * capture's `capturedAt` is a distinct honest instant).
 */
const CAPTURE_T0 = Date.parse("2026-09-18T12:00:00.000Z");
const CAPTURE_STEP_MS = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// The state shapes (the file's whole truth)
// ---------------------------------------------------------------------------

/** One scripted BYOF import row (the frozen `FeedImport` truth + the web lane's disconnect state). */
export interface ByofFixtureImport {
  readonly id: string;
  readonly connectorId: string;
  readonly method: FeedImportMethod;
  /** preview (staged, unconfirmed) | confirmed | failed (capture attempt that never staged) | reauthorization-required | disconnected. */
  readonly status: "preview" | "confirmed" | "failed" | "reauthorization-required" | "disconnected";
  readonly continuousSync: boolean;
  readonly relationships?: readonly FeedRelationship[];
  readonly sourceRef?: string;
  readonly capturedAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly lastSyncedAt?: string;
  readonly syncState: FeedSyncState;
  readonly error?: string;
  readonly lastReport?: {
    readonly appliedAt: string;
    readonly added: number;
    readonly updated: number;
    readonly removed: number;
    readonly kept: number;
  };
}

/** One persisted imported-feed record (the frozen `FeedRecord` truth). */
export interface ByofFixtureRecord {
  readonly importId: string;
  /** The deterministic idempotent import key (the domain's `feedImportKey`). */
  readonly key: string;
  readonly externalRef: string;
  readonly relationship: FeedRelationship;
  readonly sourceRef?: string;
  /** The position the source itself reports within the relationship's container. */
  readonly sourceOrder: number;
  /** The capture's array position (the SOURCE-NATIVE order the feed renders). */
  readonly captureIndex: number;
  readonly title?: string;
  readonly capturedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly importedAt: string;
  /** The canonical identity (a follow target's anchor is DEFERRED — a channel is not an item). */
  readonly entertainmentItemId: string;
  /** The visible deferred marker (mirrors the shared lane's `canonicalResolution`). */
  readonly deferredResolution?: "deferred-follow" | "deferred-untyped";
}

/**
 * The whole file-backed BYOF drive state. `stagedItems` is the preview
 * staging BETWEEN preview and confirm (the shared lane's
 * `feed_preview_items` law: staged rows are what the user confirms — the
 * confirming import promotes them into `records` by idempotent key).
 */
export interface ByofFixtureState {
  readonly imports: readonly ByofFixtureImport[];
  readonly stagedItems: readonly ByofFixtureRecord[];
  readonly records: readonly ByofFixtureRecord[];
  /** The scripted source's revision (the `revise-source` drive moves it). */
  readonly sourceRevision: number;
  /** The deterministic canonical-id counter (stable identities, persisted). */
  nextItemId: number;
  /** The deterministic import-id counter. */
  nextImportId: number;
}

const PRISTINE_STATE: ByofFixtureState = {
  imports: [],
  stagedItems: [],
  records: [],
  sourceRevision: 0,
  nextItemId: 500,
  nextImportId: 1,
};

/** Read the shared BYOF drive state (missing/corrupt file ⇒ pristine). */
export function readByofFixtureState(): ByofFixtureState {
  if (!existsSync(BYOF_FIXTURE_STATE_FILE)) return structuredClone(PRISTINE_STATE);
  try {
    const parsed = JSON.parse(readFileSync(BYOF_FIXTURE_STATE_FILE, "utf8")) as {
      imports?: unknown;
      stagedItems?: unknown;
      records?: unknown;
      sourceRevision?: unknown;
      nextItemId?: unknown;
      nextImportId?: unknown;
    };
    const imports = Array.isArray(parsed.imports) ? parsed.imports : [];
    const stagedItems = Array.isArray(parsed.stagedItems) ? parsed.stagedItems : [];
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    return {
      imports: imports as ByofFixtureImport[],
      stagedItems: stagedItems as ByofFixtureRecord[],
      records: records as ByofFixtureRecord[],
      sourceRevision: typeof parsed.sourceRevision === "number" ? parsed.sourceRevision : 0,
      nextItemId: typeof parsed.nextItemId === "number" ? parsed.nextItemId : 500,
      nextImportId: typeof parsed.nextImportId === "number" ? parsed.nextImportId : 1,
    };
  } catch {
    return structuredClone(PRISTINE_STATE); // a corrupt file is pristine (dev harness)
  }
}

/** Persist the BYOF drive state (best-effort — dev harness only). */
export function writeByofFixtureState(state: ByofFixtureState): void {
  try {
    writeFileSync(BYOF_FIXTURE_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // A failed write leaves the previous state (dev harness only).
  }
}

/** TEST/RUNNER-ONLY: reset the BYOF drive state to pristine (no imports). */
export function resetByofFixtureState(): void {
  try {
    rmSync(BYOF_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // An absent file is already pristine.
  }
}

// ---------------------------------------------------------------------------
// The scripted capture (deterministic, source-native)
// ---------------------------------------------------------------------------

/** One scripted source item (the fake source's own feed truth). */
interface ScriptedFeedEntry {
  readonly externalRef: string;
  readonly relationship: FeedRelationship;
  readonly sourceOrder: number;
  readonly sourceRef?: string;
  readonly title?: string;
  readonly sourceUpdatedAt?: string;
}

/**
 * The scripted feed at REVISION 0 — the relationships the fake source's
 * authorized route exposes (the same vocabulary the real YouTube route
 * exposes: follows, playlist items, likes — never history or ranked-feed,
 * the honest API absences).
 */
const scriptedFeedAtRevision0: readonly ScriptedFeedEntry[] = [
  // The follow graph (most-recent-first, the source's own order).
  { externalRef: "fake:channel-astro", relationship: "follow", sourceOrder: 0, title: "Astro Field Notes", sourceUpdatedAt: iso(CAPTURE_T0 - 40 * 24 * CAPTURE_STEP_MS) },
  { externalRef: "fake:channel-harbor", relationship: "follow", sourceOrder: 1, title: "Harbor Studies", sourceUpdatedAt: iso(CAPTURE_T0 - 65 * 24 * CAPTURE_STEP_MS) },
  { externalRef: "fake:channel-static", relationship: "follow", sourceOrder: 2, title: "Static Lab", sourceUpdatedAt: iso(CAPTURE_T0 - 90 * 24 * CAPTURE_STEP_MS) },
  // One premium subscription (the subscription tier of a followed channel).
  { externalRef: "fake:channel-harbor-premium", relationship: "subscription", sourceOrder: 0, title: "Harbor Studies Premium", sourceUpdatedAt: iso(CAPTURE_T0 - 12 * 24 * CAPTURE_STEP_MS) },
  // One playlist container (the source's own positions — the strongest source-order truth).
  { externalRef: "fake:video-1", relationship: "playlist", sourceOrder: 0, sourceRef: "fake:pl-quiet-hours", title: "Deep Field Diary", sourceUpdatedAt: iso(CAPTURE_T0 - 6 * CAPTURE_STEP_MS) },
  { externalRef: "fake:video-2", relationship: "playlist", sourceOrder: 1, sourceRef: "fake:pl-quiet-hours", title: "Static Bloom", sourceUpdatedAt: iso(CAPTURE_T0 - 5 * CAPTURE_STEP_MS) },
  { externalRef: "fake:video-4", relationship: "playlist", sourceOrder: 2, sourceRef: "fake:pl-quiet-hours", title: "Signal Fade", sourceUpdatedAt: iso(CAPTURE_T0 - 4 * CAPTURE_STEP_MS) },
  { externalRef: "fake:video-3", relationship: "playlist", sourceOrder: 3, sourceRef: "fake:pl-quiet-hours", title: "Desert Rain Doc", sourceUpdatedAt: iso(CAPTURE_T0 - 3 * CAPTURE_STEP_MS) },
  { externalRef: "fake:movie-1", relationship: "playlist", sourceOrder: 4, sourceRef: "fake:pl-quiet-hours", title: "Asteroid Drift", sourceUpdatedAt: iso(CAPTURE_T0 - 2 * CAPTURE_STEP_MS) },
  // The liked list (LL — the source's own native order).
  { externalRef: "fake:short-1", relationship: "like", sourceOrder: 0, sourceRef: "LL", title: "Neon Rain", sourceUpdatedAt: iso(CAPTURE_T0 - 30 * 60_000) },
  { externalRef: "fake:short-2", relationship: "like", sourceOrder: 1, sourceRef: "LL", title: "Midnight Scoop", sourceUpdatedAt: iso(CAPTURE_T0 - 25 * 60_000) },
  { externalRef: "fake:short-3", relationship: "like", sourceOrder: 2, sourceRef: "LL", title: "Rain Check", sourceUpdatedAt: iso(CAPTURE_T0 - 20 * 60_000) },
];

/**
 * The scripted feed at REVISION 1 (after the dev `revise-source` drive) —
 * the source CHANGED: one follow removed (Static Lab unfollowed), one
 * follow added (Signal Workshop — most recent), one playlist item appended,
 * one playlist title changed by the source, one like re-ordered (moved to
 * the top). A sync of a revision-0 import therefore reconciles honestly:
 * adds, updates, a remove, and keeps.
 */
const scriptedFeedAtRevision1: readonly ScriptedFeedEntry[] = [
  { externalRef: "fake:channel-signal", relationship: "follow", sourceOrder: 0, title: "Signal Workshop", sourceUpdatedAt: iso(CAPTURE_T0 + 2 * 60_000) },
  { externalRef: "fake:channel-astro", relationship: "follow", sourceOrder: 1, title: "Astro Field Notes", sourceUpdatedAt: iso(CAPTURE_T0 - 40 * 24 * CAPTURE_STEP_MS) },
  { externalRef: "fake:channel-harbor", relationship: "follow", sourceOrder: 2, title: "Harbor Studies", sourceUpdatedAt: iso(CAPTURE_T0 - 65 * 24 * CAPTURE_STEP_MS) },
  { externalRef: "fake:channel-harbor-premium", relationship: "subscription", sourceOrder: 0, title: "Harbor Studies Premium", sourceUpdatedAt: iso(CAPTURE_T0 - 12 * 24 * CAPTURE_STEP_MS) },
  { externalRef: "fake:video-1", relationship: "playlist", sourceOrder: 0, sourceRef: "fake:pl-quiet-hours", title: "Deep Field Diary", sourceUpdatedAt: iso(CAPTURE_T0 - 6 * CAPTURE_STEP_MS) },
  { externalRef: "fake:video-2", relationship: "playlist", sourceOrder: 1, sourceRef: "fake:pl-quiet-hours", title: "Static Bloom (Director's Cut)", sourceUpdatedAt: iso(CAPTURE_T0 + 90 * 60_000) },
  { externalRef: "fake:video-4", relationship: "playlist", sourceOrder: 2, sourceRef: "fake:pl-quiet-hours", title: "Signal Fade", sourceUpdatedAt: iso(CAPTURE_T0 - 4 * CAPTURE_STEP_MS) },
  { externalRef: "fake:video-3", relationship: "playlist", sourceOrder: 3, sourceRef: "fake:pl-quiet-hours", title: "Desert Rain Doc", sourceUpdatedAt: iso(CAPTURE_T0 - 3 * CAPTURE_STEP_MS) },
  { externalRef: "fake:movie-1", relationship: "playlist", sourceOrder: 4, sourceRef: "fake:pl-quiet-hours", title: "Asteroid Drift", sourceUpdatedAt: iso(CAPTURE_T0 - 2 * CAPTURE_STEP_MS) },
  { externalRef: "fake:series-1", relationship: "playlist", sourceOrder: 5, sourceRef: "fake:pl-quiet-hours", title: "Harbor Lights", sourceUpdatedAt: iso(CAPTURE_T0 + 45 * 60_000) },
  { externalRef: "fake:short-3", relationship: "like", sourceOrder: 0, sourceRef: "LL", title: "Rain Check", sourceUpdatedAt: iso(CAPTURE_T0 + 5 * 60_000) },
  { externalRef: "fake:short-1", relationship: "like", sourceOrder: 1, sourceRef: "LL", title: "Neon Rain", sourceUpdatedAt: iso(CAPTURE_T0 - 30 * 60_000) },
  { externalRef: "fake:short-2", relationship: "like", sourceOrder: 2, sourceRef: "LL", title: "Midnight Scoop", sourceUpdatedAt: iso(CAPTURE_T0 - 25 * 60_000) },
];

/** The scripted feed at one revision (the whole truth, source-native order). */
function scriptedFeedAt(revision: number): readonly ScriptedFeedEntry[] {
  return revision <= 0 ? scriptedFeedAtRevision0 : scriptedFeedAtRevision1;
}

/** The typed capture failure (the honest authorization truth). */
export interface ByofCaptureFailure {
  readonly kind: "unauthorized" | "unsupported" | "invalid-input";
  readonly detail: string;
}

/**
 * Capture the scripted source's feed (the authorized route ONLY — the same
 * credential truth every fixture read follows). Deterministic per revision;
 * reads never advance anything.
 */
export function captureFixtureFeedSnapshot(input: {
  readonly method: FeedImportMethod;
}): { ok: true; snapshot: ConnectorFeedSnapshot } | { ok: false; failure: ByofCaptureFailure } {
  const state = readByofFixtureState();

  // The authorization truth (the SHARED scripted source-auth lifecycle —
  // J28's drive): an expired or missing grant refuses the capture with the
  // typed failure, never a silent fallback.
  const refusal = fixtureSourceReadFailure();
  if (refusal !== null) {
    return {
      ok: false,
      failure: {
        kind: "unauthorized",
        detail:
          refusal.credential.state === "expired"
            ? "the stored authorization for this source expired — reconnect it in Settings before importing your feed"
            : "this source is not connected — connect it in Settings before importing your feed",
      },
    };
  }

  if (input.method !== "api" && input.method !== "official-export") {
    return {
      ok: false,
      failure: {
        kind: "invalid-input",
        detail: `the fake source's feed route serves 'api' and 'official-export' imports (got '${input.method}')`,
      },
    };
  }

  const items: ConnectorFeedItem[] = scriptedFeedAt(state.sourceRevision).map((entry) => ({
    externalRef: entry.externalRef,
    relationship: entry.relationship,
    sourceOrder: entry.sourceOrder,
    ...(entry.sourceRef !== undefined ? { sourceRef: entry.sourceRef } : {}),
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: entry.sourceUpdatedAt } : {}),
  }));

  return {
    ok: true,
    snapshot: {
      connectorId: FIXTURE_SOURCE_CONNECTOR_ID,
      method: input.method,
      capturedAt: iso(CAPTURE_T0 + (state.sourceRevision + 1) * CAPTURE_STEP_MS),
      // The api route is continuously re-readable; an export artifact is a
      // one-time snapshot (a later sync is the typed unsupported verdict).
      continuousSync: input.method === "api",
      orderSemantics: "source-native",
      syncState: "syncing",
      items,
      metadata: {
        scriptedRevision: state.sourceRevision,
        ...(input.method === "official-export"
          ? { artifactNote: "the scripted official-export artifact (the dev fixtures' own takeout file)" }
          : {}),
      },
    },
  };
}

/** The relationship kinds the scripted source's route exposes. */
export const FIXTURE_FEED_RELATIONSHIPS: readonly FeedRelationship[] = FEED_RELATIONSHIPS.filter(
  (relationship) =>
    relationship === "follow" ||
    relationship === "subscription" ||
    relationship === "playlist" ||
    relationship === "like",
);

/** The follow-graph relationships (the Following mode's subset). */
export const FIXTURE_FOLLOWING_RELATIONSHIPS: readonly FeedRelationship[] = FOLLOWING_RELATIONSHIPS;

/**
 * The clearly-labeled dev drive: move the scripted source to its NEXT
 * revision (the source changed — a sync has something honest to reconcile).
 * Only the typed POST moves it; reads never advance.
 */
export function driveReviseFixtureSource(): { ok: true; revision: number } {
  const state = readByofFixtureState();
  const revision = Math.min(state.sourceRevision + 1, 1);
  writeByofFixtureState({ ...state, sourceRevision: revision });
  return { ok: true, revision };
}
