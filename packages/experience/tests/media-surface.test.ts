/**
 * @wfx/experience — R09 Media Surface wiring tests.
 *
 * The deterministic, networkless test layer for the precedence wired
 * end-to-end and the EMBED rung's capability model:
 *
 * - `answerMediaSurface`: the frozen precedence for ALL capability
 *   combinations (native > embed > browser > external; every fallback when
 *   a higher rung is absent); every honestly-unavailable rung is SKIPPED
 *   AND NAMED in the rung verdicts; the answer's chosen-rung line names
 *   what was chosen and why; the answer AGREES with the frozen resolver.
 * - The official-embed marker model: the marker is consumed (official /
 *   unofficial / absent differentiated + named), NEVER overrides the frozen
 *   precedence, and the matrix consumes it (`embedCapabilityMatrix`).
 * - The embed containment law: the shared sandbox tokens satisfy the
 *   discipline (no allow-same-origin, no storage-access grant) and reject
 *   violating token lists.
 * - The external return context (J09): the durable continuation's shape,
 *   its typed validation, and the seed when the external rung wins.
 */

import { describe, expect, it } from "bun:test";

import {
  ExperienceError,
  OFFICIAL_EMBED_CAPABILITY,
  EMBED_SANDBOX_TOKENS,
  EMBED_CONTAINMENT_LAW,
  SURFACE_DESKTOP_FULL_DEVICE,
  SURFACE_KIOSK_BROWSER_ONLY_DEVICE,
  SURFACE_MOBILE_RESTRICTED_DEVICE,
  SURFACE_NOW,
  SURFACE_PERMISSIONS_PERMISSIVE,
  SURFACE_PERMISSIONS_WITH_HINTS,
  SURFACE_REALIZATION_ALL_MODES,
  SURFACE_REALIZATION_ALL_MODES_REVERSED,
  SURFACE_REQUEST_ALL_MODES_DESKTOP,
  SURFACE_DEVICE_PROFILES,
  SURFACE_ITEMS,
  buildExternalReturnContext,
  describeExternalReturnContext,
  embedCapabilityMatrix,
  isOfficialEmbed,
  officialEmbedTruth,
  resolveSurface,
  satisfiesEmbedContainment,
  answerMediaSurface,
  chosenEmbedIsOfficial,
  chosenRungLine,
  parsePrecedenceTrace,
} from "../src/index";

type Rung = "native" | "embed" | "browser" | "external";

interface AnswerOverrides {
  realizations?: readonly unknown[];
  device?: unknown;
  permissions?: unknown;
}

/** Deterministic answer builder (desktop-full + permissive by default). */
function answer(overrides: AnswerOverrides = {}) {
  return answerMediaSurface({
    item: SURFACE_REQUEST_ALL_MODES_DESKTOP.item,
    realizations:
      (overrides.realizations as never) ?? SURFACE_REALIZATION_ALL_MODES.map((r) => ({ ...r })),
    device: (overrides.device as never) ?? SURFACE_DESKTOP_FULL_DEVICE,
    permissions: (overrides.permissions as never) ?? SURFACE_PERMISSIONS_PERMISSIVE,
    now: SURFACE_NOW,
  });
}

/** One realization of a mode, officially marked when requested. */
function realizationOf(mode: Rung, official = false): Record<string, unknown> {
  const base: Record<string, unknown> = {
    mode,
    connectorId: "r09-test-source",
    externalRef: "r09:test-item",
    capabilities: [`play${mode.charAt(0).toUpperCase()}${mode.slice(1)}`],
  };
  if (mode === "embed" || mode === "browser" || mode === "external") {
    base.url = `https://r09.invalid/${mode}/test-item`;
  }
  if (mode === "embed" && official) {
    base.capabilities = ["playEmbed", OFFICIAL_EMBED_CAPABILITY];
  }
  return base;
}

