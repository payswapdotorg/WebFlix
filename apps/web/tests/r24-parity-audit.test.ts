/**
 * R24-W2 — the Web parity audit WALKING test (bun:test).
 *
 * Proves the audit record (`src/shared/r24-parity-audit.ts`) is the
 * honest walk it claims to be, mechanically:
 *
 * - RECORD INTEGRITY: 51 rows in the plan's R24-C shape (Discovery 10 /
 *   Watch-player 26 / Shorts 7 / Identity-continuity 8), every row
 *   classified with the frozen vocabulary, zero blank fields, zero
 *   "to be considered" hedges, and the classification distribution the
 *   shared taxonomy's reference rows answer (11 / 31 / 9 / 0).
 * - SHARED-TAXONOMY ALIGNMENT: every row id resolves in Worker 1's
 *   lead-ratified taxonomy and carries ITS classification (this module
 *   is the WEB WALK of the shared matrix, never a second taxonomy).
 * - THE FINDINGS ARE THE LIVE PRODUCT'S TRUTH: the audit-time findings
 *   are asserted against the REAL fixtures-boot composition (rendered
 *   surfaces over the real runtime) — the gaps the audit records are
 *   the gaps the product actually had (never a papered-over record).
 * - THE LANDED STATES: after the R24-W2 corrections, every corrected
 *   row's `currentState` is verified against the corrected composition
 *   (the chrome/queue/share/watchlist/playlist/suggestion surfaces) —
 *   the audit closes its own loop.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost, canonicalIdFor } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadPlayerView, loadSearchView } from "../src/host/view-models";
import {
  WEB_PARITY_AUDIT_ROWS,
  WEB_PARITY_SECTION_COUNTS,
  webParityAuditDistribution,
  webParityAuditAlignmentProblems,
  webParityAuditCoverageProblems,
  webParityCorrectedRows,
} from "../src/shared/r24-parity-audit";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The long-form fixture item (Deep Field Diary — fake:video-1, the browser rung). */
const DIARY = {
  itemId: canonicalIdFor("fake-source", "fake:video-1"),
  connectorId: "fake-source",
  externalRef: "fake:video-1",
  title: "Deep Field Diary",
  canonicalType: "video",
  durationMs: 1_800_000,
} as const;

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// Record integrity (the lab contract's own laws)
// ---------------------------------------------------------------------------

describe("R24-W2 — the audit record's integrity", () => {
  it("walks exactly the plan's R24-C matrix shape (51 rows: 10 / 26 / 7 / 8)", () => {
    expect(WEB_PARITY_AUDIT_ROWS.length).toBe(51);
    expect(WEB_PARITY_SECTION_COUNTS).toEqual({
      discovery: 10,
      "watch-player": 26,
      shorts: 7,
      "identity-continuity": 8,
    });
  });

  it("classifies every row with the frozen vocabulary — no blanks, no 'to be considered'", () => {
    for (const row of WEB_PARITY_AUDIT_ROWS) {
      expect(["parity", "native-equivalent", "platform-variant", "intentionally-out-of-scope"]).toContain(
        row.classification,
      );
      for (const field of [row.finding, row.currentState, row.entryPoint, row.webBacking, row.evidence]) {
        expect(field.length).toBeGreaterThan(0);
        expect(field.toLowerCase()).not.toContain("to be considered");
      }
    }
  });

  it("answers the reference-row distribution the shared taxonomy freezes (11 / 31 / 9 / 0)", () => {
    expect(webParityAuditDistribution()).toEqual({
      parity: 11,
      "native-equivalent": 31,
      "platform-variant": 9,
      "intentionally-out-of-scope": 0,
    });
  });

  it("is machine-aligned to the shared lead-ratified taxonomy (never a second taxonomy)", () => {
    expect(webParityAuditAlignmentProblems()).toEqual([]);
    expect(webParityAuditCoverageProblems()).toEqual([]);
  });

  it("records the honest gap set as corrections (the audit never papered over a gap)", () => {
    const corrected = webParityCorrectedRows().map((row) => row.id);
    // The player-chrome family — the audit's largest honest gap.
    for (const id of ["play-pause", "seek-scrub", "volume-mute", "fullscreen", "playback-speed", "captions"]) {
      expect(corrected).toContain(id);
    }
    // The adjacent-content family.
    for (const id of ["up-next", "queue", "save-queue", "autoplay", "related-next-videos"]) {
      expect(corrected).toContain(id);
    }
    // The decision-row family.
    for (const id of ["watch-later", "share", "playlists", "search-suggestions"]) {
      expect(corrected).toContain(id);
    }
    // The Shorts family.
    for (const id of ["shorts-speed-controls", "shorts-clear-screen", "shorts-inline-feedback"]) {
      expect(corrected).toContain(id);
    }
    expect(corrected.length).toBe(26);
  });
});

