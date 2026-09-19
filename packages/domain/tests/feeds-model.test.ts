/**
 * @wfx/domain tests — BYOF feed vocabularies, guards, and the idempotent
 * import key (R20-A, Worker 1 shared feed/import lane).
 *
 * Every test pins a LAW, not an implementation detail:
 * - the key derivation is deterministic and collision-safe (idempotent
 *   import law);
 * - the sync-state fold is the honest failure taxonomy (snapshot is never
 *   live; a failing source never erases records — it stales them);
 * - the validators accept the contract shapes and reject every drift with
 *   the field named.
 */

import { describe, expect, test } from "bun:test";

import {
  FEED_IMPORT_METHODS,
  FEED_RELATIONSHIPS,
  FEED_SYNC_STATES,
  FOLLOWING_RELATIONSHIPS,
  feedImportKey,
  feedRecordKeyInput,
  isFeedImportMethod,
  isFeedRelationship,
  isFeedSyncState,
  nextSyncStateAfterSync,
  validateConnectorFeedItem,
  validateConnectorFeedSnapshot,
  validateFeedProvenance,
  validateFeedRecord,
} from "../src/index";

// ---------------------------------------------------------------------------
// Vocabularies + guards
// ---------------------------------------------------------------------------

describe("feed vocabularies (closed unions)", () => {
  test("the import-method vocabulary is exactly the frozen union", () => {
    expect(FEED_IMPORT_METHODS).toEqual(["api", "official-export", "user-file", "snapshot"]);
  });

  test("the sync-state vocabulary is exactly the frozen union (order pinned)", () => {
    expect(FEED_SYNC_STATES).toEqual([
      "live",
      "syncing",
      "snapshot",
      "stale",
      "reauthorization-required",
      "unsupported",
      "degraded",
    ]);
  });

  test("the relationship vocabulary is exactly the frozen union", () => {
    expect(FEED_RELATIONSHIPS).toEqual([
      "follow",
      "subscription",
      "playlist",
      "watchlist",
      "like",
      "save",
      "ranked-feed",
      "history",
      "unknown",
    ]);
  });

  test("guards accept members and reject non-members", () => {
    expect(isFeedImportMethod("api")).toBe(true);
    expect(isFeedImportMethod("scrape")).toBe(false);
    expect(isFeedImportMethod(42)).toBe(false);
    expect(isFeedSyncState("stale")).toBe(true);
    expect(isFeedSyncState("fresh")).toBe(false);
    expect(isFeedSyncState(null)).toBe(false);
    expect(isFeedRelationship("follow")).toBe(true);
    expect(isFeedRelationship("subscribed")).toBe(false);
    expect(isFeedRelationship(undefined)).toBe(false);
  });

  test("the following-mode subset is exactly the follow graph relationships", () => {
    expect(FOLLOWING_RELATIONSHIPS).toEqual(["follow", "subscription"]);
  });
});

// ---------------------------------------------------------------------------
// The idempotent import key
// ---------------------------------------------------------------------------

