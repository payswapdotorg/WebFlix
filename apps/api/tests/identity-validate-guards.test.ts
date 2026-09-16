/**
 * WFX-055A identity / body-parser / transport-guard tests (bun:test).
 *
 * Three pure layers of the service's typed garbage channel:
 *
 * 1. `readConnectorContext` — the header law (identity travels as headers,
 *    never in URLs): required `x-wfx-user-id`, optional session/locale/
 *    region validated when present, honest defaults.
 * 2. `parseUserAction` / `parseLibraryCommand` — the POST body parsers:
 *    garbage tables + the one-answer-names-every-problem law.
 * 3. `host/contract-guards.ts` — the MIRRORS of the frozen web client's
 *    private payload guards (`apps/web/src/host/remote-ports.ts`:
 *    `isUsableRemoteSearchResult` / `isUsableRemoteSourceItem` /
 *    `isUsableRemoteLibraryEntry` / its `validatePlaybackRealization`
 *    filter). The client silently DROPS anything failing these shapes, so
 *    the service filters through the same shapes before answering. The
 *    mirrors were verified FIELD-BY-FIELD against the frozen source (same
 *    field order, same rules — see the slice-3 report); these tests pin
 *    the mirrored BEHAVIOR with positive+negative tables so neither side
 *    can drift unnoticed.
 *
 * Determinism: pure functions, no clock, no environment, no network.
 */

import { describe, expect, it } from "bun:test";

import {
  isUsableLibraryEntry,
  isUsableRealization,
  isUsableSearchResult,
  isUsableSourceItem,
} from "../src/host/contract-guards";
import {
  DEFAULT_LOCALE,
  readConnectorContext,
  REGION_HEADER,
  SESSION_ID_HEADER,
  USER_ID_HEADER,
} from "../src/host/identity";
import { parseLibraryCommand, parseUserAction } from "../src/host/validate";

// ---------------------------------------------------------------------------
// readConnectorContext — the header law
// ---------------------------------------------------------------------------