/** The verdict of one rung from an answer (fails loudly when missing). */
function verdictOf(rungs: readonly { rung: string; verdict: string }[], rung: Rung): string {
  const found = rungs.find((entry) => entry.rung === rung);
  if (found === undefined) throw new Error(`no verdict for rung '${rung}'`);
  return found.verdict;
}

// ---------------------------------------------------------------------------
// The precedence, wired — all capability combinations
// ---------------------------------------------------------------------------

describe("R09 — the precedence wired end-to-end (answerMediaSurface)", () => {
  it("native wins when truthfully available; every later rung is SKIPPED (named, never rejected)", () => {
    const a = answer();
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("native");
    expect(verdictOf(a.rungs, "native")).toBe("accepted");
    expect(verdictOf(a.rungs, "embed")).toBe("skipped");
    expect(verdictOf(a.rungs, "browser")).toBe("skipped");
    expect(verdictOf(a.rungs, "external")).toBe("skipped");
    expect(a.rungs.map((entry) => entry.rung)).toEqual(["native", "embed", "browser", "external"]);
    // The chosen-rung line NAMES what was chosen and why.
    const chosen = chosenRungLine(a);
    expect(chosen).toContain("native: accepted — realization #");
  });

  it("caller array order never changes the precedence (reversed set still resolves native)", () => {
    const a = answer({ realizations: SURFACE_REALIZATION_ALL_MODES_REVERSED.map((r) => ({ ...r })) });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("native");
  });

  it("embed wins when native is honestly absent (the rung's fallback, named)", () => {
    const a = answer({
      realizations: [
        realizationOf("embed"),
        realizationOf("browser"),
        realizationOf("external"),
      ],
    });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("embed");
    expect(verdictOf(a.rungs, "native")).toBe("rejected");
    expect(a.rungs.find((entry) => entry.rung === "native")?.reason).toContain(
      "no native realization present",
    );
    expect(verdictOf(a.rungs, "embed")).toBe("accepted");
  });

  it("browser wins when native+embed are honestly absent (the fallback chain, named)", () => {
    const a = answer({
      realizations: [realizationOf("browser"), realizationOf("external")],
    });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("browser");
    expect(verdictOf(a.rungs, "native")).toBe("rejected");
    expect(verdictOf(a.rungs, "embed")).toBe("rejected");
    expect(verdictOf(a.rungs, "browser")).toBe("accepted");
    expect(verdictOf(a.rungs, "external")).toBe("skipped");
  });

  it("external wins when it is the only truthfully-available rung (J09)", () => {
    const a = answer({ realizations: [realizationOf("external")] });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("external");
    expect(verdictOf(a.rungs, "native")).toBe("rejected");
    expect(verdictOf(a.rungs, "embed")).toBe("rejected");
    expect(verdictOf(a.rungs, "browser")).toBe("rejected");
    expect(verdictOf(a.rungs, "external")).toBe("accepted");
    // The return-context seed rides on the answer.
    expect(a.externalReturn).not.toBeNull();
    expect(a.externalReturn?.itemId).toBe(SURFACE_REQUEST_ALL_MODES_DESKTOP.item.id);
    expect(a.externalReturn?.connectorId).toBe("r09-test-source");
  });

  it("a rung the DEVICE cannot realize is rejected and named (web-style device: no native)", () => {
    const webLike = {
      playbackModes: ["embed", "browser", "external"],
      codecs: ["h264", "vp9", "aac"],
      browser: true,
      backgroundPlayback: false,
      casting: false,
    };
    const a = answer({ device: webLike });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("embed");
    const native = a.rungs.find((entry) => entry.rung === "native");
    expect(native?.verdict).toBe("rejected");
    expect(native?.reason).toContain("device cannot realize native playback");
    expect(native?.reason).toContain("device declares [embed, browser, external]");
  });

  it("the kiosk (browser-only) device honestly rejects native/embed/external declarations", () => {
    const a = answer({ device: SURFACE_KIOSK_BROWSER_ONLY_DEVICE });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) expect(a.resolution.mode).toBe("browser");
    expect(verdictOf(a.rungs, "native")).toBe("rejected");
    expect(verdictOf(a.rungs, "embed")).toBe("rejected");
    expect(verdictOf(a.rungs, "browser")).toBe("accepted");
  });

  it("every honestly-unavailable rung is skipped and named across ALL device profiles", () => {
    for (const profile of SURFACE_DEVICE_PROFILES) {
      const a = answer({ device: profile.device });
      // The rung verdicts are complete (one per rung, precedence order) and
      // every rejected line carries a NON-EMPTY named reason.
      expect(a.rungs).toHaveLength(4);
      for (const entry of a.rungs) {
        expect(entry.reason.length).toBeGreaterThan(0);
        if (entry.verdict === "rejected") {
          expect(entry.reason).toContain("rejected — ");
        }
        if (entry.verdict === "skipped") {
          expect(entry.reason).toContain("skipped — precedence satisfied by");
        }
      }
    }
  });

  it("provider hints never override the frozen precedence (advisory only, trace carries the note)", () => {
    const a = answer({ permissions: SURFACE_PERMISSIONS_WITH_HINTS });
    expect(a.resolution.ok).toBe(true);
    if (a.resolution.ok) {
      expect(a.resolution.mode).toBe("native"); // hint preferred embed — denied
      expect(a.resolution.precedenceTrace.some((line) => line.startsWith("hint:"))).toBe(true);
    }
  });

  it("the answer AGREES with the frozen resolver (verbatim resolution, parsed rungs)", () => {
    const request = {
      item: SURFACE_REQUEST_ALL_MODES_DESKTOP.item,
      realizations: SURFACE_REALIZATION_ALL_MODES.map((r) => ({ ...r })),
      device: SURFACE_MOBILE_RESTRICTED_DEVICE,
      permissions: SURFACE_PERMISSIONS_PERMISSIVE,
      now: SURFACE_NOW,
    };
    const resolution = resolveSurface(request);
    const a = answerMediaSurface(request);
    expect(a.resolution).toEqual(resolution);
  });

  it("an unresolvable request answers the typed dead end with every rung named", () => {
    const a = answer({ realizations: [] });
    expect(a.resolution.ok).toBe(false);
    if (!a.resolution.ok) {
      expect(a.resolution.reasons.length).toBeGreaterThan(0);
      expect(a.resolution.reasons[0]).toContain("unresolvable");
    }
    // The rung verdicts still name all four rejections.
    for (const entry of a.rungs) expect(entry.verdict).toBe("rejected");
    expect(a.externalReturn).toBeNull();
    expect(chosenRungLine(a)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The official-embed capability model (the marker consumed when present)
// ---------------------------------------------------------------------------

describe("R09 — the official-embed marker model", () => {
  it("the marker is read defensively: only embed realizations carrying the entry are official", () => {
    expect(isOfficialEmbed(realizationOf("embed", true) as never)).toBe(true);
    expect(isOfficialEmbed(realizationOf("embed") as never)).toBe(false);
    expect(isOfficialEmbed(realizationOf("browser", true) as never)).toBe(false);
    expect(isOfficialEmbed({ mode: "embed" } as never)).toBe(false); // no capabilities array
  });

  it("officialEmbedTruth differentiates and NAMES official / unofficial / absent", () => {
    const official = officialEmbedTruth([
      realizationOf("embed", true) as never,
      realizationOf("native") as never,
    ]);
    expect(official.truth).toBe("official");
    expect(official.officialCount).toBe(1);
    expect(official.unofficialCount).toBe(0);
    expect(official.description).toContain("official embed player");

    const unofficial = officialEmbedTruth([realizationOf("embed") as never]);
    expect(unofficial.truth).toBe("unofficial");
    expect(unofficial.description).toContain("unattested");

    const absent = officialEmbedTruth([realizationOf("browser") as never]);
    expect(absent.truth).toBe("absent");
    expect(absent.description).toContain("honestly-unavailable");
  });

  it("the marker NEVER overrides the frozen precedence (same winner and trace, marked or not)", () => {
    const unmarked = answer({ realizations: [realizationOf("embed")] });
    const marked = answer({ realizations: [realizationOf("embed", true)] });
    expect(unmarked.resolution.ok).toBe(true);
    expect(marked.resolution.ok).toBe(true);
    if (unmarked.resolution.ok && marked.resolution.ok) {
      // Same winner mode and the IDENTICAL precedence trace — the marker is
      // truth-naming metadata, never a precedence input.
      expect(marked.resolution.mode).toBe("embed");
      expect(unmarked.resolution.mode).toBe("embed");
      expect(marked.resolution.precedenceTrace).toEqual(unmarked.resolution.precedenceTrace);
      expect(marked.resolution.chosen.connectorId).toBe(unmarked.resolution.chosen.connectorId);
    }
    expect(marked.embed.truth).toBe("official");
    expect(unmarked.embed.truth).toBe("unofficial");
  });

  it("the answer surfaces the chosen embed's attestation (null for other rungs)", () => {
    const marked = answer({ realizations: [realizationOf("embed", true)] });
    expect(chosenEmbedIsOfficial(marked)).toBe(true);
    const unmarked = answer({ realizations: [realizationOf("embed")] });
    expect(chosenEmbedIsOfficial(unmarked)).toBe(false);
    const native = answer();
    expect(chosenEmbedIsOfficial(native)).toBeNull();
  });

  it("THE MATRIX CONSUMES THE MARKER: every profile × truth row, decisions consistent with canPlay", () => {
    const rows = embedCapabilityMatrix();
    expect(rows).toHaveLength(12); // 4 profiles × 3 truths
    for (const row of rows) {
      expect(row.reason.length).toBeGreaterThan(0);
      if (row.profile === "tv-native" || row.profile === "kiosk-browser-only") {
        expect(row.deviceSupportsEmbed).toBe(false);
        expect(row.decision).toBe("rejected-device");
      } else {
        expect(row.deviceSupportsEmbed).toBe(true);
        expect(row.decision).toBe(
          row.truth === "official"
            ? "chosen-official"
            : row.truth === "unofficial"
              ? "chosen-unofficial"
              : "absent",
        );
      }
    }
    // Deterministic: two calls answer deeply equal rows.
    expect(embedCapabilityMatrix()).toEqual(rows);
  });
});

// ---------------------------------------------------------------------------
// The embed containment law (shared discipline, both adapters' embed mounts)
// ---------------------------------------------------------------------------

describe("R09 — the embed containment law", () => {
  it("the shared sandbox tokens satisfy the discipline: all required, NO allow-same-origin", () => {
    expect(satisfiesEmbedContainment(EMBED_SANDBOX_TOKENS)).toBe(true);
    expect(EMBED_SANDBOX_TOKENS).toContain("allow-scripts");
    expect(EMBED_SANDBOX_TOKENS).not.toContain("allow-same-origin");
    expect(EMBED_SANDBOX_TOKENS).not.toContain("allow-storage-access-by-user-activation");
  });

  it("violating token lists fail the discipline (isolation is not optional)", () => {
    expect(satisfiesEmbedContainment([...EMBED_SANDBOX_TOKENS, "allow-same-origin"])).toBe(false);
    expect(
      satisfiesEmbedContainment([...EMBED_SANDBOX_TOKENS, "allow-storage-access-by-user-activation"]),
    ).toBe(false);
    expect(satisfiesEmbedContainment(EMBED_SANDBOX_TOKENS.slice(1))).toBe(false);
    expect(satisfiesEmbedContainment([])).toBe(false);
  });

  it("the law lines name the three invariants (official mechanism, containment, provider opacity)", () => {
    expect(EMBED_CONTAINMENT_LAW).toHaveLength(3);
    expect(EMBED_CONTAINMENT_LAW.join(" ")).toContain("OFFICIAL embed mechanism");
    expect(EMBED_CONTAINMENT_LAW.join(" ")).toContain("cookie/storage-isolated");
    expect(EMBED_CONTAINMENT_LAW.join(" ")).toContain("no script injection");
  });
});

// ---------------------------------------------------------------------------
// The external return context (J09)
// ---------------------------------------------------------------------------

describe("R09 — the external handoff's RETURN CONTEXT (J09)", () => {
  const NOW = "2026-09-16T12:00:00.000Z";

  it("builds the durable continuation: item + position at handoff", () => {
    const context = buildExternalReturnContext(
      {
        itemId: SURFACE_ITEMS[0]!.id,
        connectorId: "r09-test-source",
        externalRef: "r09:test-item",
        positionMs: 1_234_567,
      },
      NOW,
    );
    expect(context).toEqual({
      itemId: SURFACE_ITEMS[0]!.id,
      connectorId: "r09-test-source",
      externalRef: "r09:test-item",
      positionMs: 1_234_567,
      handedOffAt: NOW,
    });
  });

  it("malformed input throws the typed ExperienceError with every problem named", () => {
    expect(() =>
      buildExternalReturnContext(
        { itemId: "not-an-item", connectorId: "", externalRef: "", positionMs: -1 },
        "not-a-date",
      ),
    ).toThrow(ExperienceError);
    try {
      buildExternalReturnContext(
        { itemId: "not-an-item", connectorId: "", externalRef: "", positionMs: -1 },
        "not-a-date",
      );
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      expect(message).toContain("itemId");
      expect(message).toContain("connectorId");
      expect(message).toContain("externalRef");
      expect(message).toContain("positionMs");
      expect(message).toContain("now");
    }
  });

  it("the honest one-line summary names the continuation (deterministic format)", () => {
    const context = buildExternalReturnContext(
      {
        itemId: SURFACE_ITEMS[0]!.id,
        connectorId: "r09-test-source",
        externalRef: "r09:test-item",
        positionMs: 42_000,
      },
      NOW,
    );
    expect(describeExternalReturnContext(context)).toBe(
      `Return context kept: ${SURFACE_ITEMS[0]!.id} at 42000ms (handed off ${NOW}) — WebFlix keeps your place`,
    );
  });

  it("the seed is present ONLY when the external rung wins", () => {
    expect(answer().externalReturn).toBeNull();
    const external = answer({ realizations: [realizationOf("external")] });
    expect(external.externalReturn?.externalRef).toBe("r09:test-item");
  });
});

// ---------------------------------------------------------------------------
// The trace parser (the consistency law)
// ---------------------------------------------------------------------------

describe("R09 — parsePrecedenceTrace (the frozen formats)", () => {
  it("parses the frozen resolver's lines into per-rung verdicts with reasons verbatim", () => {
    const a = answer();
    const parsed = parsePrecedenceTrace(
      (a.resolution.ok ? a.resolution.precedenceTrace : []).map((line) => line),
    );
    expect(parsed).toHaveLength(4);
    expect(parsed.map((entry) => entry.rung)).toEqual([
      "native",
      "embed",
      "browser",
      "external",
    ]);
    for (const entry of parsed) {
      expect(entry.reason).toContain(`${entry.rung}: `);
    }
  });

  it("an out-of-sync trace (wrong format / missing rung) throws the typed error", () => {
    expect(() => parsePrecedenceTrace(["native: accepted — x", "embed: skipped — y"])).toThrow(
      ExperienceError,
    );
    expect(() =>
      parsePrecedenceTrace([
        "native: accepted — x",
        "garbage line",
        "browser: skipped — y",
        "external: skipped — z",
      ]),
    ).toThrow(ExperienceError);
    expect(() => parsePrecedenceTrace([])).toThrow(ExperienceError);
  });
});