describe("feedImportKey (the idempotent import law)", () => {
  const base = {
    profileId: "wfx_profile_a",
    connectorId: "youtube",
    relationship: "playlist" as const,
    sourceRef: "PL_wfx_fixture",
    externalRef: "Wfx54Docu001",
  };

  test("the same relationship always derives the same key (determinism)", () => {
    expect(feedImportKey(base)).toBe(feedImportKey({ ...base }));
    expect(feedImportKey(base)).toBe(feedImportKey({ ...base, title: "ignored" } as typeof base));
  });

  test("every key component participates (each difference is a different relationship)", () => {
    const key = feedImportKey(base);
    expect(feedImportKey({ ...base, profileId: "wfx_profile_b" })).not.toBe(key);
    expect(feedImportKey({ ...base, connectorId: "vimeo" })).not.toBe(key);
    expect(feedImportKey({ ...base, relationship: "watchlist" })).not.toBe(key);
    expect(feedImportKey({ ...base, sourceRef: "PL_other" })).not.toBe(key);
    expect(feedImportKey({ ...base, externalRef: "Wfx54Short01" })).not.toBe(key);
  });

  test("absent sourceRef and empty sourceRef are the SAME relationship (no container)", () => {
    const omitted = { ...base, sourceRef: undefined };
    const empty = { ...base, sourceRef: "" };
    // The empty string is the canonical "no container" component — a follows
    // import (no container) and a container keyed "" never fork identities.
    expect(feedImportKey(omitted)).toBe(feedImportKey(empty));
    // The property-absent form is the same relationship too.
    const { sourceRef: _absent, ...withoutRef } = base;
    expect(feedImportKey(withoutRef)).toBe(feedImportKey(empty));
  });

  test("separators in components cannot forge collisions (JSON escaping)", () => {
    const a = feedImportKey({
      profileId: 'p","c',
      connectorId: "youtube",
      relationship: "like",
      externalRef: "x",
    });
    const b = feedImportKey({
      profileId: "p",
      connectorId: 'c","youtube',
      relationship: "like",
      externalRef: "x",
    });
    expect(a).not.toBe(b);
  });

  test("feedRecordKeyInput round-trips the key of a persisted record", () => {
    const record = {
      profileId: base.profileId,
      externalRef: base.externalRef,
      provenance: {
        connectorId: base.connectorId,
        importMethod: "api" as const,
        sourceRef: base.sourceRef,
        relationship: base.relationship,
        sourceOrder: 3,
        capturedAt: "2026-09-19T10:00:00Z",
        syncState: "live" as const,
      },
    };
    expect(feedImportKey(feedRecordKeyInput(record))).toBe(feedImportKey(base));
  });
});

// ---------------------------------------------------------------------------
// The sync-state fold (stale/offline/reauth truth)
// ---------------------------------------------------------------------------

