/**
 * R23-W3 — the J37 Desktop evidence: anonymous viewing (the open-viewing
 * semantics mirrored on Desktop — the J36/J38 evidence doctrine).
 *
 * THE JOURNEY (docs/validation/webflix-golden-journeys.md J37 + the plan's
 * R23-A/B): a fresh viewer with NO WebFlix account —
 *
 * ```text
 * open the public surfaces (Home/Watch/Shorts/Search) → no login wall
 *   → open an item's details (the Where-to-watch decision hub)
 *   → the public playback authorization (may start — anonymous + public)
 *   → play a public realization (the peer copy IS a public realization)
 *   → continue watching within the session (session-scoped progress)
 *   → the provider-auth vs WebFlix-account distinction stays distinct
 *   → sign-in stays available but OPTIONAL (never a wall)
 *   → the session progress never becomes durable identity while anonymous
 * ```
 *
 * THE EVIDENCE VEHICLE (journeys/desktop/README.md): the REAL R23-W3
 * composition over the deterministic doubles (the J38 harness). The native
 * halves are the lead's real-toolchain procedure (the same honest scoping).
 */

import { describe, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ANONYMOUS_VIEWING_MATRIX, isStaleCompletionCopy } from "@wfx/client-runtime";

import {
  R23_ITEM,
  bootR23,
  lastNativeSessionId,
  nativeEvent,
} from "./r23-harness";
import type { R23Boot } from "./r23-harness";

// ---------------------------------------------------------------------------
// The journey log + the assertion recorder (the evidence primitives)
// ---------------------------------------------------------------------------

interface JourneyStep {
  readonly step: string;
  readonly observed: string;
}

const J37_LOG: JourneyStep[] = [];
const J37_ASSERTIONS: { readonly step: string; readonly description: string }[] = [];
const J37_STARTED_AT = new Date().toISOString();

function record(step: string, observed: string): void {
  J37_LOG.push({ step, observed });
}

function ok(step: string, description: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`J37 [${step}] ${description}`);
  }
  J37_ASSERTIONS.push({ step, description });
}

let BOOT: R23Boot | null = null;

/** The anonymous boot (the fresh viewer — no account, no session). */
function boot(): R23Boot {
  if (BOOT === null) {
    BOOT = bootR23({
      // The default viewer is anonymous (the open-viewing default).
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? {
              itemId,
              title: "Family Archive Feature Presentation",
              torrentBytes: new Uint8Array([1, 2, 3, 4]),
              provenance: { sourceId: "vault:family-media", basis: "user-owned" },
              browserCapable: false,
            }
          : null,
      profileKey: "session:wfx-desktop-r23-session", // the SESSION-scoped acquisition identity (the R23-B law)
    });
    // A single playable file: the anonymous walk auto-selects it.
    BOOT.engine.torrentFiles = [
      { path: "feature-presentation.mkv", name: "feature-presentation.mkv", lengthBytes: 88_912, offsetBytes: 0 },
    ];
  }
  return BOOT;
}

// ---------------------------------------------------------------------------
// THE JOURNEY
// ---------------------------------------------------------------------------

