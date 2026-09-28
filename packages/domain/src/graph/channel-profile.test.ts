/**
 * R38-B — THE CHANNEL-PROFILE EDIT SEAM LANE TESTS (the additive
 * domain-graph seam — packages/domain/src/graph/channel-profile.ts).
 *
 * Proves the seam's laws (the plan's §5, evidence/r38b/plan.md):
 *
 * - THE CLOSED VOCABULARY: the customizable field set is exactly
 *   banner/avatar/handle/description (the survey's row 30 set — never a
 *   second identity field);
 * - THE HANDLE GRAMMAR: a creator-chosen handle follows the SAME slug
 *   grammar the channel route derives (lowercase, single inner hyphens,
 *   no edge hyphens, 1–64 chars) — routable, never a fabricated "@name";
 * - THE ARTWORK URL GUARD: http(s) only, bounded length;
 * - THE VALIDATING CONSTRUCTOR: every malformed input throws the typed
 *   GraphError with FIELD-LEVEL details (never a silent coercion);
 *   whitespace-only strings normalize to null ("cleared", not invalid);
 * - THE COMPOSE LAW: the base verbatim when no edit / a foreign
 *   channel's edit; each declared field wins field-by-field; the
 *   customized-fields set is exactly what the edit declares.
 */

import { describe, expect, it } from "bun:test";

import {
  CHANNEL_PROFILE_FIELDS,
  CHANNEL_PROFILE_HANDLE_MAX_LENGTH,
  type ChannelProfileEdit,
  channelProfileEditOf,
  composeChannelProfile,
  isChannelProfileArtworkUrl,
  isChannelProfileHandle,
  parseChannelProfileEdit,
} from "./channel-profile";
import { GraphError } from "./model";

const T0 = "2026-09-28T12:00:00.000Z";

/** Runs fn expecting a GraphError; asserts kind and returns its details joined. */
function expectGraphErrorDetails(fn: () => void): string {
  try {
    fn();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(GraphError);
    const error = thrown as GraphError;
    expect(error.kind).toBe("invalid-input");
    expect(error.details.length).toBeGreaterThan(0);
    return error.details.join("; ");
  }
  throw new Error("expected a GraphError that never threw");
}

describe("R38-B channel-profile seam — the closed vocabulary", () => {
  it("carries exactly the survey's customization field set", () => {
    expect([...CHANNEL_PROFILE_FIELDS].sort()).toEqual([
      "avatar",
      "banner",
      "description",
      "handle",
    ]);
  });
});

describe("R38-B channel-profile seam — the handle grammar", () => {
  it("accepts the slug grammar the channel route derives", () => {
    expect(isChannelProfileHandle("studio-made")).toBe(true);
    expect(isChannelProfileHandle("a")).toBe(true);
    expect(isChannelProfileHandle("rain-check-2")).toBe(true);
  });

  it("refuses fabricated @name forms and malformed slugs", () => {
    expect(isChannelProfileHandle("@StudioMade")).toBe(false);
    expect(isChannelProfileHandle("Studio Made")).toBe(false);
    expect(isChannelProfileHandle("-studio")).toBe(false);
    expect(isChannelProfileHandle("studio-")).toBe(false);
    expect(isChannelProfileHandle("studio--made")).toBe(false);
    expect(isChannelProfileHandle("")).toBe(false);
    expect(isChannelProfileHandle("a".repeat(CHANNEL_PROFILE_HANDLE_MAX_LENGTH + 1))).toBe(false);
    expect(isChannelProfileHandle(42)).toBe(false);
  });
});

describe("R38-B channel-profile seam — the artwork URL guard", () => {
  it("accepts http(s) URLs and refuses everything else", () => {
    expect(isChannelProfileArtworkUrl("https://example.com/banner.png")).toBe(true);
    expect(isChannelProfileArtworkUrl("http://localhost:8080/a.jpg")).toBe(true);
    expect(isChannelProfileArtworkUrl("javascript:alert(1)")).toBe(false);
    expect(isChannelProfileArtworkUrl("ftp://example.com/a.jpg")).toBe(false);
    expect(isChannelProfileArtworkUrl("not a url")).toBe(false);
    expect(isChannelProfileArtworkUrl("")).toBe(false);
  });
});

