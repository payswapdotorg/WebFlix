/**
 * @wfx/client-runtime — R23-C first-class torrent-realization tests.
 *
 * The first-class torrent realization contract, at the shared seam:
 * - NO new PlaybackMode: the compile-time guard + the rung mapping only
 *   ever answer existing modes (native on Desktop; browser on a
 *   browser-capable platform; null otherwise);
 * - the rung-satisfaction decision table: Desktop native rung / Web
 *   browser rung where truly supported / the honest Desktop next step /
 *   the authorization gate (unauthorized copies are never offered);
 * - the user vocabulary: "Where to watch -> Authorized peer copy" —
 *   NEVER merely "Offline copy" (machine-checked);
 * - the acquisition lifecycle stays the frozen protocol-free vocabulary;
 * - the nine-dimension first-class parity contract (torrent and provider
 *   realizations share canonical identity, resume, Like/Save, AI
 *   actions, feedback, telemetry, Library, choice, recovery);
 * - the Where-to-watch grouping vocabulary (WebFlix source / authorized
 *   peer copy / other realizations).
 */

import { describe, expect, it } from "bun:test";

import {
  REALIZATION_TRANSPORT_KINDS,
  TORRENT_ACQUISITION_STATES,
  TORRENT_DESKTOP_NEXT_STEP,
  TORRENT_FORBIDDEN_PRIMARY_LABELS,
  TORRENT_PARITY_CONTRACT,
  TORRENT_PARITY_DIMENSIONS,
  TORRENT_REALIZATION_VIEW,
  WHERE_TO_WATCH_ENTRY_KINDS,
  WHERE_TO_WATCH_GROUP_VIEWS,
  isLawfulTorrentPrimaryLabel,
  isRealizationTransportKind,
  isTorrentParityDimension,
  isTorrentRealizationDeclaration,
  isWhereToWatchEntryKind,
  torrentParityDimensionCovered,
  torrentPlaybackModeOf,
  torrentRungSatisfaction,
  type TorrentPlatformTruth,
  type TorrentRealizationDeclaration,
} from "../src/index";

const AUTHORIZED = (browserCapable: boolean): TorrentRealizationDeclaration => ({
  transport: "torrent",
  authorized: true,
  browserCapable,
  accessClass: "public",
});

const UNAUTHORIZED: TorrentRealizationDeclaration = {
  transport: "torrent",
  authorized: false,
  browserCapable: true,
  accessClass: "public",
};

const DESKTOP: TorrentPlatformTruth = {
  platform: "desktop",
  browserTorrentSupported: false,
};

const WEB_WITH_BROWSER_TORRENT: TorrentPlatformTruth = {
  platform: "web",
  browserTorrentSupported: true,
};

const WEB_WITHOUT_BROWSER_TORRENT: TorrentPlatformTruth = {
  platform: "web",
  browserTorrentSupported: false,
};

const MOBILE: TorrentPlatformTruth = {
  platform: "mobile",
  browserTorrentSupported: false,
};

// ---------------------------------------------------------------------------
// The no-new-playback-mode law
// ---------------------------------------------------------------------------