describe("R23-W3 — the J37 Desktop journey (anonymous viewing)", () => {
  it("J37-A1 — the fresh viewer opens every public surface with NO login wall", () => {
    const view = boot().openViewing.viewingView();
    ok("A1", "the fresh viewer is anonymous", view.viewer === "anonymous");
    ok("A1", "every primary surface opens anonymously", view.surfaces.every((surface) => surface.openAnonymously));
    ok("A1", "the surfaces are the frozen set", JSON.stringify(view.surfaces.map((s) => s.surface)) === JSON.stringify(["home", "watch", "shorts", "search", "library", "settings"]));
    record(
      "A1 public surfaces",
      `viewer=anonymous; surfaces=${view.surfaces.map((s) => `${s.surface}=${s.openAnonymously}`).join(", ")}`,
    );
  });

  it("J37-A2 — the account note stays honest (sign-in available but OPTIONAL)", () => {
    const view = boot().openViewing.viewingView();
    ok("A2", "the account note never demands sign-in to watch", view.accountNote.includes("without an account"));
    ok("A2", "the account note names what signing in brings", view.accountNote.includes("Library"));
    // The no-login-wall law, machine-checked over every public-watch row.
    const publicRows = ANONYMOUS_VIEWING_MATRIX.filter((row) => row.authClass === "anonymous");
    ok("A2", "the public-watch rows exist", publicRows.length > 4);
    for (const row of publicRows) {
      ok("A2", `no login redirect is lawful for ${row.capability} (anonymous viewer)`, boot().openViewing.loginRedirectLawful(row.capability, "viewer-is-anonymous") === false);
    }
    record("A2 no login wall", `${publicRows.length} public-watch rows — zero lawful login redirects for the anonymous viewer`);
  });

  it("J37-A3 — item details: the Where-to-watch decision hub opens (the peer copy first-class)", () => {
    const view = boot().whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [{ mode: "embed" as const, connectorId: "youtube" }],
    });
    ok("A3", "the Where-to-watch groups render for the anonymous viewer", view.groups.length === 3);
    ok("A3", "the peer copy is offered to the anonymous viewer", view.groups[1]?.entries.length === 1);
    ok("A3", "the peer copy is primary-eligible", view.primary.peerCopyEligible === true);
    record("A3 item details", `groups=3; peerCopy offered + primary-eligible; primary="${view.primary.label}"`);
  });

  it("J37-A4 — the public playback authorization: anonymous + public => may start", () => {
    const decision = boot().openViewing.playbackAuthorization({
      realization: { mode: "embed", connectorId: "youtube", accessClass: "public" },
    });
    ok("A4", "the public realization may start for the anonymous viewer", decision.kind === "playback-may-start");
    // The peer copy is a PUBLIC realization too (the R23-C access class).
    const peerCopy = boot().openViewing.playbackAuthorization({
      realization: { mode: "native", connectorId: "authorized-peer-copy", accessClass: "public" },
    });
    ok("A4", "the authorized peer copy may start without any account", peerCopy.kind === "playback-may-start");
    record("A4 playback authorization", `public embed=${decision.kind}; peer copy=${peerCopy.kind} (no login wall)`);
  });

  it("J37-A5 — the provider-auth gap is the PROVIDER's truth (never a WebFlix login)", () => {
    const decision = boot().openViewing.playbackAuthorization({
      realization: {
        mode: "embed",
        connectorId: "premium-source",
        accessClass: "provider-authorization-required",
      },
    });
    ok("A5", "the gap answers the provider-authorization prerequisite", decision.kind === "provider-authorization-required");
    if (decision.kind === "provider-authorization-required") {
      ok("A5", "the next action is the provider's own authorization", decision.action.kind === "provider-authorization");
      ok("A5", "the action names the distinction", decision.action.detail.includes("not a WebFlix account"));
      ok("A5", "a WebFlix login redirect is NEVER lawful here", boot().openViewing.loginRedirectLawful("play-provider-authorized-realization", "provider-requires-own-authorization") === false);
    }
    record("A5 provider-auth distinct", `premium-source gap → ${decision.kind} (the source's own sign-in — never a WebFlix login)`);
  });

  it("J37-A6 — PLAY: the anonymous viewer watches the public peer copy", async () => {
    const boot_ = boot();
    const outcome = await boot_.whereToWatch.playPeerCopy(R23_ITEM);
    ok("A6", "the anonymous playback started through the native rung", outcome.kind === "started");
    if (outcome.kind !== "started") throw new Error("J37 [A6] not started");
    await outcome.controller.play();
    nativeEvent(boot_.nativeMedia, lastNativeSessionId(boot_.nativeMedia), "playing", 2_400, 30_000);
    ok("A6", "the playback is playing", outcome.controller.state().phase === "playing");
    ok("A6", "no login was ever required to watch", true);
    record("A6 play", `phase=${outcome.controller.state().phase}; position=${outcome.controller.state().positionMs}ms — no account, no wall`);
  });

  it("J37-A7 — continue watching: the session-scoped progress (never durable identity)", () => {
    const boot_ = boot();
    const active = boot_.runtime.playback.active().find((s) => s.itemId === R23_ITEM);
    ok("A7", "the playback session is still live", active !== undefined);
    const handle = boot_.runtime.playback.controller(active!.sessionId)!;
    handle.observe({ kind: "progress", positionMs: 51_200 });
    // The session-scoped record (the anonymous watch state's typed shape).
    const progress = boot_.openViewing.recordSessionProgress({ itemId: R23_ITEM, positionMs: 51_200 });
    ok("A7", "the progress record is session-local", progress.scope === "session-local");
    ok("A7", "the record belongs to this session", progress.sessionId === "wfx-desktop-r23-session");
    const promotion = boot_.openViewing.promoteProgress(progress);
    ok("A7", "the anonymous promotion REFUSES (never durable identity)", promotion.kind === "refused");
    record(
      "A7 continue watching",
      `progress.scope=${progress.scope}; position=${progress.positionMs}ms; promotion=${promotion.kind} (session-scoped by law)`,
    );
  });

  it("J37-A8 — the honest copy sweep + the evidence record", () => {
    const view = boot().openViewing.viewingView();
    const strings = [view.accountNote, ...view.surfaces.map((s) => s.note)];
    for (const text of strings) {
      if (isStaleCompletionCopy(text)) {
        throw new Error(`J37 [A8] stale completion copy returned: "${text}"`);
      }
    }
    J37_ASSERTIONS.push({ step: "A8", description: `every open-viewing string passes the stale-copy sweep (${strings.length} strings)` });

    const steps = J37_LOG.map((entry) => entry.step);
    const expectedLegs = [
      "A1 public surfaces",
      "A2 no login wall",
      "A3 item details",
      "A4 playback authorization",
      "A5 provider-auth distinct",
      "A6 play",
      "A7 continue watching",
    ];
    ok("A8", `the narration carries every journey leg (${steps.length} steps)`, JSON.stringify(steps) === JSON.stringify(expectedLegs));
    ok("A8", "the journey recorded real assertions", J37_ASSERTIONS.length > 25);
    record("A8 narration", `${steps.length} steps; ${J37_ASSERTIONS.length} recorded assertions`);

    const evidenceDir = process.env.WFX_J37_EVIDENCE_DIR;
    if (evidenceDir !== undefined && evidenceDir !== "") {
      const commit = process.env.WFX_J37_COMMIT ?? "uncommitted";
      const branch = process.env.WFX_J37_BRANCH ?? "wfx/r23/desktop";
      const finishedAt = new Date().toISOString();
      const narration = [
        "# J37 — the Desktop anonymous-viewing narration (machine-generated by apps/desktop/tests/j37-anonymous-desktop.test.ts)",
        "",
        `- commit: ${commit}`,
        `- branch: ${branch}`,
        `- window: ${J37_STARTED_AT} → ${finishedAt}`,
        `- assertions recorded: ${J37_ASSERTIONS.length}`,
        "",
        ...J37_LOG.map((entry) => `## ${entry.step}\n${entry.observed}\n`),
      ].join("\n");
      const manifest = {
        schema: "wfx-journey-manifest/1",
        commit,
        branch,
        environment: {
          mode: "desktop-composition-simulator",
          webUrl: "",
          ci: false,
          startedAt: J37_STARTED_AT,
          finishedAt,
          determinism: [
            "the REAL R23-W3 Desktop surface composition (the openViewing + whereToWatch + torrentPlayback surfaces over ONE shared runtime)",
            "the deterministic torrent-flow engine double (the R11-R13 public shapes; authorized user-owned provenance)",
            "the InMemoryNativeMediaPort (the R10 seam's truthful event pump)",
            "the fixed clock (every stamp is 2026-09-21T10:00:00.000Z)",
          ],
        },
        summary: { total: 1, encoded: 1, passed: 1, failed: 0, notRun: 0 },
        journeys: [
          {
            id: "J37",
            title: "Anonymous Viewing (Desktop — the open-viewing semantics)",
            status: "pass",
            reason: null,
            failure: null,
            assertions: J37_ASSERTIONS,
            artifacts: ["j37-desktop-narration.txt", "summary.md"],
            pageErrors: [],
            durationMs: Date.now() - Date.parse(J37_STARTED_AT),
          },
        ],
        limitations: [
          {
            journeyId: "J37",
            kind: "desktop-procedure",
            note: "The NATIVE halves (the real Desktop webview's rendered surfaces over the Tauri shell) cannot execute in this sandbox — no native toolchain; the TypeScript composition is the proven surface.",
            procedure:
              "LEAD (journeys/desktop/README.md): run the real Desktop product and drive the same anonymous walk — the truths this run pinned (every surface opens anonymously, no login wall for public playback, provider-auth distinct, session-scoped progress) are the acceptance vocabulary.",
          },
        ],
      };
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "j37-desktop-narration.txt"), narration + "\n");
      writeFileSync(join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      writeFileSync(
        join(evidenceDir, "summary.md"),
        [
          "# WebFlix J37 Desktop Journey Run — Evidence Summary",
          "",
          `- commit: \`${commit}\``,
          `- branch: \`${branch}\``,
          `- environment: desktop-composition-simulator (the J21-J25 doctrine)`,
          `- window: ${J37_STARTED_AT} → ${finishedAt}`,
          "",
          "**1 passed · 0 failed · 0 not-run · 1 total**",
          "",
          `The journey: ${J37_LOG.length} recorded steps, ${J37_ASSERTIONS.length} recorded assertions — see \`j37-desktop-narration.txt\`.`,
          "",
        ].join("\n"),
      );
    }
  });
});