describe("nextSyncStateAfterSync (the honest failure taxonomy)", () => {
  test("success on a continuously-synced route grants live", () => {
    expect(nextSyncStateAfterSync({ ok: true, continuousSync: true })).toBe("live");
  });

  test("success on a one-time route stays a snapshot — never live", () => {
    expect(nextSyncStateAfterSync({ ok: true, continuousSync: false })).toBe("snapshot");
  });

  test("authorization failure demands reauthorization and NEVER implies deletion", () => {
    expect(
      nextSyncStateAfterSync({ ok: false, failure: "authorization", hasRecords: true }),
    ).toBe("reauthorization-required");
    expect(
      nextSyncStateAfterSync({ ok: false, failure: "authorization", hasRecords: false }),
    ).toBe("reauthorization-required");
  });

  test("a failing source with prior records stales them (survival law)", () => {
    expect(nextSyncStateAfterSync({ ok: false, failure: "transport", hasRecords: true })).toBe(
      "stale",
    );
    expect(nextSyncStateAfterSync({ ok: false, failure: "provider", hasRecords: true })).toBe(
      "stale",
    );
  });

  test("a failing source with no records yet is degraded (nothing honest to show)", () => {
    expect(nextSyncStateAfterSync({ ok: false, failure: "transport", hasRecords: false })).toBe(
      "degraded",
    );
    expect(nextSyncStateAfterSync({ ok: false, failure: "provider", hasRecords: false })).toBe(
      "degraded",
    );
  });

  test("an honestly unsupported route reports unsupported", () => {
    expect(nextSyncStateAfterSync({ ok: false, failure: "unsupported", hasRecords: true })).toBe(
      "unsupported",
    );
  });
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const validProvenance = {
  connectorId: "youtube",
  importMethod: "api",
  sourceRef: "PL_wfx_fixture",
  capturedAt: "2026-09-19T10:00:00Z",
  syncState: "snapshot",
  sourceOrder: 0,
  relationship: "playlist",
};

const validRecord = {
  id: "wfxfeed_0000000000000000000000000A",
  userId: "wfx_user_a",
  profileId: "wfx_profile_a",
  entertainmentItemId: "wfxitm_0000000000000000000000000A",
  externalRef: "Wfx54Docu001",
  provenance: validProvenance,
  importedAt: "2026-09-19T10:00:05Z",
  title: "Desert Rain — A Night Documentary",
};

describe("validateFeedProvenance", () => {
  test("accepts the contract shape", () => {
    expect(validateFeedProvenance(validProvenance).ok).toBe(true);
  });

  test("accepts a follow provenance without a container (sourceRef optional)", () => {
    const { sourceRef: _gone, ...follow } = validProvenance;
    expect(validateFeedProvenance({ ...follow, relationship: "follow" }).ok).toBe(true);
  });

  test("rejects every drift with the field named", () => {
    expect(validateFeedProvenance(null).ok).toBe(false);
    expect(validateFeedProvenance({ ...validProvenance, connectorId: " " }).errors[0]).toContain(
      "provenance.connectorId",
    );
    expect(validateFeedProvenance({ ...validProvenance, importMethod: "scrape" }).errors[0]).toContain(
      "provenance.importMethod",
    );
    expect(validateFeedProvenance({ ...validProvenance, capturedAt: "yesterday" }).errors[0]).toContain(
      "provenance.capturedAt",
    );
    expect(validateFeedProvenance({ ...validProvenance, syncState: "fresh" }).errors[0]).toContain(
      "provenance.syncState",
    );
    expect(validateFeedProvenance({ ...validProvenance, sourceOrder: -1 }).errors[0]).toContain(
      "provenance.sourceOrder",
    );
    expect(validateFeedProvenance({ ...validProvenance, sourceOrder: 1.5 }).errors[0]).toContain(
      "provenance.sourceOrder",
    );
    expect(validateFeedProvenance({ ...validProvenance, relationship: "subscribed" }).errors[0]).toContain(
      "provenance.relationship",
    );
    expect(validateFeedProvenance({ ...validProvenance, sourceRef: "" }).errors[0]).toContain(
      "provenance.sourceRef",
    );
  });
});

describe("validateFeedRecord", () => {
  test("accepts the persisted record shape (frozen fields + store columns)", () => {
    expect(validateFeedRecord(validRecord).ok).toBe(true);
  });

  test("rejects a missing/blank canonical item reference — a fake reference is never valid", () => {
    expect(validateFeedRecord({ ...validRecord, entertainmentItemId: "" }).ok).toBe(false);
    expect(validateFeedRecord({ ...validRecord, entertainmentItemId: undefined }).ok).toBe(false);
  });

  test("rejects an invalid embedded provenance with the path prefixed", () => {
    const result = validateFeedRecord({
      ...validRecord,
      provenance: { ...validProvenance, syncState: "live!" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("record.provenance.syncState");
  });
});

describe("validateConnectorFeedItem", () => {
  test("accepts the capture-row shape", () => {
    expect(
      validateConnectorFeedItem({
        externalRef: "Wfx54Docu001",
        relationship: "playlist",
        sourceOrder: 2,
        title: "Desert Rain",
        sourceUpdatedAt: "2025-03-14T09:00:00Z",
        metadata: { channelId: "UCWfx54Channel00000000000A" },
      }).ok,
    ).toBe(true);
  });

  test("rejects a negative/fractional source-native order", () => {
    expect(validateConnectorFeedItem({ externalRef: "x", relationship: "like", sourceOrder: -1 }).ok).toBe(false);
    expect(validateConnectorFeedItem({ externalRef: "x", relationship: "like", sourceOrder: 0.5 }).ok).toBe(false);
  });
});

describe("validateConnectorFeedSnapshot", () => {
  const validSnapshot = {
    connectorId: "youtube",
    method: "api",
    capturedAt: "2026-09-19T10:00:00Z",
    continuousSync: true,
    orderSemantics: "source-native",
    sourceRef: "PL_wfx_fixture",
    syncState: "snapshot",
    items: [
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0 },
      { externalRef: "Wfx54Short01", relationship: "playlist", sourceOrder: 1 },
    ],
  };

  test("accepts the capture shape", () => {
    expect(validateConnectorFeedSnapshot(validSnapshot).ok).toBe(true);
  });

  test("rejects a non-array items field outright", () => {
    expect(validateConnectorFeedSnapshot({ ...validSnapshot, items: "nope" }).ok).toBe(false);
  });

  test("rejects a bad item with the index in the path", () => {
    const result = validateConnectorFeedSnapshot({
      ...validSnapshot,
      items: [
        { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0 },
        { externalRef: "", relationship: "playlist", sourceOrder: 1 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("snapshot.items[1].item.externalRef");
  });

  test("rejects a snapshot that self-assigns a bogus order semantics", () => {
    expect(validateConnectorFeedSnapshot({ ...validSnapshot, orderSemantics: "webflix-rank" }).ok).toBe(
      false,
    );
  });
});
