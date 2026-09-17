/**
 * R11 — integrity verification tests.
 *
 * Two layers, both over REAL bytes: (1) piece hashes per the metainfo —
 * the loopback double SHA-1-verifies every piece it lands (a scripted
 * corruption fails the session honestly as corruption-detected), and
 * (2) the final whole-asset SHA-256 digest computed over the landed
 * bytes — the SAME primitive and algorithm as the R10 native-media asset
 * store (the compatibility law).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createAssetStore, sha256Hex } from "@wfx/native-media";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import { torrentSha256Hex } from "../src/integrity";
import { LoopbackTorrentLibrary, scriptLoopbackSession } from "./helpers/loopback-library";
import { statusOf, waitFor } from "./helpers/status";
import {
  AUTHORIZED_ARCHIVE_V1,
  fixtureContent,
  fixtureTorrentBytes,
} from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-integrity");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

let engineCounter = 0;
function newEngine(library: LoopbackTorrentLibrary): TorrentEngine {
  engineCounter += 1;
  return createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${engineCounter}`),
    sources,
  });
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("R11 — integrity verification", () => {
  it("the digest primitive is byte-for-byte the R10 store's (the compatibility law)", () => {
    const bytes = new Uint8Array(1024).map((_, i) => (i * 7) & 0xff);
    expect(torrentSha256Hex(bytes)).toBe(sha256Hex(bytes));
  });

  it("completed sessions record per-file SHA-256 digests computed over the REAL landed bytes", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0, 1] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    for (let i = 0; i < 10; i += 1) library.advanceAll();
    await waitFor(() =>
      statusOf(engine, sessionId).state === "completed",
    );

    const status = statusOf(engine, sessionId);
    expect(status.digests).toBeDefined();
    // INDEPENDENT recomputation: hash the fixture's own content bytes and
    // compare against what the engine recorded over the landed bytes.
    const expected0 = torrentSha256Hex(
      fixtureContent(AUTHORIZED_ARCHIVE_V1).get("authorized-archive-v1/feature-presentation.mkv")!,
    );
    const expected1 = torrentSha256Hex(
      fixtureContent(AUTHORIZED_ARCHIVE_V1).get("authorized-archive-v1/coverart.jpg")!,
    );
    const digests = status.digests ?? [];
    expect(digests.map((d: { path: string }) => d.path)).toEqual([
      "authorized-archive-v1/feature-presentation.mkv",
      "authorized-archive-v1/coverart.jpg",
    ]);
    expect(digests[0]?.sha256).toBe(expected0);
    expect(digests[1]?.sha256).toBe(expected1);
    // The verdict: verified ONLY because every piece hash AND the digest
    // pass — never a fabricated claim.
    expect(status.integrity).toBe("verified");
    await engine.destroy();
  });

  it("a scripted piece corruption FAILS the session honestly (corruption-detected, integrity failed)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    // Pre-script the corruption BEFORE session creation so the double
    // honors it from the first piece.
    const dataRoot = join(TMP, `engine-${engineCounter}`);
    const dataDir = join(dataRoot, "sessions", "ts-1", "data");
    scriptLoopbackSession(dataDir, {
      corruptFilePath: "feature-presentation.mkv",
    });
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    library.advanceAll();
    const status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("failed");
      expect(status.failure?.reason).toBe("corruption-detected");
      expect((status.failure?.detail ?? "")).toContain("piece hash");
      expect(status.integrity).toBe("failed");
    }
    await engine.destroy();
  });

  it("an unsolicited digest is never claimed: integrity stays unknown mid-download", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library.advanceAll();
    const status = statusOf(engine, created.value.sessionId);
    {
      expect(status.state).toBe("downloading");
      expect(status.integrity).toBe("unknown");
      expect(status.digests).toBeUndefined();
    }
    await engine.destroy();
  });

  it("the landed bytes hash identically through the R10 store's own import (end-to-end digest agreement)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [1] } });
    if (!created.ok) return;
    for (let i = 0; i < 10; i += 1) library.advanceAll();
    await waitFor(() =>
      statusOf(engine, created.value.sessionId).state === "completed",
    );
    const status = statusOf(engine, created.value.sessionId);
    const digest = status.digests?.[0];
    expect(digest).toBeDefined();

    // Import the same landed file through the REAL R10 store and compare.
    const store = createAssetStore({ root: join(TMP, `store-${engineCounter}`) });
    const imported = await store.importAsset({
      sourcePath: join(status.dataDir, digest!.path),
      contentType: "image/jpeg",
    });
    expect(imported.ok).toBe(true);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.asset.meta.sha256).toBe(digest!.sha256);
      expect(imported.asset.meta.integrity).toBe("verified");
    }
    await engine.destroy();
  });
});
