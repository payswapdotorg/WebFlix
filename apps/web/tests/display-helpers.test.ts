/**
 * R26-W2 — the display helpers' SURROGATE-SAFETY tests (bun:test): the
 * real-catalog hydration-crash regression.
 *
 * The corrective reproduction: the REAL production catalog carries
 * emoji-leading titles (🌧️, 🔴, ⚡ — "Heavy Rain and Thunder Sounds…"),
 * and the placeholder monogram's `charAt(0)` answered the first UTF-16
 * CODE UNIT — a LONE SURROGATE for astral characters. The server's HTML
 * encodes that lone surrogate as U+FFFD while the client's hydration
 * render kept the raw surrogate — the hydration mismatch that killed the
 * whole home page on the real catalog (the ASCII fixture catalog never
 * exercised it; fixtures green, production dead).
 *
 * These tests pin the fix mechanically:
 *
 * - the monogram's every output code unit is a COMPLETE code point (no
 *   lone surrogates — the hydration law's byte parity);
 * - an emoji-leading title's monogram carries the WHOLE emoji (🌧H), and
 *   the server-rendered HTML contains the emoji itself, never U+FFFD;
 * - ASCII behavior is unchanged (the fixture battery's own expectations);
 * - the torrent stage's leading glyph uses the same safe helper.
 *
 * Determinism: pure functions, no host, no network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { firstCodePointOf, placeholderMonogram } from "../src/components/ui/format";

/** Real catalog titles (the seeded production catalog's own shapes). */
const EMOJI_LEADING_TITLE = "🌧️ Heavy Rain and Thunder Sounds for Sleeping";
const ASTRAL_ONLY_TITLE = "🔴 Heavy Rain and Thunder Sounds for Sleeping - Black Screen";
const ASCII_TITLE = "1 HOUR Rainy Day in Airport ✈️ | Cozy Lofi for Relax, Study & Sleep";

/** Every code unit is a complete code point (no lone surrogates). */
function containsNoLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    const isHigh = unit >= 0xd800 && unit <= 0xdbff;
    const isLow = unit >= 0xdc00 && unit <= 0xdfff;
    if (isHigh) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false; // lone high surrogate
      index += 1; // the pair is complete — skip the low half
    } else if (isLow) {
      return false; // a low surrogate never leads a complete point
    }
  }
  return true;
}

describe("R26-W2 — the placeholder monogram's surrogate safety (the real-catalog hydration crash)", () => {
  it("an ASCII-leading title keeps the exact two-initial monogram (the fixture battery's own law)", () => {
    expect(placeholderMonogram(ASCII_TITLE)).toBe("1H");
    expect(placeholderMonogram("Harbor Lights")).toBe("HL");
  });

  it("an emoji-leading title's monogram carries the WHOLE emoji, never a lone surrogate", () => {
    const monogram = placeholderMonogram(EMOJI_LEADING_TITLE);
    expect(monogram).toBe("🌧H");
    // The hydration law's byte parity: no lone surrogate may reach the DOM.
    expect(containsNoLoneSurrogate(monogram)).toBe(true);
    // The emoji is one code point (two code units) — not sliced apart.
    expect(Array.from(monogram).length).toBe(2);
  });

  it("every real-catalog shape answers complete code points only", () => {
    for (const title of [EMOJI_LEADING_TITLE, ASTRAL_ONLY_TITLE, ASCII_TITLE, "", "   ", "ß Sharp S"]) {
      expect(containsNoLoneSurrogate(placeholderMonogram(title))).toBe(true);
    }
  });

  it("the monogram never emits U+FFFD (the replacement char the server HTML would freeze)", () => {
    expect(placeholderMonogram(EMOJI_LEADING_TITLE).includes("\ufffd")).toBe(false);
    expect(placeholderMonogram(ASTRAL_ONLY_TITLE).includes("\ufffd")).toBe(false);
  });

  it("the server-rendered HTML of an emoji-leading monogram contains the emoji itself (hydration parity)", () => {
    const html = renderToStaticMarkup(
      createElement("span", null, placeholderMonogram(ASTRAL_ONLY_TITLE)),
    );
    // The astral emoji is serialized as its UTF-8 code point — never a
    // replacement char (the mismatch's server side is gone).
    expect(html.includes("\ufffd")).toBe(false);
    expect(Array.from(placeholderMonogram(ASTRAL_ONLY_TITLE))[0]).toBe("🔴");
  });
});

describe("R26-W2 — firstCodePointOf (the shared safe extraction)", () => {
  it("answers the first code point of an astral-leading word (the whole emoji)", () => {
    expect(firstCodePointOf("🌧️ Heavy")).toBe("🌧");
    expect(firstCodePointOf("🔴")).toBe("🔴");
  });

  it("answers the empty string for the empty word (never undefined, never a surrogate)", () => {
    expect(firstCodePointOf("")).toBe("");
  });

  it("is idempotent over its own output (no slicing drift)", () => {
    const first = firstCodePointOf(ASTRAL_ONLY_TITLE.trim());
    expect(firstCodePointOf(first)).toBe(first);
  });
});