describe("R23-C — no generic PlaybackMode = torrent", () => {
  it("the transport-kind vocabulary is provider | torrent (a SOURCE KIND, not a mode)", () => {
    expect(REALIZATION_TRANSPORT_KINDS).toEqual(["provider", "torrent"]);
    expect(isRealizationTransportKind("torrent")).toBe(true);
    expect(isRealizationTransportKind("provider")).toBe(true);
    // A mode-shaped value is NOT a transport kind — the drift probe.
    expect(isRealizationTransportKind("native")).toBe(false);
    expect(isRealizationTransportKind("browser")).toBe(false);
  });

  it("the rung mapping only ever answers EXISTING playback modes", () => {
    for (const truth of [
      DESKTOP,
      WEB_WITH_BROWSER_TORRENT,
      WEB_WITHOUT_BROWSER_TORRENT,
      MOBILE,
    ]) {
      for (const realization of [AUTHORIZED(true), AUTHORIZED(false), UNAUTHORIZED]) {
        const satisfaction = torrentRungSatisfaction(truth, realization);
        const mode = torrentPlaybackModeOf(satisfaction);
        // Every non-null mode is one of the frozen four — never "torrent".
        if (mode !== null) {
          expect(["native", "embed", "browser", "external"]).toContain(mode);
          expect(mode).not.toBe("torrent");
        }
      }
    }
  });

  it("the declaration guard accepts only truthful torrent declarations", () => {
    expect(isTorrentRealizationDeclaration(AUTHORIZED(true))).toBe(true);
    expect(isTorrentRealizationDeclaration(UNAUTHORIZED)).toBe(true);
    expect(
      isTorrentRealizationDeclaration({ ...AUTHORIZED(true), transport: "provider" }),
    ).toBe(false);
    expect(
      isTorrentRealizationDeclaration({ ...AUTHORIZED(true), authorized: "yes" }),
    ).toBe(false);
    expect(isTorrentRealizationDeclaration(null)).toBe(false);
    expect(isTorrentRealizationDeclaration("torrent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The rung-satisfaction decision table
// ---------------------------------------------------------------------------

describe("R23-C — the rung-satisfaction decision table (Media Surface preserved)", () => {
  it("Desktop: an authorized torrent realization satisfies the NATIVE rung", () => {
    for (const browserCapable of [true, false]) {
      const satisfaction = torrentRungSatisfaction(
        DESKTOP,
        AUTHORIZED(browserCapable),
      );
      expect(satisfaction.kind).toBe("satisfies-native-rung");
      if (satisfaction.kind === "satisfies-native-rung") {
        expect(satisfaction.mode).toBe("native");
        expect(satisfaction.detail).toContain("native player");
      }
      expect(torrentPlaybackModeOf(satisfaction)).toBe("native");
    }
  });

  it("Web: a browser-capable realization satisfies the BROWSER rung where truly supported", () => {
    const satisfaction = torrentRungSatisfaction(
      WEB_WITH_BROWSER_TORRENT,
      AUTHORIZED(true),
    );
    expect(satisfaction.kind).toBe("satisfies-browser-rung");
    if (satisfaction.kind === "satisfies-browser-rung") {
      expect(satisfaction.mode).toBe("browser");
      expect(satisfaction.detail).toContain("browser");
    }
    expect(torrentPlaybackModeOf(satisfaction)).toBe("browser");
  });

  it("Web: a non-browser-capable swarm answers the honest Desktop next step (same canonical item)", () => {
    const satisfaction = torrentRungSatisfaction(
      WEB_WITHOUT_BROWSER_TORRENT,
      AUTHORIZED(false),
    );
    expect(satisfaction.kind).toBe("desktop-next-step");
    if (satisfaction.kind === "desktop-next-step") {
      expect(satisfaction.nextStep).toBe(TORRENT_DESKTOP_NEXT_STEP);
      expect(satisfaction.nextStep.label).toBe("Play this in the Desktop app");
      expect(satisfaction.nextStep.detail).toContain("the same there");
    }
    expect(torrentPlaybackModeOf(satisfaction)).toBeNull();
  });

  it("Web: browser-capable swarm but NO browser-torrent platform support answers the Desktop next step", () => {
    // Today's Web boot: browserTorrentSupported = false until R23-D lands.
    const satisfaction = torrentRungSatisfaction(
      WEB_WITHOUT_BROWSER_TORRENT,
      AUTHORIZED(true),
    );
    expect(satisfaction.kind).toBe("desktop-next-step");
    expect(torrentPlaybackModeOf(satisfaction)).toBeNull();
  });

  it("an UNAUTHORIZED torrent realization is NEVER offered (the R11/R13 gate)", () => {
    for (const truth of [DESKTOP, WEB_WITH_BROWSER_TORRENT, WEB_WITHOUT_BROWSER_TORRENT]) {
      const satisfaction = torrentRungSatisfaction(truth, UNAUTHORIZED);
      expect(satisfaction.kind).toBe("requires-authorization");
      if (satisfaction.kind === "requires-authorization") {
        expect(satisfaction.detail).toContain("not authorized");
        expect(satisfaction.detail).toContain("permitted");
      }
      expect(torrentPlaybackModeOf(satisfaction)).toBeNull();
    }
  });

  it("Mobile honestly answers the Desktop next step (no capability claim without an adapter path)", () => {
    const satisfaction = torrentRungSatisfaction(MOBILE, AUTHORIZED(true));
    expect(satisfaction.kind).toBe("desktop-next-step");
  });
});

// ---------------------------------------------------------------------------
// The user vocabulary
// ---------------------------------------------------------------------------

describe("R23-C — the user vocabulary (never merely Offline copy)", () => {
  it("the primary entry label is 'Authorized peer copy'", () => {
    expect(TORRENT_REALIZATION_VIEW.label).toBe("Authorized peer copy");
    expect(TORRENT_REALIZATION_VIEW.detail).toContain("peer-to-peer");
    expect(TORRENT_REALIZATION_VIEW.detail).toContain("Library");
  });

  it("the vocabulary law accepts the peer-copy vocabulary and rejects offline-only labels", () => {
    expect(isLawfulTorrentPrimaryLabel("Authorized peer copy")).toBe(true);
    expect(isLawfulTorrentPrimaryLabel("authorized PEER COPY")).toBe(true);
    // The forbidden labels — merely offline/download vocabulary.
    for (const forbidden of TORRENT_FORBIDDEN_PRIMARY_LABELS) {
      expect(isLawfulTorrentPrimaryLabel(forbidden)).toBe(false);
      expect(isLawfulTorrentPrimaryLabel(
        forbidden.charAt(0).toUpperCase() + forbidden.slice(1),
      )).toBe(false);
    }
    expect(isLawfulTorrentPrimaryLabel("Offline copy")).toBe(false);
    expect(isLawfulTorrentPrimaryLabel("Download")).toBe(false);
    // Empty/garbage labels are not lawful either.
    expect(isLawfulTorrentPrimaryLabel("")).toBe(false);
    expect(isLawfulTorrentPrimaryLabel("   ")).toBe(false);
    expect(isLawfulTorrentPrimaryLabel("Torrent")).toBe(false);
  });

  it("the acquisition lifecycle stays the frozen protocol-free vocabulary", () => {
    expect(TORRENT_ACQUISITION_STATES).toEqual([
      "available",
      "preparing",
      "buffering",
      "playing",
      "completing",
      "ready-offline",
      "failed",
    ]);
  });

  it("the Desktop next step keeps the same-item honesty", () => {
    expect(TORRENT_DESKTOP_NEXT_STEP.label).toBe("Play this in the Desktop app");
    expect(TORRENT_DESKTOP_NEXT_STEP.detail).toContain("the same there");
  });
});

// ---------------------------------------------------------------------------
// The Where-to-watch grouping vocabulary
// ---------------------------------------------------------------------------

describe("R23-C — the Where-to-watch grouping vocabulary", () => {
  it("the frozen entry order: WebFlix source, authorized peer copy, other realizations", () => {
    expect(WHERE_TO_WATCH_ENTRY_KINDS).toEqual([
      "webflix-source",
      "authorized-peer-copy",
      "other-realizations",
    ]);
    for (const kind of WHERE_TO_WATCH_ENTRY_KINDS) {
      expect(isWhereToWatchEntryKind(kind)).toBe(true);
    }
    expect(isWhereToWatchEntryKind("offline-copy")).toBe(false);
    expect(isWhereToWatchEntryKind("downloads")).toBe(false);
  });

  it("every group carries its frozen label + detail (the one derivation source)", () => {
    expect(WHERE_TO_WATCH_GROUP_VIEWS["authorized-peer-copy"].label).toBe(
      "Authorized peer copy",
    );
    for (const kind of WHERE_TO_WATCH_ENTRY_KINDS) {
      const view = WHERE_TO_WATCH_GROUP_VIEWS[kind];
      expect(view.kind).toBe(kind);
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.detail.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The first-class parity set
// ---------------------------------------------------------------------------

describe("R23-C — the nine-dimension first-class parity contract", () => {
  it("covers EXACTLY the plan's parity dimensions", () => {
    expect(TORRENT_PARITY_DIMENSIONS).toEqual([
      "canonical-item-identity",
      "resume-position",
      "like-save-semantics",
      "ai-actions",
      "recommendation-feedback",
      "playback-telemetry",
      "library-integration",
      "availability-realization-choice",
      "error-recovery-vocabulary",
    ]);
    for (const dimension of TORRENT_PARITY_DIMENSIONS) {
      expect(isTorrentParityDimension(dimension)).toBe(true);
    }
    expect(isTorrentParityDimension("download-manager")).toBe(false);
  });

  it("every dimension carries a frozen parity clause (the audit passes)", () => {
    expect(TORRENT_PARITY_CONTRACT).toHaveLength(TORRENT_PARITY_DIMENSIONS.length);
    for (const dimension of TORRENT_PARITY_DIMENSIONS) {
      expect(torrentParityDimensionCovered(dimension)).toBe(true);
      const clause = TORRENT_PARITY_CONTRACT.find(
        (row) => row.dimension === dimension,
      );
      expect(clause).toBeDefined();
      expect(clause?.label.length).toBeGreaterThan(0);
      expect(clause?.law.length).toBeGreaterThan(0);
    }
  });

  it("the parity clauses speak in parity vocabulary (same-item language, never second-class)", () => {
    for (const clause of TORRENT_PARITY_CONTRACT) {
      const law = clause.law.toLowerCase();
      const parityLanguage =
        law.includes("same") ||
        law.includes("identically") ||
        law.includes("exactly as") ||
        law.includes("exactly like");
      expect(parityLanguage).toBe(true);
    }
  });
});
