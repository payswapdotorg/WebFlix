/**
 * R11/R12/R13 — the boundary import guard (the R10 production-import-guard
 * pattern, extended to the torrent-engine lanes, R12's scheduler, and
 * R13's persistence core).
 *
 * The laws enforced LINT-VISIBLY (a violation fails the suite):
 *
 * 1. THE NARROW SEAM: `src/adapter/**` is the ONLY place in
 *    @wfx/torrent-engine that may import `@wfx/native-media`.
 * 2. NO TEST SUPPORT IN PRODUCTION: nothing under `src/` imports the
 *    loopback double, the fixtures, or the bencode encoder.
 * 3. THE LAZY-IMPORT LAW: `webtorrent` is imported ONLY dynamically
 *    (`await import("webtorrent")`) inside the production binding — so
 *    importing @wfx/torrent-engine never loads the native module.
 * 4. THE LAYERING LAW (the freeze): `@wfx/native-media` never imports
 *    `@wfx/torrent-engine` (torrent internals stay behind the boundary).
 * 5. The package entry never re-exports test support.
 * 6. R12 — THE SCHEDULER LANE LAW: `src/scheduler/**` is engine-internal
 *    scheduling vocabulary: it imports NOTHING from `@wfx/*` (the
 *    scheduler feeds sessions and the range-gateway seam through the
 *    engine facade; it never reaches sideways into another package), and
 *    the public entry re-exports its vocabulary (the seam consumers
 *    import from "@wfx/torrent-engine" only).
 * 7. R13 — THE PERSISTENCE LANE LAW: `src/persistence.ts` is engine-
 *    internal persistence vocabulary: it imports NOTHING from `@wfx/*`
 *    (the journal folds + re-arm validation never reach across lanes),
 *    the journal carries the R13 record vocabulary, and the public entry
 *    re-exports the R13 surface (folds, re-arm inputs, offline-ready
 *    types — consumers import from "@wfx/torrent-engine" only).
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PKG_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const SRC = join(PKG_ROOT, "src");

/** Every .ts file under a directory (recursive). */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...tsFilesUnder(path));
    } else if (entry.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

const allSrc = tsFilesUnder(SRC);

describe("R11/R12 — the boundary import guard", () => {
  it("the production surfaces exist and are non-empty", () => {
    expect(allSrc.length).toBeGreaterThan(0);
    expect(tsFilesUnder(join(SRC, "adapter")).length).toBeGreaterThan(0);
    expect(tsFilesUnder(join(SRC, "library")).length).toBeGreaterThan(0);
  });

  it("R12: the scheduler module exists with its production surface", () => {
    const schedulerFiles = tsFilesUnder(join(SRC, "scheduler"));
    expect(schedulerFiles.length).toBeGreaterThanOrEqual(7);
    for (const expected of [
      "config.ts",
      "geometry.ts",
      "windows.ts",
      "state-machine.ts",
      "truth.ts",
      "reads.ts",
      "session-scheduler.ts",
      "index.ts",
    ]) {
      expect(schedulerFiles.map((f) => f.slice(f.lastIndexOf("/") + 1))).toContain(expected);
    }
  });

  it("R12: src/scheduler/** imports NOTHING from @wfx/* (the scheduler lane law)", () => {
    const violations: string[] = [];
    for (const file of tsFilesUnder(join(SRC, "scheduler"))) {
      const source = readFileSync(file, "utf8");
      // IMPORT STATEMENTS only — module doc comments may name the package.
      const importStatements = source
        .split("\n")
        .filter((line) => line.trim().startsWith("import") || line.trim().startsWith("export"))
        .join("\n");
      if (/@wfx\//.test(importStatements)) {
        violations.push(`${file.slice(SRC.length + 1)}: the scheduler is engine-internal and never imports across lanes`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("R12: the public entry re-exports the scheduler vocabulary (the seam consumers' import path)", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    for (const name of [
      "validatePlaybackSchedulerConfig",
      "DEFAULT_PLAYBACK_SCHEDULER_CONFIG",
      "computePlaybackWindows",
      "computePlaybackTruth",
      "readVerifiedFileRange",
      "PlaybackSchedulerFsm",
      "PIECE_URGENCY",
    ]) {
      expect(index).toContain(name);
    }
    // And the engine facade owns the playback surface + the type vocabulary.
    const engine = readFileSync(join(SRC, "engine.ts"), "utf8");
    expect(engine).toContain("TorrentPlaybackSurface");
    expect(engine).toContain("readVerifiedRange");
    expect(engine).toContain("noteRangeRequests");
  });

  it("R12: the library seam carries the piece-priority surface (both bindings implement it)", () => {
    const contract = readFileSync(join(SRC, "library", "contract.ts"), "utf8");
    expect(contract).toContain("prioritizePieces");
    expect(contract).toContain("LibraryPiecePriority");
    const webtorrent = readFileSync(join(SRC, "library", "webtorrent.ts"), "utf8");
    expect(webtorrent).toContain("prioritizePieces(priorities)");
    // The production binding maps onto webtorrent's OWN mechanisms — no
    // piece-picking re-implementation (invariant 6).
    expect(webtorrent).toContain(".select(range.from, range.to, 0)");
    expect(webtorrent).toContain("torrent.critical(hint.fromPiece, hint.toPiece)");
  });

  it("ONLY src/adapter/** imports @wfx/native-media (the narrow seam)", () => {
    const violations: string[] = [];
    for (const file of allSrc) {
      const relative = file.slice(SRC.length + 1);
      if (relative.startsWith("adapter" + "/")) continue; // the seam itself
      const source = readFileSync(file, "utf8");
      if (source.includes('from "@wfx/native-media"') || source.includes("from '@wfx/native-media'")) {
        violations.push(`${relative}: imports @wfx/native-media outside the adapter`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no production module imports TEST support (loopback / fixtures / bencode)", () => {
    const violations: string[] = [];
    for (const file of allSrc) {
      const source = readFileSync(file, "utf8");
      if (/from\s+["'][^"']*(loopback-library|helpers\/fixtures|\/bencode)["']/.test(source)) {
        violations.push(`${file.slice(SRC.length + 1)}: imports test support`);
      }
      if (source.includes("../tests") || source.includes("../../tests")) {
        violations.push(`${file.slice(SRC.length + 1)}: imports from tests/`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("webtorrent is imported ONLY LAZILY (dynamic import — the native module never loads on package import)", () => {
    const violations: string[] = [];
    for (const file of allSrc) {
      const source = readFileSync(file, "utf8");
      // A STATIC import of webtorrent anywhere in src (import/export from).
      if (/import\s[^;]*?from\s+["']webtorrent["']/.test(source)) {
        violations.push(`${file.slice(SRC.length + 1)}: statically imports webtorrent`);
      }
      if (/export\s[^;]*?from\s+["']webtorrent["']/.test(source)) {
        violations.push(`${file.slice(SRC.length + 1)}: statically re-exports webtorrent`);
      }
    }
    expect(violations).toEqual([]);
    // And the production binding's dynamic import exists (the lazy law).
    const binding = readFileSync(join(SRC, "library", "webtorrent.ts"), "utf8");
    expect(binding.includes('await import("webtorrent")')).toBe(true);
  });

  it("@wfx/native-media NEVER imports @wfx/torrent-engine (the layering law)", () => {
    const nativeMediaSrc = join(REPO_ROOT, "packages", "native-media", "src");
    const violations: string[] = [];
    for (const file of tsFilesUnder(nativeMediaSrc)) {
      const source = readFileSync(file, "utf8");
      if (source.includes("@wfx/torrent-engine")) {
        violations.push(`${file}: torrent-engine must stay OUTSIDE native-media (the freeze's layering law)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("the package entry exports no test support and never deep-imports the library", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    // Import statements only — doc comments may name the test double.
    const importStatements = index
      .split("\n")
      .filter((line) => line.trim().startsWith("import") || line.trim().startsWith("export"))
      .join("\n");
    expect(importStatements).not.toContain("loopback");
    expect(importStatements).not.toContain("helpers/");
    expect(importStatements).not.toContain('from "webtorrent"');
  });
});

describe("R13 — the persistence lane laws", () => {
  it("src/persistence.ts exists and imports NOTHING from @wfx/* (engine-internal vocabulary)", () => {
    const persistencePath = join(SRC, "persistence.ts");
    expect(existsSync(persistencePath)).toBe(true);
    const source = readFileSync(persistencePath, "utf8");
    // IMPORT STATEMENTS only — module doc comments may name packages.
    const importStatements = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import") || line.trim().startsWith("export"))
      .join("\n");
    expect(importStatements).not.toContain("@wfx/");
    // And it stays pure: no node:fs, no clock, no I/O of any kind.
    expect(importStatements).not.toContain("node:");
  });

  it("the journal carries the R13 record vocabulary (scheduler-checkpoint + asset-exposed + compaction)", () => {
    const journal = readFileSync(join(SRC, "journal.ts"), "utf8");
    expect(journal).toContain('"scheduler-checkpoint"');
    expect(journal).toContain('"asset-exposed"');
    expect(journal).toContain("selectCompactionKeepers");
    expect(journal).toContain("renameSync"); // the ATOMIC rotation
    // The fold carries the re-arm control point.
    expect(journal).toContain("schedulerCheckpoint?: JournalSchedulerCheckpointRecord");
  });

  it("the scheduler owns the persist hook + the re-arm path (R13's cross-restart continuity)", () => {
    const scheduler = readFileSync(join(SRC, "scheduler", "session-scheduler.ts"), "utf8");
    expect(scheduler).toContain("SchedulerPersistHook");
    expect(scheduler).toContain("rearm");
    expect(scheduler).toContain("emitCheckpoint");
    // The re-arm path drives the FSM's OWN legal transitions (never a
    // fabricated hop).
    expect(scheduler).toContain('this.fsm.transitionTo("startup")');
  });

  it("the engine wires the persist hook + the exposure surface (verified-before-ready)", () => {
    const engine = readFileSync(join(SRC, "engine.ts"), "utf8");
    expect(engine).toContain("persistSchedulerCheckpoint");
    expect(engine).toContain("recordAssetExposure");
    expect(engine).toContain("exposedAssets");
    expect(engine).toContain("verified-before-ready");
    expect(engine).toContain("schedulerRearmInputsFromRecord");
    expect(engine).toContain("pieceMapReused");
  });

  it("the adapter owns the exposure seam (the ONLY @wfx/native-media path, extended)", () => {
    const adapter = readFileSync(join(SRC, "adapter", "native-media-adapter.ts"), "utf8");
    expect(adapter).toContain("exposeCompletedSelection");
    expect(adapter).toContain("listOfflineReady");
    expect(adapter).toContain("verifyOfflineReadyEntry");
    expect(adapter).toContain("offlineReadyIdentityKey");
  });

  it("the public entry re-exports the R13 vocabulary (the seam consumers' import path)", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(index).toContain("./persistence");
    for (const name of [
      "OfflineReadyTorrentAsset",
      "OfflineReadyEntry",
      "OfflineReadyAsset",
      "LibraryIdentityInput",
    ]) {
      expect(index).toContain(name);
    }
  });
});
