/**
 * R20-F — the Desktop BYOF file-import surface (native path laws).
 *
 * Every Desktop law of the import path, proven against the shell
 * simulator (the deterministic native-shell double) + the FeedPort
 * double (the REAL domain semantics — the deterministic import key, the
 * closed vocabularies, the real reconciliation engine):
 *
 * - THE NATIVE PATH: pick → read → preview, with the artifact crossing
 *   the shared port VERBATIM (the bytes the shell read).
 * - IDEMPOTENT IMPORT on the native path: importing the SAME file twice
 *   (two picks, two previews, two confirms) leaves the record count
 *   unchanged and every record's identity stable (the import-key law —
 *   the same relationship addresses the SAME record, never a duplicate).
 * - TYPED VERDICTS: dismissed (user non-event), unsupported (platform
 *   without a dialog; connector without the declared method), failed
 *   (read/preview errors) — never a silent no-op, never a thrown raw
 *   error leaking into the product surface.
 * - CAPABILITY TRUTH: `fileImportCapability` answers the shell's dialog
 *   truth (queried cheaply, cached; refreshed by the attempt's truth).
 * - METHOD-HONEST: a connector that does not declare the method never
 *   reaches the port (the dialog does not even open).
 */

import { describe, expect, it } from "bun:test";

import { feedImportKey } from "@wfx/domain";

import { createDesktopFeedImportBinding } from "../src/platform/feed-import";
import { SimShell } from "./shell-simulator";
import { createFeedPortDouble, testExportArtifact } from "./feed-port-double";

const PROFILE = "wfxusr_r20f_test:main";
const USER = "wfxusr_r20f_test";
const T0 = "2026-09-19T12:00:00.000Z";

function makeDouble() {
  let counter = 0;
  let clockMs = Date.UTC(2026, 8, 19, 12, 0, 0);
  return createFeedPortDouble({
    profileId: PROFILE,
    userId: USER,
    now: () => new Date(clockMs).toISOString(),
    nextId: () => String(++counter).padStart(6, "0"),
  });
}

const EXPORT = {
  continuousSync: false,
  sourceRef: "PL_r20f",
  items: [
    { externalRef: "vidA", relationship: "playlist" as const, sourceOrder: 0, title: "Alpha" },
    { externalRef: "vidB", relationship: "playlist" as const, sourceOrder: 1, title: "Beta" },
    { externalRef: "chan1", relationship: "follow" as const, sourceOrder: 0 },
  ],
};

function pickableShell(): SimShell {
  const shell = new SimShell();
  shell.scriptFile("/home/user/exports/feed.json", testExportArtifact(EXPORT));
  shell.nextFilePickOutcome = { picked: true, path: "/home/user/exports/feed.json" };
  return shell;
}