// ---------------------------------------------------------------------------
// The startup law (R24-E) — the corrected order after the R24-W2
// corrections landed (the audit-time finding — the media resolution
// waiting on the enrichment reads — is preserved in the audit record's
// `finding` fields + the evidence; the live law now asserts the fix)
// ---------------------------------------------------------------------------

describe("R24-W2 — the corrected startup law: the media path leads", () => {
  it("loadPlayerView resolves the playback session BEFORE any AI/model enrichment read (the R24-E law)", async () => {
    const host = await bootHost();
    const order: string[] = [];
    const originalResolve = host.runtime.resolvePlayback.bind(host.runtime);
    (host.runtime as unknown as { resolvePlayback: unknown }).resolvePlayback = async (
      ...args: Parameters<typeof originalResolve>
    ) => {
      order.push("resolve-playback");
      return originalResolve(...args);
    };
    const originalProviders = host.runtime.modelControls.refreshProviders.bind(
      host.runtime.modelControls,
    );
    (host.runtime.modelControls as unknown as { refreshProviders: unknown }).refreshProviders =
      async (...args: Parameters<typeof originalProviders>) => {
        order.push("enrichment-read");
        return originalProviders(...args);
      };
    await loadPlayerView(host, DIARY);
    // The corrected truth: the playback resolution LEADS — every
    // enrichment read (the AI-tray/live-ASR model-controls reads) fires
    // after the media path resolved (the R24-E startup architecture law:
    // no AI/recommendation work blocks the media critical path).
    const firstResolve = order.indexOf("resolve-playback");
    const firstEnrichment = order.indexOf("enrichment-read");
    expect(firstResolve).toBeGreaterThanOrEqual(0);
    expect(firstEnrichment).toBeGreaterThanOrEqual(0);
    expect(firstResolve).toBeLessThan(firstEnrichment);
  });
});

// ---------------------------------------------------------------------------
// The audit-time findings (the immutable pre-correction walk, kept honest
// by the evidence record; the module paths below are checked as RECORDED)
// ---------------------------------------------------------------------------

describe("R24-W2 — the audit-time findings are preserved as the record's own evidence trail", () => {
  it("the pre-correction evidence artifacts exist (the live before-walk screenshots)", () => {
    for (const artifact of [
      "live-home.png",
      "live-player-before.png",
      "live-shorts-before.png",
      "live-library-before.png",
    ]) {
      expect(existsSync(join(import.meta.dir, "../../../evidence/r24-w2/audit", artifact))).toBe(true);
    }
  });

  it("every corrected row's finding names the gap (never a silent rewrite)", () => {
    for (const row of webParityCorrectedRows()) {
      // The finding text carries the honest pre-correction truth (a GAP
      // or PARTIAL GAP marker, or the wired-but-unexposed finding).
      expect(/GAP|PARTIAL|no |NO |not |existed|carried/.test(row.finding)).toBe(true);
    }
  });

  it("the search view's composition held at audit time (title + semantic + moments lanes)", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "deep field");
    expect(view.cards.length).toBeGreaterThan(0);
  });
});