describe("R38-B channel-profile seam — the validating constructor", () => {
  it("builds the record from declared fields (nulls kept as not-customized)", () => {
    const edit = channelProfileEditOf({
      connectorId: "fake-source",
      handle: "studio-made",
      description: "The creator's own declared description.",
      bannerUrl: null,
      avatarUrl: undefined,
      editedAt: T0,
    });
    expect(edit).toEqual({
      connectorId: "fake-source",
      handle: "studio-made",
      description: "The creator's own declared description.",
      bannerUrl: null,
      avatarUrl: null,
      editedAt: T0,
    } satisfies ChannelProfileEdit);
  });

  it("normalizes whitespace-only strings to null (cleared, not invalid)", () => {
    const edit = channelProfileEditOf({
      connectorId: "fake-source",
      handle: "   ",
      description: "\t\n",
      editedAt: T0,
    });
    expect(edit.handle).toBeNull();
    expect(edit.description).toBeNull();
  });

  it("throws the typed GraphError with field-level details on every malformed field", () => {
    const details = expectGraphErrorDetails(() =>
      channelProfileEditOf({
        connectorId: "  ",
        handle: "@Bad Handle",
        description: 7,
        bannerUrl: "javascript:alert(1)",
        avatarUrl: "not a url",
        editedAt: "yesterday",
      }),
    );
    expect(details).toContain("connectorId");
    expect(details).toContain("handle");
    expect(details).toContain("description");
    expect(details).toContain("bannerUrl");
    expect(details).toContain("avatarUrl");
    expect(details).toContain("editedAt");
  });

  it("refuses non-object input", () => {
    expectGraphErrorDetails(() => channelProfileEditOf("nope"));
    expectGraphErrorDetails(() => channelProfileEditOf(null));
  });

  it("round-trips a valid record through parseChannelProfileEdit; corrupt input answers null", () => {
    const edit = channelProfileEditOf({
      connectorId: "fake-source",
      handle: "studio-made",
      editedAt: T0,
    });
    expect(parseChannelProfileEdit(JSON.parse(JSON.stringify(edit)))).toEqual(edit);
    expect(parseChannelProfileEdit({ connectorId: "", editedAt: "nope" })).toBeNull();
    expect(parseChannelProfileEdit("corrupt")).toBeNull();
  });
});

describe("R38-B channel-profile seam — the compose law", () => {
  const base = {
    connectorId: "fake-source",
    handle: "fake-source",
    description: "This source declares no channel description — WebFlix does not write one for it.",
  };

  it("answers the base verbatim when no edit exists", () => {
    const composed = composeChannelProfile(base, null);
    expect(composed.handle).toBe("fake-source");
    expect(composed.description).toBe(base.description);
    expect(composed.bannerUrl).toBeNull();
    expect(composed.avatarUrl).toBeNull();
    expect(composed.customizedFields).toEqual([]);
    expect(composed.editedAt).toBeNull();
  });

  it("answers the base verbatim for a DIFFERENT channel's edit (never a cross-channel overlay)", () => {
    const foreign = channelProfileEditOf({
      connectorId: "another-source",
      handle: "not-yours",
      editedAt: T0,
    });
    const composed = composeChannelProfile(base, foreign);
    expect(composed.handle).toBe("fake-source");
    expect(composed.customizedFields).toEqual([]);
  });

  it("overlays each declared field; undeclared fields keep the base truth", () => {
    const edit = channelProfileEditOf({
      connectorId: "fake-source",
      handle: "studio-made",
      description: "The customized truth.",
      bannerUrl: "https://example.com/banner.png",
      avatarUrl: null,
      editedAt: T0,
    });
    const composed = composeChannelProfile(base, edit);
    expect(composed.handle).toBe("studio-made");
    expect(composed.description).toBe("The customized truth.");
    expect(composed.bannerUrl).toBe("https://example.com/banner.png");
    expect(composed.avatarUrl).toBeNull();
    expect(composed.customizedFields).toEqual(["handle", "description", "banner"]);
    expect(composed.editedAt).toBe(T0);
  });

  it("reports the full customized set when every field is declared", () => {
    const edit = channelProfileEditOf({
      connectorId: "fake-source",
      handle: "studio-made",
      description: "Everything.",
      bannerUrl: "https://example.com/b.png",
      avatarUrl: "https://example.com/a.png",
      editedAt: T0,
    });
    expect(composeChannelProfile(base, edit).customizedFields).toEqual([
      "handle",
      "description",
      "banner",
      "avatar",
    ]);
  });
});
