/**
 * R38-B — THE STUDIO PROFILE STORE LANE TESTS (the customization
 * writes through the domain-graph seam).
 *
 * Proves the CUSTOMIZATION LAW (the task packet): "channel
 * customization (banner/avatar/handle/description) writes real
 * persisted profile state through the additive domain-graph seam."
 *
 * - THE SEAM: the persisted record IS the domain graph's
 *   `ChannelProfileEdit` (the record round-trips through the graph's
 *   own validating constructor — an invalid write surfaces the GRAPH'S
 *   field-level details verbatim, never a silent coercion);
 * - THE PERSISTENCE LAW: reload-durable (a fresh read of the same
 *   storage answers the record); a fresh storage answers null;
 * - THE COMPOSITION: the graph seam's `composeChannelProfile` overlays
 *   the persisted edit over the R36-derived base (declared fields win;
 *   undeclared fields keep the base truth; a foreign channel's edit
 *   never applies);
 * - THE CLEAR: the base derivation's truth stands again.
 */

import { describe, expect, it } from "bun:test";

import { composeChannelProfile } from "@wfx/domain";

import {
  STUDIO_PROFILE_STORE_KEY,
  clearStudioProfileEdit,
  readStudioProfileEdit,
  readStudioProfileStore,
  writeStudioProfileEdit,
} from "./studio-profile";
import { createInMemoryStudioStorage, type StudioStorage } from "./studio-storage";

const T0 = Date.parse("2026-09-28T12:00:00.000Z");
const now = (): Date => new Date(T0);

/** The R36-derived base (the fixtures boot's own derivation, mirrored for the compose law). */
const BASE = {
  connectorId: "fake-source",
  handle: "fake-source",
  description: "This source declares no channel description — WebFlix does not write one for it.",
};

describe("R38-B studio profile store — the domain-graph seam (the write path's law)", () => {
  it("persists a record that IS the graph's ChannelProfileEdit (round-trips through the seam)", () => {
    const storage = createInMemoryStudioStorage();
    const outcome = writeStudioProfileEdit(
      "fake-source",
      { handle: "studio-made", description: "The creator's declared description.", bannerUrl: null, avatarUrl: null },
      storage,
      now(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.edit.connectorId).toBe("fake-source");
    expect(outcome.edit.handle).toBe("studio-made");
    expect(outcome.edit.editedAt).toBe(new Date(T0).toISOString());
    // The reload answers the same record (reload-durable).
    expect(readStudioProfileEdit("fake-source", storage)).toEqual(outcome.edit);
  });

  it("surfaces the GRAPH SEAM's own field-level details on an invalid write (never a silent coercion)", () => {
    const storage = createInMemoryStudioStorage();
    const outcome = writeStudioProfileEdit(
      "fake-source",
      { handle: "@Bad Handle", description: null, bannerUrl: "javascript:alert(1)", avatarUrl: "not a url" },
      storage,
      now(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.problems.some((p) => p.includes("handle"))).toBe(true);
    expect(outcome.problems.some((p) => p.includes("bannerUrl"))).toBe(true);
    expect(outcome.problems.some((p) => p.includes("avatarUrl"))).toBe(true);
    // Nothing was persisted (never a half-state).
    expect(readStudioProfileEdit("fake-source", storage)).toBeNull();
  });

  it("answers null on a fresh storage (the base derivation's truth stands)", () => {
    expect(readStudioProfileEdit("fake-source", createInMemoryStudioStorage())).toBeNull();
    expect(readStudioProfileStore(createInMemoryStudioStorage())).toEqual({});
  });

  it("keeps the record under the studio's own key (never a second identity store)", () => {
    const storage = createInMemoryStudioStorage();
    writeStudioProfileEdit(
      "fake-source",
      { handle: null, description: "Only the description.", bannerUrl: null, avatarUrl: null },
      storage,
      now(),
    );
    const raw = storage.getItem(STUDIO_PROFILE_STORE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["fake-source"]);
  });

  it("refuses honestly when the storage write fails", () => {
    const refusing: StudioStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const outcome = writeStudioProfileEdit(
      "fake-source",
      { handle: "studio-made", description: null, bannerUrl: null, avatarUrl: null },
      refusing,
      now(),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("R38-B studio profile store — the composition (the graph seam's overlay law)", () => {
  it("composes the persisted edit over the R36-derived base (declared fields win)", () => {
    const storage = createInMemoryStudioStorage();
    writeStudioProfileEdit(
      "fake-source",
      { handle: "studio-made", description: "The customized truth.", bannerUrl: "https://example.com/b.png", avatarUrl: null },
      storage,
      now(),
    );
    const edit = readStudioProfileEdit("fake-source", storage);
    expect(edit).not.toBeNull();
    const composed = composeChannelProfile(BASE, edit);
    expect(composed.handle).toBe("studio-made");
    expect(composed.description).toBe("The customized truth.");
    expect(composed.bannerUrl).toBe("https://example.com/b.png");
    expect(composed.avatarUrl).toBeNull();
    expect(composed.customizedFields).toEqual(["handle", "description", "banner"]);
  });

  it("answers the base verbatim when no edit exists", () => {
    const composed = composeChannelProfile(BASE, null);
    expect(composed.handle).toBe("fake-source");
    expect(composed.description).toBe(BASE.description);
    expect(composed.customizedFields).toEqual([]);
  });

  it("clears the customization (the base derivation's truth stands again)", () => {
    const storage = createInMemoryStudioStorage();
    writeStudioProfileEdit(
      "fake-source",
      { handle: "studio-made", description: null, bannerUrl: null, avatarUrl: null },
      storage,
      now(),
    );
    expect(clearStudioProfileEdit("fake-source", storage).ok).toBe(true);
    expect(readStudioProfileEdit("fake-source", storage)).toBeNull();
    // A second clear refuses honestly.
    expect(clearStudioProfileEdit("fake-source", storage).ok).toBe(false);
  });
});
