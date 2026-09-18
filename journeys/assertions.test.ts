/**
 * @wfx/journeys — unit tests: the assertion vocabulary (R16).
 *
 * The established discipline: pure logic, deterministic, no browser.
 * The journal's pass/fail semantics ARE the honesty law — these tests
 * prove a recorded failure throws (a journey cannot pass on a failed
 * assertion) and that records serialize exactly.
 */

import { describe, expect, it } from "bun:test";

import { AssertionError, bindAssertions, createJournal, type PageReader } from "./lib/assertions";

/** A fake page reader over a fixed DOM map. */
function readerOf(
  dom: {
    texts?: Record<string, string>;
    htmls?: Record<string, string>;
    attrs?: Record<string, Record<string, string>>;
    counts?: Record<string, number>;
  },
): PageReader {
  return {
    tryText: async (selector) => dom.texts?.[selector] ?? null,
    tryHtml: async (selector) => dom.htmls?.[selector] ?? null,
    tryAttr: async (selector, attribute) => dom.attrs?.[selector]?.[attribute] ?? null,
    count: async (selector) => dom.counts?.[selector] ?? 0,
  };
}

describe("journeys/lib/assertions", () => {
  it("a passing assertion records and does not throw", () => {
    const journal = createJournal();
    const assert = bindAssertions(journal, readerOf({ texts: { "[data-wfx-mode-badge]": "dev fixtures" } }));
    assert.that("badge", "dev fixtures", "dev fixtures", true);
    expect(journal.records()).toHaveLength(1);
    expect(journal.records()[0]?.pass).toBe(true);
  });

  it("a FAILED assertion throws the typed AssertionError (fail-fast journey semantics — no theater)", () => {
    const journal = createJournal();
    const assert = bindAssertions(journal, readerOf({}));
    expect(() => assert.that("badge", "dev fixtures", "live service", false)).toThrow(AssertionError);
    const record = journal.records()[0];
    expect(record?.pass).toBe(false);
    expect(record?.expected).toBe("dev fixtures");
    expect(record?.observed).toBe("live service");
  });

  it("visible passes only when the selector matches at least one element", async () => {
    const present = createJournal();
    await bindAssertions(present, readerOf({ counts: { "[data-wfx-hero]": 1 } })).visible("[data-wfx-hero]", "hero");
    expect(present.records()[0]?.pass).toBe(true);

    const absent = createJournal();
    await expect(
      bindAssertions(absent, readerOf({ counts: { "[data-wfx-hero]": 0 } })).visible("[data-wfx-hero]", "hero"),
    ).rejects.toThrow(AssertionError);
  });

  it("absent passes only when the selector matches nothing (honest absence)", async () => {
    const journal = createJournal();
    await bindAssertions(journal, readerOf({ counts: { "[data-wfx-row='continue']": 0 } })).absent(
      "[data-wfx-row='continue']",
      "continue row honest absence",
    );
    expect(journal.records()[0]?.pass).toBe(true);
  });

  it("textContains binds to the observed fragment; a null element fails with the absent marker", async () => {
    const journal = createJournal();
    const assert = bindAssertions(journal, readerOf({ texts: { "[data-wfx-player-phase]": "Playback phase: buffering" } }));
    await assert.textContains("[data-wfx-player-phase]", "buffering", "phase truth");
    expect(journal.records()[0]?.pass).toBe(true);

    const missing = createJournal();
    await expect(
      bindAssertions(missing, readerOf({})).textContains("[data-wfx-player-phase]", "buffering", "phase truth"),
    ).rejects.toThrow(AssertionError);
    expect(missing.records()[0]?.observed).toBe("<element absent>");
  });

  it("attrEquals compares exactly (the state grammar binds to exact values)", async () => {
    const journal = createJournal();
    const assert = bindAssertions(
      journal,
      readerOf({ attrs: { "[data-wfx-acquisition]": { "data-wfx-acquisition-state": "ready-offline" } } }),
    );
    await assert.attrEquals("[data-wfx-acquisition]", "data-wfx-acquisition-state", "ready-offline", "earned verdict");
    expect(journal.records()[0]?.pass).toBe(true);

    const wrong = createJournal();
    await expect(
      bindAssertions(
        wrong,
        readerOf({ attrs: { "[data-wfx-acquisition]": { "data-wfx-acquisition-state": "completing" } } }),
      ).attrEquals("[data-wfx-acquisition]", "data-wfx-acquisition-state", "ready-offline", "earned verdict"),
    ).rejects.toThrow(AssertionError);
  });

  it("countExactly and countAtLeast bind numeric truths", async () => {
    const journal = createJournal();
    const assert = bindAssertions(journal, readerOf({ counts: { "nav a": 6, "a[data-wfx-card]": 5 } }));
    await assert.countExactly("nav a", 6, "nav completeness");
    await assert.countAtLeast("a[data-wfx-card]", 4, "cards present");
    expect(journal.records()).toHaveLength(2);
    expect(journal.records().every((record) => record.pass)).toBe(true);
  });

  it("htmlOmits is the anti-theater check (fabrication detection)", async () => {
    const clean = createJournal();
    await bindAssertions(clean, readerOf({ htmls: { "[data-wfx-acquisition]": "<p>Available</p>" } })).htmlOmits(
      "[data-wfx-acquisition]",
      "fake-source",
      "no source branding",
    );
    expect(clean.records()[0]?.pass).toBe(true);

    const dirty = createJournal();
    await expect(
      bindAssertions(dirty, readerOf({ htmls: { "[data-wfx-acquisition]": "<p>fake-source</p>" } })).htmlOmits(
        "[data-wfx-acquisition]",
        "fake-source",
        "no source branding",
      ),
    ).rejects.toThrow(AssertionError);
  });
});