describe("readConnectorContext — the identity header law", () => {
  it("reads the full context: user, session, locale, region", () => {
    const result = readConnectorContext(
      new Headers({
        [USER_ID_HEADER]: "wfx-user-1",
        [SESSION_ID_HEADER]: "wfxpses_00000000000000000000000001",
        "x-wfx-locale": "en-US",
        "x-wfx-region": "US",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe("wfx-user-1");
      expect(result.ctx.locale).toBe("en-US");
      expect(result.ctx.region).toBe("US");
      // The ConnectorContext carries identity for connector calls; the
      // session is read separately by the events route.
      expect("sessionId" in result.ctx).toBe(false);
    }
  });

  it("defaults: locale en, no region, when only the required header is present", () => {
    const result = readConnectorContext(new Headers({ [USER_ID_HEADER]: "wfx-user-1" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.locale).toBe(DEFAULT_LOCALE);
      expect(DEFAULT_LOCALE).toBe("en");
      expect("region" in result.ctx).toBe(false);
    }
  });

  it("trims surrounding whitespace off the tokens it accepts", () => {
    const result = readConnectorContext(
      new Headers({
        [USER_ID_HEADER]: "  wfx-user-1  ",
        "x-wfx-locale": " en-US ",
        "x-wfx-region": " US ",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe("wfx-user-1");
      expect(result.ctx.locale).toBe("en-US");
      expect(result.ctx.region).toBe("US");
    }
  });

  it("absent x-wfx-user-id is a typed 400 detail naming the header", () => {
    const result = readConnectorContext(new Headers({ "x-wfx-locale": "en" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("x-wfx-user-id");
      expect(result.detail).toContain("absent");
    }
  });

  it("garbage x-wfx-user-id values are refused (whitespace-only / too long / control chars)", () => {
    // NOTE (lead adjudication, slice 3): the historical "bad\nid" case was
    // REMOVED — Bun's Headers constructor THROWS on newline-containing values
    // (lead-verified: `new Headers({ "x-wfx-user-id": "bad\nid" })` →
    // TypeError), and no real HTTP request can deliver a newline inside a
    // header value, so that input is unreachable in production. The control-
    // char law stays pinned by "bad\u0007id" below (BEL is a legal header
    // byte — the guard must refuse it).
    const garbage = ["   ", "x".repeat(129), "bad\u0007id"];
    for (const value of garbage) {
      const result = readConnectorContext(new Headers({ [USER_ID_HEADER]: value }));
      expect(result.ok, `user-id garbage: ${JSON.stringify(value)}`).toBe(false);
      if (!result.ok) {
        expect(result.detail).toContain("x-wfx-user-id");
      }
    }
  });

  it("an optional session header is validated when present", () => {
    const ok = readConnectorContext(
      new Headers({ [USER_ID_HEADER]: "u", [SESSION_ID_HEADER]: "  sess-1  " }),
    );
    expect(ok.ok).toBe(true);

    for (const value of ["   ", "s".repeat(129), "sess\u0001"]) {
      const result = readConnectorContext(
        new Headers({ [USER_ID_HEADER]: "u", [SESSION_ID_HEADER]: value }),
      );
      expect(result.ok, `session garbage: ${JSON.stringify(value)}`).toBe(false);
      if (!result.ok) {
        expect(result.detail).toContain("x-wfx-session-id");
      }
    }
  });

  it("locale is validated when present — tag shape, bounded length", () => {
    for (const good of ["en", "en-US", "zh-Hans", "US", "419", "es-419"]) {
      const result = readConnectorContext(
        new Headers({ [USER_ID_HEADER]: "u", "x-wfx-locale": good }),
      );
      expect(result.ok, `locale good: ${good}`).toBe(true);
    }
    for (const bad of ["en US", "en--US", "-en", "en-", "!!!", "x".repeat(36), ""]) {
      const result = readConnectorContext(
        new Headers({ [USER_ID_HEADER]: "u", "x-wfx-locale": bad }),
      );
      expect(result.ok, `locale bad: ${JSON.stringify(bad)}`).toBe(false);
      if (!result.ok) {
        expect(result.detail).toContain("x-wfx-locale");
      }
    }
  });

  it("region is validated when present — the same tag law", () => {
    const ok = readConnectorContext(new Headers({ [USER_ID_HEADER]: "u", [REGION_HEADER]: "DE" }));
    expect(ok.ok).toBe(true);

    for (const bad of ["U S", "!!", "x".repeat(36)]) {
      const result = readConnectorContext(
        new Headers({ [USER_ID_HEADER]: "u", [REGION_HEADER]: bad }),
      );
      expect(result.ok, `region bad: ${JSON.stringify(bad)}`).toBe(false);
      if (!result.ok) {
        expect(result.detail).toContain("x-wfx-region");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// parseUserAction / parseLibraryCommand — the POST body garbage tables
// ---------------------------------------------------------------------------

describe("parseUserAction — the UserAction body law", () => {
  it("parses a complete action (type, connectorId, externalRef, payload)", () => {
    const result = parseUserAction({
      type: "like",
      connectorId: "wfx-experience-service",
      externalRef: "5SRgdyUsuAg",
      payload: { via: "test" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        type: "like",
        connectorId: "wfx-experience-service",
        externalRef: "5SRgdyUsuAg",
        payload: { via: "test" },
      });
    }
  });

  it("payload is optional — a minimal action parses without one", () => {
    const result = parseUserAction({
      type: "save",
      connectorId: "wfx-experience-service",
      externalRef: "x",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        type: "save",
        connectorId: "wfx-experience-service",
        externalRef: "x",
      });
    }
  });

  it("non-objects are refused outright", () => {
    for (const garbage of ["like", 42, null, true, ["like"]]) {
      const result = parseUserAction(garbage);
      expect(result.ok, `garbage: ${JSON.stringify(garbage)}`).toBe(false);
      if (!result.ok) {
        expect(result.problems[0]).toContain("UserAction");
      }
    }
  });

  it("the garbage table: every field's failure mode names that field", () => {
    const table: readonly [unknown, string][] = [
      [{ connectorId: "c", externalRef: "r" }, "action.type"],
      [{ type: "subscribe", connectorId: "c", externalRef: "r" }, "action.type"],
      [{ type: "like", externalRef: "r" }, "action.connectorId"],
      [{ type: "like", connectorId: "  ", externalRef: "r" }, "action.connectorId"],
      [{ type: "like", connectorId: "c" }, "action.externalRef"],
      [{ type: "like", connectorId: "c", externalRef: "\t" }, "action.externalRef"],
      [{ type: "like", connectorId: "c", externalRef: "r", payload: "text" }, "action.payload"],
    ];
    for (const [input, field] of table) {
      const result = parseUserAction(input);
      expect(result.ok, `input: ${JSON.stringify(input)}`).toBe(false);
      if (!result.ok) {
        expect(result.problems.join("; ")).toContain(field);
      }
    }
  });

  it("over-length values are refused (garbage stays bounded)", () => {
    const tooLongConnector = parseUserAction({
      type: "like",
      connectorId: "c".repeat(129),
      externalRef: "r",
    });
    expect(tooLongConnector.ok).toBe(false);
    if (!tooLongConnector.ok) {
      expect(tooLongConnector.problems.join("; ")).toContain("connectorId");
    }
    const tooLongRef = parseUserAction({
      type: "like",
      connectorId: "c",
      externalRef: "r".repeat(513),
    });
    expect(tooLongRef.ok).toBe(false);
    if (!tooLongRef.ok) {
      expect(tooLongRef.problems.join("; ")).toContain("externalRef");
    }
  });

  it("ONE answer names EVERY problem (the 052 one-round law)", () => {
    const result = parseUserAction({ type: "subscribe" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.length).toBeGreaterThanOrEqual(3);
      expect(result.problems.join("; ")).toContain("action.type");
      expect(result.problems.join("; ")).toContain("action.connectorId");
      expect(result.problems.join("; ")).toContain("action.externalRef");
    }
  });
});

describe("parseLibraryCommand — the LibraryCommand body law", () => {
  it("parses a complete command (op, externalRef, title, metadata)", () => {
    const result = parseLibraryCommand({
      op: "add",
      externalRef: "5SRgdyUsuAg",
      title: "A Seeded Title",
      metadata: { via: "test" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        op: "add",
        externalRef: "5SRgdyUsuAg",
        title: "A Seeded Title",
        metadata: { via: "test" },
      });
    }
  });

  it("title and metadata are optional — a minimal remove parses", () => {
    const result = parseLibraryCommand({ op: "remove", externalRef: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ op: "remove", externalRef: "x" });
    }
  });

  it("non-objects are refused outright", () => {
    for (const garbage of ["add", 7, null, true, ["add"]]) {
      const result = parseLibraryCommand(garbage);
      expect(result.ok, `garbage: ${JSON.stringify(garbage)}`).toBe(false);
      if (!result.ok) {
        expect(result.problems[0]).toContain("LibraryCommand");
      }
    }
  });

  it("the garbage table: every field's failure mode names that field", () => {
    const table: readonly [unknown, string][] = [
      [{}, "command.op"],
      [{ op: "rename", externalRef: "r" }, "command.op"],
      [{ op: "add" }, "command.externalRef"],
      [{ op: "add", externalRef: "  " }, "command.externalRef"],
      [{ op: "add", externalRef: "r", title: 5 }, "command.title"],
      [{ op: "add", externalRef: "r", title: "t".repeat(513) }, "command.title"],
      [{ op: "add", externalRef: "r", metadata: "text" }, "command.metadata"],
      [{ op: "add", externalRef: "r", metadata: ["x"] }, "command.metadata"],
    ];
    for (const [input, field] of table) {
      const result = parseLibraryCommand(input);
      expect(result.ok, `input: ${JSON.stringify(input)}`).toBe(false);
      if (!result.ok) {
        expect(result.problems.join("; ")).toContain(field);
      }
    }
  });

  it("ONE answer names EVERY problem", () => {
    const result = parseLibraryCommand({ op: "rename" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.length).toBeGreaterThanOrEqual(2);
      expect(result.problems.join("; ")).toContain("command.op");
      expect(result.problems.join("; ")).toContain("command.externalRef");
    }
  });
});

// ---------------------------------------------------------------------------
// contract-guards — the frozen client's payload guards, mirrored
// ---------------------------------------------------------------------------

/** A search result / source item that passes every mirror guard. */
const GOOD_BASE = {
  connectorId: "wfx-experience-service",
  externalRef: "5SRgdyUsuAg",
  title: "A Real Seeded Title",
};

describe("isUsableSearchResult — mirror of the client's isUsableRemoteSearchResult", () => {
  it("accepts the full shape", () => {
    expect(
      isUsableSearchResult({
        ...GOOD_BASE,
        canonicalType: "video",
        durationMs: 600_000,
        orientation: "horizontal",
      }),
    ).toBe(true);
  });

  it("accepts the minimal shape (optional fields absent)", () => {
    expect(isUsableSearchResult({ ...GOOD_BASE })).toBe(true);
  });

  it("rejects each field's failure mode (the client would DROP the hit)", () => {
    const negatives: unknown[] = [
      "a string",
      42,
      null,
      ["array"],
      { ...GOOD_BASE, connectorId: undefined },
      { ...GOOD_BASE, connectorId: "   " },
      { ...GOOD_BASE, externalRef: "" },
      { ...GOOD_BASE, title: 5 },
      { ...GOOD_BASE, canonicalType: 5 },
      { ...GOOD_BASE, durationMs: -1 },
      { ...GOOD_BASE, durationMs: Number.NaN },
      { ...GOOD_BASE, durationMs: Number.POSITIVE_INFINITY },
      { ...GOOD_BASE, orientation: 7 },
    ];
    for (const value of negatives) {
      expect(isUsableSearchResult(value), `negative: ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

describe("isUsableSourceItem — mirror of the client's isUsableRemoteSourceItem", () => {
  it("accepts the full shape (availability + capabilities included)", () => {
    expect(
      isUsableSourceItem({
        ...GOOD_BASE,
        canonicalType: "video",
        durationMs: 600_000,
        orientation: "horizontal",
        availability: "available",
        capabilities: ["playEmbed", "playExternal", "like", "save"],
      }),
    ).toBe(true);
  });

  it("accepts the three availability values the contract allows", () => {
    for (const availability of ["available", "unknown", "unavailable"]) {
      expect(
        isUsableSourceItem({ ...GOOD_BASE, availability, capabilities: [] }),
        `availability: ${availability}`,
      ).toBe(true);
    }
  });

  it("rejects bad availability and bad capabilities", () => {
    const negatives: unknown[] = [
      { ...GOOD_BASE, availability: "sometimes", capabilities: [] },
      { ...GOOD_BASE, availability: "available", capabilities: "playEmbed" },
      { ...GOOD_BASE, availability: "available", capabilities: [5] },
      { ...GOOD_BASE, availability: "available" }, // capabilities missing
      { ...GOOD_BASE, availability: "available", capabilities: [], externalRef: "  " },
    ];
    for (const value of negatives) {
      expect(isUsableSourceItem(value), `negative: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("accepts a whitespace-only title — the frozen client only requires a string (mirror faithfulness)", () => {
    // Documenting positive (lead adjudication, slice 3): the FROZEN client's
    // guard at apps/web/src/host/remote-ports.ts:227 is exactly
    // `typeof value.title !== "string"` — it does NOT trim, so a
    // whitespace-only (or empty) title is USABLE client-side and would be
    // rendered as-is. The mirror deliberately keeps only the string law;
    // an over-strict `title.trim()` here would silently DROP rows the
    // frozen client keeps — no row should ever vanish between the service
    // and the client on a title technicality.
    expect(isUsableSourceItem({ ...GOOD_BASE, availability: "available", capabilities: [], title: "  " })).toBe(true);
    expect(isUsableSourceItem({ ...GOOD_BASE, availability: "available", capabilities: [], title: "" })).toBe(true);
  });
});

describe("isUsableLibraryEntry — mirror of the client's isUsableRemoteLibraryEntry", () => {
  it("accepts entries with and without addedAt", () => {
    expect(isUsableLibraryEntry({ ...GOOD_BASE })).toBe(true);
    expect(isUsableLibraryEntry({ ...GOOD_BASE, addedAt: "2026-09-16T00:00:00.000Z" })).toBe(true);
  });

  it("rejects non-ISO addedAt and non-string titles", () => {
    const negatives: unknown[] = [
      { ...GOOD_BASE, addedAt: "yesterday" },
      { ...GOOD_BASE, addedAt: 5 },
      { ...GOOD_BASE, addedAt: "2026-09-16T00:00:00" }, // no offset — not full ISO 8601
      { connectorId: "wfx-experience-service", externalRef: "x" }, // no title
      { ...GOOD_BASE, title: 5 }, // title must be a string when present
      "string",
      null,
    ];
    for (const value of negatives) {
      expect(isUsableLibraryEntry(value), `negative: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("accepts a whitespace-only title — the frozen client only requires a string (mirror faithfulness)", () => {
    // Documenting positive (lead adjudication, slice 3): the FROZEN client's
    // guard at apps/web/src/host/remote-ports.ts:249 is exactly
    // `typeof value.title !== "string"` — no trim, no emptiness check. The
    // mirror keeps the same law so a library row the client would keep is
    // never dropped at the service boundary on a title technicality.
    expect(isUsableLibraryEntry({ ...GOOD_BASE, title: "  " })).toBe(true);
    expect(isUsableLibraryEntry({ ...GOOD_BASE, title: "" })).toBe(true);
  });
});

describe("isUsableRealization — mirror of the client's validatePlaybackRealization filter", () => {
  it("accepts a full realization and the minimal {mode, connectorId, capabilities} shape", () => {
    expect(
      isUsableRealization({
        mode: "embed",
        connectorId: "wfx-experience-service",
        url: "https://www.youtube.com/embed/5SRgdyUsuAg",
        externalRef: "5SRgdyUsuAg",
        capabilities: ["playEmbed"],
      }),
    ).toBe(true);
    expect(
      isUsableRealization({ mode: "external", connectorId: "c", capabilities: ["playExternal"] }),
    ).toBe(true);
  });

  it("rejects each field's failure mode (the client would DROP the candidate)", () => {
    const negatives: unknown[] = [
      "string",
      null,
      { connectorId: "c", url: "https://x", capabilities: [] }, // no mode
      { mode: "vr", connectorId: "c", capabilities: [] }, // not a frozen PlaybackMode
      { mode: "embed", capabilities: [] }, // no connectorId
      { mode: "embed", connectorId: "c", url: "", capabilities: [] }, // empty url
      { mode: "embed", connectorId: "c", url: 5, capabilities: [] },
      { mode: "embed", connectorId: "c", externalRef: "", capabilities: [] },
      { mode: "embed", connectorId: "c", expiresAt: "soon", capabilities: [] },
      { mode: "embed", connectorId: "c", capabilities: "playEmbed" },
      { mode: "embed", connectorId: "c", capabilities: [7] },
    ];
    for (const value of negatives) {
      expect(isUsableRealization(value), `negative: ${JSON.stringify(value)}`).toBe(false);
    }
  });
});
