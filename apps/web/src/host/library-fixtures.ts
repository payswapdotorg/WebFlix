/**
 * @wfx/app-web — the DEV-ONLY library fixture state (R30 — the persona's
 * service-side library; the file-backed twin of model-fixtures.ts).
 *
 * ⚠️ DEVELOPMENT FIXTURE — NEVER PRODUCTION. ⚠️
 *
 * THE R30 RELOAD-DURABILITY LAW, FIXTURES SIDE: the Subscribe write is REAL
 * and durable server-side (the service's `POST /experience/library` → the
 * catalog's library store, read back by `GET /experience/library`) — but the
 * fixture double's profile-scoped read answered the persona's hard-coded
 * EMPTY state, so a fresh watch-page load could never hydrate the stored
 * truth (the R29 sweep's divergence #1, reproduced on the fixtures boot as
 * `subscribeDurable.stateAfterReload: "idle"` + `librarySubscriptions.
 * subsFound: false`). The persona's service-side library is now REAL
 * fixture state — the SAME state `writeLibrary` records and
 * `readProfileLibrary` answers (one truth, the write and the read agree).
 *
 * THE DEV-SERVER SPLIT-MODULE REALITY (the same law the acquisition,
 * source-auth, and model-controls fixtures follow): the Turbopack dev
 * server compiles route modules and page modules as SEPARATE module graphs
 * — in-memory Maps do not cross them. The `/api/library` route's runtime
 * (which performs the write) and the `/player` page's runtime (which
 * hydrates on boot) resolve DIFFERENT module instances of the fixture
 * port, so the persona's library lives in a small JSON file at a FIXED
 * tmpdir path every module agrees on (the file is the truth; reads are
 * fresh per call; only the typed writes move it).
 *
 * HONESTY LAWS (mirrored from model-fixtures.ts):
 * - READS NEVER ADVANCE THE STATE: read fresh from the shared file per
 *   call; only the typed library writes move it.
 * - THE STATE IS DATA: rows answer the REAL `LibraryEntry` shape the
 *   runtime validates exactly as it validates the real transport's rows
 *   (connectorId/externalRef/title/addedAt/metadata) — never a fabricated
 *   claim.
 * - UPDATES ARE KEYED: the persona's rows key on `externalRef` (the same
 *   key the service's catalog upserts by — one row per source item).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LibraryCommand, LibraryEntry } from "@wfx/domain";
import { FIXTURE_CONNECTOR_ID } from "@wfx/experience";

/** The shared dev-state file (fixed path: the page + route modules agree). */
export const LIBRARY_FIXTURE_STATE_FILE = join(
  tmpdir(),
  "wfx-dev-library-fixtures.json",
);

/** The persona's whole service-side library (the file's schema). */
export interface LibraryFixtureState {
  readonly entries: readonly LibraryEntry[];
}

/** The empty state (a missing or corrupt file reads as EMPTY, never fatal). */
export function emptyLibraryFixtureState(): LibraryFixtureState {
  return { entries: [] };
}

/** Read the state FRESH from the shared file (per call — the file is truth). */
export function readLibraryFixtureState(): LibraryFixtureState {
  try {
    if (!existsSync(LIBRARY_FIXTURE_STATE_FILE)) return emptyLibraryFixtureState();
    const parsed: unknown = JSON.parse(readFileSync(LIBRARY_FIXTURE_STATE_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return emptyLibraryFixtureState();
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.entries)) return emptyLibraryFixtureState();
    const entries: LibraryEntry[] = [];
    for (const row of record.entries) {
      if (typeof row !== "object" || row === null) continue;
      const entry = row as Record<string, unknown>;
      if (typeof entry.connectorId !== "string" || entry.connectorId.length === 0) continue;
      if (typeof entry.externalRef !== "string" || entry.externalRef.length === 0) continue;
      if (typeof entry.title !== "string" || entry.title.length === 0) continue;
      entries.push({
        connectorId: entry.connectorId,
        externalRef: entry.externalRef,
        title: entry.title,
        ...(typeof entry.addedAt === "string" && entry.addedAt.length > 0
          ? { addedAt: entry.addedAt }
          : {}),
        ...(typeof entry.metadata === "object" && entry.metadata !== null
          ? { metadata: { ...(entry.metadata as Record<string, unknown>) } }
          : {}),
      });
    }
    return { entries };
  } catch {
    return emptyLibraryFixtureState();
  }
}

/** Write the state (only the typed library actions call this). */
function writeLibraryFixtureState(state: LibraryFixtureState): void {
  writeFileSync(LIBRARY_FIXTURE_STATE_FILE, JSON.stringify(state), "utf8");
}

/** The fixed clock instant the fixture persona stamps its rows with. */
const FIXTURE_NOW = "2026-09-18T12:00:00.000Z";

/**
 * Record one add (the typed write): upsert by `externalRef` — the same key
 * the service's catalog upserts by. The row's connector identity is the
 * command's own (`metadata.connectorId` — where the runtime's save writes
 * it); a command without one keys to the fixture persona's own connector
 * (the same identity the fixture connector's rows carry). Returns the
 * stored row verbatim.
 */
export function addFixtureLibraryEntry(command: LibraryCommand): LibraryEntry {
  const state = readLibraryFixtureState();
  const metadata = command.metadata as Record<string, unknown> | undefined;
  const connectorId =
    typeof metadata?.connectorId === "string" && metadata.connectorId.length > 0
      ? metadata.connectorId
      : FIXTURE_CONNECTOR_ID;
  const entry: LibraryEntry = {
    connectorId,
    externalRef: command.externalRef,
    title: typeof command.title === "string" && command.title.length > 0 ? command.title : command.externalRef,
    addedAt: FIXTURE_NOW,
    ...(command.metadata !== undefined ? { metadata: { ...command.metadata } } : {}),
  };
  writeLibraryFixtureState({
    entries: [
      ...state.entries.filter((existing) => existing.externalRef !== entry.externalRef),
      entry,
    ],
  });
  return entry;
}

/** Record one remove (the typed write): delete by `externalRef`. */
export function removeFixtureLibraryEntry(externalRef: string): boolean {
  const state = readLibraryFixtureState();
  const next = state.entries.filter((existing) => existing.externalRef !== externalRef);
  if (next.length === state.entries.length) return false;
  writeLibraryFixtureState({ entries: next });
  return true;
}

/** The dev-reset hook (the test seam + the journey runner's per-run reset). */
export function resetLibraryFixtureState(): void {
  try {
    rmSync(LIBRARY_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // A missing file IS the empty state — never fatal.
  }
}