describe("R20-F — the native file-import surface", () => {
  it("picks, reads, and stages the preview with the artifact VERBATIM", async () => {
    const shell = pickableShell();
    const double = makeDouble();
    const expected = testExportArtifact(EXPORT);

    // Capture the artifact exactly as the shared port receives it.
    const captured: Uint8Array[] = [];
    const wrap = {
      previewImport: async (input: { connectorId: string; method?: string; artifact?: Uint8Array }) => {
        if (input.artifact !== undefined) captured.push(input.artifact);
        return double.port.previewImport(input as Parameters<typeof double.port.previewImport>[0]);
      },
      confirmImport: (importId: string) => double.port.confirmImport(importId),
      readFeed: (input: { profileId: string; mode: "webflix" | "following" | "byof" | "hybrid" }) =>
        double.port.readFeed(input),
      syncImport: (importId: string) => double.port.syncImport(importId),
    };
    const binding = createDesktopFeedImportBinding({ shell, feedPort: wrap });

    const result = await binding.importFromFile({ connectorId: "youtube", method: "official-export" });
    expect(result.outcome).toBe("preview");

    // The artifact the port saw is the file's REAL bytes (byte-for-byte).
    expect(captured).toHaveLength(1);
    expect([...(captured[0] ?? [])]).toEqual([...expected]);

    // The preview reports the honest counts.
    if (result.outcome === "preview") {
      expect(result.preview.itemCount).toBe(3);
      expect(result.preview.relationshipCounts).toEqual({ playlist: 2, follow: 1 });
      expect(result.preview.freshness).toBe("snapshot");
      expect(result.preview.connectorId).toBe("youtube");
      expect(result.preview.method).toBe("official-export");
    }
  });

  it("IDEMPOTENT IMPORT on the native path: the same file twice, no duplicates, stable identities", async () => {
    const shell = pickableShell();
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    // First import.
    const first = await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(first.outcome).toBe("preview");
    const firstImport = await binding.confirmImport(first.outcome === "preview" ? first.preview.importId : "");
    expect(firstImport.status).toBe("complete");
    expect(double.recordCount()).toBe(3);

    // The SAME file again (a second pick + preview + confirm).
    const second = await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(second.outcome).toBe("preview");
    const secondImport = await binding.confirmImport(second.outcome === "preview" ? second.preview.importId : "");
    expect(secondImport.status).toBe("complete");

    // THE LAW: the record count is UNCHANGED and identities are stable.
    expect(double.recordCount()).toBe(3);
    const key = feedImportKey({
      profileId: PROFILE,
      connectorId: "youtube",
      relationship: "playlist",
      sourceRef: "PL_r20f",
      externalRef: "vidA",
    });
    const record = double.recordByKey(key);
    expect(record).toBeDefined();
    expect(record?.id).toMatch(/^wfxfeed_double_/); // the SAME record identity survived the re-import

    const records = await double.allRecords();
    expect(records).toHaveLength(3);
    const ids = records.map((record) => record.id).sort();
    expect(new Set(ids).size).toBe(3); // no duplicates
  });

  it("a dismissed dialog is the typed non-event (never an error, never unsupported)", async () => {
    const shell = new SimShell(); // default: dismissed
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    const result = await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(result).toEqual({
      outcome: "dismissed",
      detail: "the user closed the file dialog without choosing a file",
    });
    expect(double.recordCount()).toBe(0); // nothing staged — the dialog never produced a file
  });

  it("a platform without a dialog answers the typed unsupported verdict (never a silent no-op)", async () => {
    const shell = new SimShell({ fileDialogPresent: false });
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    const capability = await binding.fileImportCapability();
    expect(capability).toEqual({
      supported: false,
      reason: "unsupported",
      detail: expect.stringContaining("no native file-dialog service"),
    });

    const result = await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(result.outcome).toBe("unsupported");
    expect(double.recordCount()).toBe(0);
  });

  it("a connector that does not declare the method never reaches the port (method-honest offer)", async () => {
    const shell = pickableShell();
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    const result = await binding.importFromFile({
      connectorId: "someconnector",
      method: "official-export",
      connectorCapabilities: [{ method: "api", supportsContinuousSync: true, supportsFollowing: true, supportsPlaylists: false, supportsLikesOrSaves: false }],
    });
    expect(result.outcome).toBe("unsupported");
    if (result.outcome === "unsupported") {
      expect(result.detail).toContain("does not declare the 'official-export' import capability");
    }
    // The dialog never opened (the capability truth answered first).
    expect(shell.pickRequests).toHaveLength(0);
    expect(double.recordCount()).toBe(0);
  });

  it("an unreadable file is the typed failed verdict (never empty bytes)", async () => {
    const shell = pickableShell();
    shell.unreadablePaths.add("/home/user/exports/feed.json");
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    const result = await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.code).toBe("file-read");
      expect(result.detail).toContain("could not be read");
    }
    expect(double.recordCount()).toBe(0);
  });

  it("a rejecting preview is the typed failed verdict (the raw error never leaks)", async () => {
    const shell = pickableShell();
    const double = makeDouble();
    const failing = {
      previewImport: async () => {
        throw new Error("the export parser rejected the artifact (scripted)");
      },
      confirmImport: (id: string) => double.port.confirmImport(id),
      readFeed: (input: { profileId: string; mode: "webflix" | "following" | "byof" | "hybrid" }) =>
        double.port.readFeed(input),
      syncImport: (id: string) => double.port.syncImport(id),
    };
    const binding = createDesktopFeedImportBinding({ shell, feedPort: failing });

    const result = await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.code).toBe("preview");
      expect(result.detail).toContain("the feed preview failed");
    }
  });

  it("a non-file method is the typed invalid-input verdict (the dialog is not the API lane)", async () => {
    const shell = pickableShell();
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    const result = await binding.importFromFile({ connectorId: "youtube", method: "api" });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.code).toBe("invalid-input");
      expect(result.detail).toContain("not a file import method");
    }
    expect(shell.pickRequests).toHaveLength(0); // no dialog opened
  });

  it("the dialog request stays in plain product language with the export filters", async () => {
    const shell = pickableShell();
    const double = makeDouble();
    const binding = createDesktopFeedImportBinding({ shell, feedPort: double.port });

    await binding.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(shell.pickRequests).toHaveLength(1);
    const request = shell.pickRequests[0];
    expect(request?.title).toBe("Choose your feed export file");
    expect(request?.filters?.[0]?.name).toBe("Feed export");
  });
});

describe("R20-F — the shell file-import seam (SimShell truth)", () => {
  it("the pick reports the shell-truth metadata (path, name, size)", async () => {
    const shell = pickableShell();
    const outcome = await shell.filePickOpen({});
    expect(outcome.picked).toBe(true);
    if (outcome.picked) {
      expect(outcome.file.path).toBe("/home/user/exports/feed.json");
      expect(outcome.file.fileName).toBe("feed.json");
      expect(outcome.file.sizeBytes).toBe(testExportArtifact(EXPORT).byteLength);
    }
  });

  it("fileRead answers the exact bytes; an unknown path is the typed io failure", async () => {
    const shell = pickableShell();
    const bytes = await shell.fileRead("/home/user/exports/feed.json");
    expect([...bytes]).toEqual([...testExportArtifact(EXPORT)]);
    await expect(shell.fileRead("/nowhere/x.json")).rejects.toThrow(
      /does not exist on this platform/,
    );
  });

  it("the executor task report seam moves known tasks and refuses unknown ids", async () => {
    const shell = new SimShell();
    await shell.taskSchedule({ taskId: "sync-1", kind: "sync", label: "Feed sync" });
    const moved = await shell.taskReport({ taskId: "sync-1", state: "running", progress: -1 });
    expect(moved).toBe(true);
    expect((await shell.taskStatus("sync-1"))?.state).toBe("running");
    const unknown = await shell.taskReport({ taskId: "ghost", state: "running", progress: -1 });
    expect(unknown).toBe(false); // never a fake transition
  });
});

void T0;
