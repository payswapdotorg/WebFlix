/**
 * R17 — the metadata deadline (the honest bound on `discovering-metadata`).
 *
 * "metadata fetch failure renders a named error state with retry; no hangs,
 * no invented metadata": a magnet session whose metadata has not resolved
 * within the configured deadline fails with the TYPED `metadata-failed`
 * reason and an honest detail — the file list stays empty (nothing was
 * invented), the failure is journaled, and the retry path is the fresh
 * re-ingestion. Paused discovery never accrues; `0` disables the deadline
 * (the R11 escape hatch); resuming into discovery re-arms it from NOW.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import { LoopbackTorrentLibrary, scriptLoopbackSession } from "./helpers/loopback-library";
import { statusOf } from "./helpers/status";
import { AUTHORIZED_ARCHIVE_V1, fixtureMagnetUri } from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-metadata-deadline");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

const METADATA_TIMEOUT_MS = 30_000;

let engineCounter = 0;
/** A manual clock the test moves — deadline math is deterministic. */
let clockMs = 0;

function newEngine(
  library: LoopbackTorrentLibrary,
  metadataTimeoutMs: number = METADATA_TIMEOUT_MS,
): TorrentEngine {
  engineCounter += 1;
  clockMs = 0;
  return createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${engineCounter}`),
    sources,
    clock: () => clockMs,
    metadataTimeoutMs,
  });
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A magnet session in `discovering-metadata` whose script never resolves metadata. */
async function createDiscoveringSession(
  library: LoopbackTorrentLibrary,
  engine: TorrentEngine,
): Promise<string> {
  const ingested = await engine.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
  if (!ingested.ok) throw new Error("magnet ingestion must succeed");
  const created = await engine.createSession(ingested.value.id, {});
  if (!created.ok) throw new Error("session must be created");
  // The script NEVER resolves metadata (metadataResolveAdvances is never
  // reached: the test never advances that far) and no pieces arrive.
  scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", created.value.sessionId, "data"), {
    peersAt: () => 0,
    piecesPerAdvance: 0,
  });
  return created.value.sessionId;
}

describe("R17 — the metadata deadline (no hangs, no invented metadata)", () => {
  it("an active discovery session past the deadline fails with the NAMED metadata-failed state", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDiscoveringSession(library, engine);

    // Under the deadline: honestly discovering, no file list.
    clockMs += METADATA_TIMEOUT_MS - 1;
    let status = statusOf(engine, sessionId);
    expect(status.state).toBe("discovering-metadata");
    expect(status.files).toEqual([]); // nothing invented
    expect(status.failure).toBeUndefined();

    // Past the deadline: the typed named failure — observed at the status
    // tick (the observation-is-the-tick law), never a hang.
    clockMs += 2;
    status = statusOf(engine, sessionId);
    expect(status.state).toBe("failed");
    expect(status.failure).toBeDefined();
    expect(status.failure!.reason).toBe("metadata-failed");
    expect(status.failure!.detail).toContain("metadata did not arrive");
    expect(status.failure!.detail).toContain("nothing was invented");
    expect(status.failure!.detail).toContain("Re-ingest"); // the retry path
    expect(status.files).toEqual([]); // STILL nothing invented
    await engine.destroy();
  });

  it("the failed metadata session persists in the journal (a restart sees it terminal — never a silent resume)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDiscoveringSession(library, engine);
    clockMs += METADATA_TIMEOUT_MS + 1;
    expect(statusOf(engine, sessionId).state).toBe("failed");
    await engine.destroy();

    // A fresh engine over the same dataRoot recovers the session TERMINAL.
    const engine2 = createTorrentEngine({
      library,
      dataRoot: join(TMP, `engine-${engineCounter}`),
      sources,
      clock: () => clockMs,
      metadataTimeoutMs: METADATA_TIMEOUT_MS,
    });
    const recovered = await engine2.recover();
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    const restored = recovered.value.recovered.find((entry) => entry.sessionId === sessionId);
    expect(restored).toBeUndefined(); // never resumed
    const terminal = recovered.value.terminal.find((entry) => entry.sessionId === sessionId);
    expect(terminal).toBeDefined();
    const status = statusOf(engine2, sessionId);
    expect(status.state).toBe("failed");
    expect(status.failure?.reason).toBe("metadata-failed");
    await engine2.destroy();
  });

  it("paused discovery does not accrue — the deadline is disarmed on pause and re-armed from NOW on resume", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDiscoveringSession(library, engine);

    // Pause BEFORE the deadline; time passes far beyond it while paused.
    expect(engine.pause(sessionId).ok).toBe(true);
    clockMs += METADATA_TIMEOUT_MS * 10;
    let status = statusOf(engine, sessionId);
    expect(status.state).toBe("seeding-paused"); // never timed out underneath the user
    expect(status.failure).toBeUndefined();

    // Resume re-arms from NOW: the fresh window has its full budget.
    expect(engine.resume(sessionId).ok).toBe(true);
    clockMs += METADATA_TIMEOUT_MS - 1;
    status = statusOf(engine, sessionId);
    expect(status.state).toBe("discovering-metadata");
    expect(status.failure).toBeUndefined();

    // Past the RE-ARMED deadline it fails honestly.
    clockMs += 2;
    status = statusOf(engine, sessionId);
    expect(status.state).toBe("failed");
    expect(status.failure!.reason).toBe("metadata-failed");
    await engine.destroy();
  });

  it("metadataTimeoutMs: 0 disables the deadline (the R11 infinite-discovery escape hatch)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library, 0);
    const sessionId = await createDiscoveringSession(library, engine);
    clockMs += 10 * 60 * 60 * 1000; // six hours — no deadline, no failure
    const status = statusOf(engine, sessionId);
    expect(status.state).toBe("discovering-metadata");
    expect(status.failure).toBeUndefined();
    await engine.destroy();
  });

  it("a malformed metadataTimeoutMs is a typed construction refusal", () => {
    const library = new LoopbackTorrentLibrary();
    expect(() =>
      createTorrentEngine({
        library,
        dataRoot: join(TMP, "engine-invalid"),
        sources,
        metadataTimeoutMs: -1,
      }),
    ).toThrow(/metadataTimeoutMs/);
  });

  it("the retry path: a fresh ingestion over the same source starts a NEW session (the failed one stays terminal)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDiscoveringSession(library, engine);
    clockMs += METADATA_TIMEOUT_MS + 1;
    expect(statusOf(engine, sessionId).state).toBe("failed");

    // The documented recovery: re-ingest + a fresh session.
    const reingested = await engine.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    expect(reingested.ok).toBe(true);
    if (!reingested.ok) return;
    const created = await engine.createSession(reingested.value.id, {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.sessionId).not.toBe(sessionId);
    const fresh = statusOf(engine, created.value.sessionId);
    expect(fresh.state).toBe("discovering-metadata"); // the fresh attempt — its own budget
    expect(statusOf(engine, sessionId).state).toBe("failed"); // the old one stays terminal
    await engine.destroy();
  });
});
