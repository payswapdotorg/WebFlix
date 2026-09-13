import { describe, expect, it } from "bun:test";

import {
  CREATOR_ID_PREFIX,
  CREATOR_KINDS,
  ITEM_RELATIONS,
  TOPIC_ID_PREFIX,
  type Creator,
  type GraphEvent,
  type GraphItem,
  EntertainmentGraph,
  GraphError,
  dedupeKey,
  isCreatorId,
  isCreatorKind,
  isItemRelation,
  isTopicId,
  mergeCandidates,
  mergeItems,
  mergeRealizations,
  newCreatorId,
  newEntertainmentItemId,
  newEventId,
  newSourceRealizationId,
  newTopicId,
  normalizeTitle,
  sharesExternalRealization,
  type SourceRealization,
  type Topic,
  validateEntertainmentEvent,
} from "../src/index";

const T0 = Date.parse("2026-09-13T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const MIN = 60_000;

/** Runs fn expecting a GraphError; asserts kind and returns the error. */
function expectGraphError(fn: () => void): GraphError {
  try {
    fn();
  } catch (error) {
    const graphError = error as GraphError;
    expect(graphError).toBeInstanceOf(GraphError);
    expect(graphError.kind).toBe("invalid-input");
    expect(graphError.details.length).toBeGreaterThan(0);
    return graphError;
  }
  throw new Error("expected a GraphError to be thrown");
}

/** Narrow a fetched item to non-undefined for follow-up assertions. */
function mustItem(item: GraphItem | undefined): GraphItem {
  if (item === undefined) throw new Error("expected the item to exist");
  return item;
}

/** Cast an arbitrary object to GraphItem for negative tests (validation is under test). */
function asItem(input: Record<string, unknown>): GraphItem {
  return input as unknown as GraphItem;
}

function makeItem(options: {
  id?: GraphItem["id"];
  title?: string;
  type?: GraphItem["canonicalType"];
  durationMs?: number;
  orientation?: GraphItem["orientation"];
  creators?: GraphItem["creators"];
  topics?: GraphItem["topics"];
  realizations?: GraphItem["realizations"];
  createdAt?: string;
  updatedAt?: string;
} = {}): GraphItem {
  const item: GraphItem = {
    id: options.id ?? newEntertainmentItemId(),
    canonicalType: options.type ?? "movie",
    creators: options.creators ?? [],
    topics: options.topics ?? [],
    realizations: options.realizations ?? [],
    createdAt: options.createdAt ?? iso(T0),
    updatedAt: options.updatedAt ?? iso(T0),
  };
  if (options.title !== undefined) item.canonicalTitle = options.title;
  if (options.durationMs !== undefined) item.durationMs = options.durationMs;
  if (options.orientation !== undefined) item.orientation = options.orientation;
  return item;
}

function makeRealization(
  itemId: GraphItem["id"],
  options: {
    id?: SourceRealization["id"];
    entertainmentItemId?: string;
    connectorId?: string;
    externalRef?: string;
    capabilities?: SourceRealization["capabilities"];
    availability?: SourceRealization["availability"];
  } = {},
): SourceRealization {
  return {
    id: options.id ?? newSourceRealizationId(),
    entertainmentItemId: options.entertainmentItemId ?? itemId,
    connectorId: options.connectorId ?? "source-a",
    externalRef: options.externalRef ?? "ref-1",
    capabilities: options.capabilities ?? ["metadata"],
    availability: options.availability ?? "available",
  };
}

describe("graph model — id branding", () => {
  it("newCreatorId mints a canonical wfxcre_ id accepted by isCreatorId", () => {
    const id = newCreatorId();
    expect(id.startsWith(CREATOR_ID_PREFIX)).toBe(true);
    expect(id.slice(CREATOR_ID_PREFIX.length)).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(isCreatorId(id)).toBe(true);
    expect(newCreatorId()).not.toBe(id); // intra-ms monotonicity keeps ids distinct
  });

  it("isCreatorId rejects malformed input", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "wfxcre_short",
      "wfxcre_0123456789ABCDEFGHJKMNPQRSTUV", // 27 chars
      "wfxcre_l0123456789ABCDEFGHJKMNPQRST", // 'l' not in Crockford alphabet
      "wfxitm_0123456789ABCDEFGHJKMNPQRST", // wrong prefix
      "",
    ]) {
      expect(isCreatorId(bad)).toBe(false);
    }
  });

  it("newTopicId mints a canonical wfxtop_ id accepted by isTopicId", () => {
    const id = newTopicId();
    expect(id.startsWith(TOPIC_ID_PREFIX)).toBe(true);
    expect(id.slice(TOPIC_ID_PREFIX.length)).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(isTopicId(id)).toBe(true);
    expect(newTopicId()).not.toBe(id);
    expect(isTopicId("wfxtop_bad")).toBe(false);
    expect(isTopicId(newCreatorId())).toBe(false); // prefixes are not interchangeable
  });

  it("mirrors the frozen creator kinds and item relations exactly", () => {
    expect([...CREATOR_KINDS]).toEqual(["person", "group", "channel", "studio"]);
    expect([...ITEM_RELATIONS]).toEqual([
      "partOf",
      "sequelOf",
      "prequelOf",
      "sameSeries",
      "relatedTo",
      "adaptationOf",
    ]);
    expect(isCreatorKind("studio")).toBe(true);
    expect(isCreatorKind("company")).toBe(false);
    expect(isItemRelation("adaptationOf")).toBe(true);
    expect(isItemRelation("remakeOf")).toBe(false);
  });

  it("GraphError carries a typed kind and aggregated field-level details", () => {
    const error = new GraphError(["field A: bad", "field B: bad"]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GraphError");
    expect(error.kind).toBe("invalid-input");
    expect(error.details).toEqual(["field A: bad", "field B: bad"]);
    expect(error.message).toContain("field A: bad");
    expect(new GraphError("one").details).toEqual(["one"]);
  });

  it("GraphEvent extends the frozen event with an optional envelope reference", () => {
    const itemId = newEntertainmentItemId();
    const enveloped: GraphEvent = {
      userId: "user-1",
      itemId,
      type: "start",
      occurredAt: iso(T0),
      sessionId: "sess-1",
      envelopeId: newEventId(),
    };
    const bare: GraphEvent = {
      userId: "user-1",
      itemId,
      type: "complete",
      occurredAt: iso(T0),
      sessionId: "sess-1",
    };
    const envelopedResult = validateEntertainmentEvent(enveloped);
    const bareResult = validateEntertainmentEvent(bare);
    if (!envelopedResult.ok || !bareResult.ok) throw new Error("graph events must validate");
    expect(enveloped.envelopeId).toBeDefined();
    expect("envelopeId" in bare).toBe(false);
  });
});

describe("EntertainmentGraph — item CRUD", () => {
  it("upsertItem stores the item; item() returns a deep frozen copy", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    const input = makeItem({
      id,
      title: "The Matrix",
      durationMs: 136 * MIN,
      creators: [newCreatorId()],
      topics: [newTopicId()],
      realizations: [makeRealization(id)],
    });
    const returned = graph.upsertItem(input);
    expect(returned).toEqual(input);
    expect(graph.item(input.id)).toEqual(input);

    const fetched = mustItem(graph.item(input.id));
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(Object.isFrozen(fetched.creators)).toBe(true);
    expect(Object.isFrozen(fetched.topics)).toBe(true);
    expect(Object.isFrozen(fetched.realizations)).toBe(true);
    const firstRealization = fetched.realizations[0];
    if (firstRealization === undefined) throw new Error("fixture error");
    expect(Object.isFrozen(firstRealization)).toBe(true);

    // Frozen means mutation attempts fail loudly instead of corrupting the store.
    expect(() => {
      (fetched as unknown as { canonicalTitle: string }).canonicalTitle = "hacked";
    }).toThrow();
  });

  it("mutating the caller's input after upsert cannot corrupt the store", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    const input = makeItem({
      id,
      title: "The Matrix",
      realizations: [makeRealization(id, { connectorId: "source-a", externalRef: "ref-1" })],
    });
    graph.upsertItem(input);
    const extra = makeRealization(id, { connectorId: "source-a", externalRef: "ref-2" });
    input.realizations.push(extra);
    (input as unknown as { canonicalTitle: string }).canonicalTitle = "hacked";
    expect(graph.realizationsOf(id).length).toBe(1);
    expect(mustItem(graph.item(id)).canonicalTitle).toBe("The Matrix");
  });

  it("item() on an unknown id returns undefined; malformed ids throw", () => {
    const graph = new EntertainmentGraph();
    expect(graph.item(newEntertainmentItemId())).toBeUndefined();
    expectGraphError(() => graph.item("wfxitm_bad" as unknown as ReturnType<typeof newEntertainmentItemId>));
  });

  it("upsertItem rejects malformed items with typed, aggregated errors", () => {
    const graph = new EntertainmentGraph();
    const goodId = newEntertainmentItemId();
    const otherItemId = newEntertainmentItemId();

    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), id: "not-an-id" })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), canonicalType: "film" })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), durationMs: -1 })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), orientation: "diagonal" })));
    expectGraphError(() =>
      graph.upsertItem(asItem({ ...makeItem(), creators: ["not-a-creator-id"] })),
    );
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), topics: ["not-a-topic-id"] })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), createdAt: "yesterday" })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), updatedAt: "2026-09-13" })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), creators: "nope" })));
    expectGraphError(() => graph.upsertItem(asItem({ ...makeItem(), realizations: "nope" })));
    expectGraphError(() => graph.upsertItem(null as unknown as GraphItem));

    // A realization pointing at a different item violates the one-identity invariant.
    expectGraphError(() =>
      graph.upsertItem(makeItem({ realizations: [makeRealization(otherItemId)] })),
    );
    // A realization with a capability outside the frozen Capability union.
    expectGraphError(() =>
      graph.upsertItem(
        asItem({
          ...makeItem({ id: goodId }),
          realizations: [{ ...makeRealization(goodId), capabilities: ["telepathy"] }],
        }),
      ),
    );

    // Multiple problems aggregate into one error's details.
    const aggregated = expectGraphError(() =>
      graph.upsertItem(asItem({ ...makeItem(), id: "bad", createdAt: "nope" })),
    );
    expect(aggregated.details.length).toBeGreaterThanOrEqual(2);
    expect(graph.item(goodId)).toBeUndefined(); // nothing was stored
  });

  it("re-upsert merges: defined scalars win, references union, timestamps min/max", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    const creatorA = newCreatorId();
    const creatorB = newCreatorId();
    const topicA = newTopicId();
    const topicB = newTopicId();

    graph.upsertItem(
      makeItem({
        id,
        title: "The Matrix",
        durationMs: 136 * MIN,
        orientation: "horizontal",
        creators: [creatorA],
        topics: [topicA],
        realizations: [
          makeRealization(id, {
            connectorId: "source-a",
            externalRef: "ref-1",
            capabilities: ["metadata"],
            availability: "available",
          }),
        ],
        createdAt: iso(T0 + 5 * MIN),
        updatedAt: iso(T0 + 5 * MIN),
      }),
    );

    // Defined incoming scalars win; creators/topics/realizations union.
    const merged = graph.upsertItem(
      makeItem({
        id,
        title: "The Matrix (1999)",
        durationMs: 140 * MIN,
        orientation: "vertical",
        creators: [creatorB],
        topics: [topicB],
        realizations: [
          makeRealization(id, {
            connectorId: "source-a",
            externalRef: "ref-1",
            capabilities: ["metadata", "playEmbed"],
            availability: "unknown",
          }),
          makeRealization(id, { connectorId: "source-b", externalRef: "ref-9" }),
        ],
        createdAt: iso(T0 + 30 * MIN), // later: earliest (T0+5m) kept
        updatedAt: iso(T0 + 1 * MIN), // earlier: latest (T0+5m) kept
      }),
    );

    expect(merged.canonicalTitle).toBe("The Matrix (1999)");
    expect(merged.durationMs).toBe(140 * MIN);
    expect(merged.orientation).toBe("vertical");
    expect([...merged.creators]).toEqual([creatorA, creatorB]);
    expect([...merged.topics]).toEqual([topicA, topicB]);
    expect(merged.createdAt).toBe(iso(T0 + 5 * MIN)); // earliest
    expect(merged.updatedAt).toBe(iso(T0 + 5 * MIN)); // latest of (T0+5m, T0+1m)

    // Realization dedupe on (source-a, ref-1) with capability union; ref-9 appended.
    const realizations = graph.realizationsOf(id);
    expect(realizations.length).toBe(2);
    const mergedRealization = realizations.find(
      (r) => r.connectorId === "source-a" && r.externalRef === "ref-1",
    );
    if (mergedRealization === undefined) throw new Error("merged realization missing");
    expect([...mergedRealization.capabilities]).toEqual(["metadata", "playEmbed"]);
    expect(mergedRealization.availability).toBe("available"); // primary definite wins
  });

  it("re-upsert with absent optional fields keeps stored values (undefined never erases)", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    graph.upsertItem(
      makeItem({ id, title: "The Matrix", durationMs: 136 * MIN, orientation: "horizontal" }),
    );
    const merged = graph.upsertItem(makeItem({ id })); // no title/duration/orientation
    expect(merged.canonicalTitle).toBe("The Matrix");
    expect(merged.durationMs).toBe(136 * MIN);
    expect(merged.orientation).toBe("horizontal");
  });
});

describe("EntertainmentGraph — creators & topics", () => {
  it("upsertCreator inserts/updates with trimmed names and validates input", () => {
    const graph = new EntertainmentGraph();
    const creatorId = newCreatorId();
    const creator: Creator = { id: creatorId, name: "  Lana Wachowski  ", kind: "person" };
    const stored = graph.upsertCreator(creator);
    expect(stored).toEqual({ id: creatorId, name: "Lana Wachowski", kind: "person" });
    expect(Object.isFrozen(stored)).toBe(true);

    const updated = graph.upsertCreator({ id: creatorId, name: "Lilly Wachowski", kind: "person" });
    expect(updated.name).toBe("Lilly Wachowski"); // last write wins by id

    expectGraphError(() => graph.upsertCreator({ id: "bad", name: "X", kind: "person" } as unknown as Creator));
    expectGraphError(() => graph.upsertCreator({ id: newCreatorId(), name: "  ", kind: "person" }));
    expectGraphError(() => graph.upsertCreator({ id: newCreatorId(), name: "X", kind: "company" } as unknown as Creator));
    expectGraphError(() => graph.upsertCreator(null as unknown as Creator));
  });

  it("upsertTopic inserts/updates with trimmed labels and validates input", () => {
    const graph = new EntertainmentGraph();
    const topicId = newTopicId();
    const stored = graph.upsertTopic({ id: topicId, label: "  Cyberpunk  " });
    expect(stored).toEqual({ id: topicId, label: "Cyberpunk" });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(graph.upsertTopic({ id: topicId, label: "Dystopia" }).label).toBe("Dystopia");

    expectGraphError(() => graph.upsertTopic({ id: "bad", label: "X" } as unknown as Topic));
    expectGraphError(() => graph.upsertTopic({ id: newTopicId(), label: " " }));
    expectGraphError(() => graph.upsertTopic(null as unknown as Topic));
  });

  it("byCreator resolves item references (registry record optional), unknown → empty, malformed → error", () => {
    const graph = new EntertainmentGraph();
    const creatorId = newCreatorId(); // never upserted as a registry record
    const itemA = makeItem({ creators: [creatorId] });
    const itemB = makeItem({ creators: [creatorId, newCreatorId()] });
    const itemC = makeItem({});
    graph.upsertItem(itemA);
    graph.upsertItem(itemB);
    graph.upsertItem(itemC);

    const results = graph.byCreator(creatorId);
    expect(results.map((item) => item.id)).toEqual([itemA.id, itemB.id]); // insertion order
    expect(graph.byCreator(newCreatorId())).toEqual([]); // unknown creator: empty, not an error
    expectGraphError(() => graph.byCreator("wfxcre_bad" as unknown as ReturnType<typeof newCreatorId>));
  });

  it("byTopic resolves item references, unknown → empty, malformed → error", () => {
    const graph = new EntertainmentGraph();
    const topicId = newTopicId();
    const itemA = makeItem({ topics: [topicId] });
    graph.upsertItem(itemA);
    expect(graph.byTopic(topicId).map((item) => item.id)).toEqual([itemA.id]);
    expect(graph.byTopic(newTopicId())).toEqual([]);
    expectGraphError(() => graph.byTopic("wfxtop_bad" as unknown as ReturnType<typeof newTopicId>));
  });
});

describe("EntertainmentGraph — realizations", () => {
  it("upsertRealization appends, dedupes per (connectorId, externalRef), and merges", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    graph.upsertItem(makeItem({ id }));

    const first = graph.upsertRealization(
      id,
      makeRealization(id, {
        connectorId: "source-a",
        externalRef: "ref-1",
        capabilities: ["metadata"],
        availability: "unknown",
      }),
    );
    expect(first.availability).toBe("unknown");

    // Same (connectorId, externalRef), different realization id: merged, not duplicated.
    const second = graph.upsertRealization(
      id,
      makeRealization(id, {
        connectorId: "source-a",
        externalRef: "ref-1",
        capabilities: ["playEmbed"],
        availability: "available",
      }),
    );
    expect(second.id).toBe(first.id); // stable identity
    expect([...second.capabilities]).toEqual(["metadata", "playEmbed"]); // union
    expect(second.availability).toBe("available"); // unknown defers to a definite value
    expect(graph.realizationsOf(id).length).toBe(1);

    // A definite conflict keeps the stored (primary) value.
    const third = graph.upsertRealization(
      id,
      makeRealization(id, {
        connectorId: "source-a",
        externalRef: "ref-1",
        availability: "unavailable",
      }),
    );
    expect(third.availability).toBe("available");
    expect(graph.realizationsOf(id).length).toBe(1);

    // Different externalRef on the same connector → separate realization.
    graph.upsertRealization(id, makeRealization(id, { connectorId: "source-a", externalRef: "ref-2" }));
    // Same externalRef on a different connector → separate realization.
    graph.upsertRealization(id, makeRealization(id, { connectorId: "source-b", externalRef: "ref-1" }));
    expect(graph.realizationsOf(id).length).toBe(3);
  });

  it("upsertRealization refreshes the item's updatedAt and returns frozen data", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    graph.upsertItem(makeItem({ id, updatedAt: iso(T0) }));
    const before = Date.now() - 1000;
    const stored = graph.upsertRealization(id, makeRealization(id));
    const after = Date.now() + 1000;
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.capabilities)).toBe(true);
    const updatedAt = Date.parse(mustItem(graph.item(id)).updatedAt);
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });

  it("upsertRealization rejects unknown items, mismatched ids, and malformed realizations", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    graph.upsertItem(makeItem({ id }));
    const otherId = newEntertainmentItemId();

    expectGraphError(() => graph.upsertRealization(otherId, makeRealization(otherId)));
    expectGraphError(() => graph.upsertRealization(id, makeRealization(otherId))); // mismatch
    expectGraphError(() => graph.upsertRealization("wfxitm_bad" as unknown as ReturnType<typeof newEntertainmentItemId>, makeRealization(id)));
    expectGraphError(() =>
      graph.upsertRealization(
        id,
        asItem({ ...makeRealization(id), id: "wfxsrc_bad" }) as unknown as SourceRealization,
      ),
    );
    expectGraphError(() =>
      graph.upsertRealization(
        id,
        asItem({ ...makeRealization(id), capabilities: ["telepathy"] }) as unknown as SourceRealization,
      ),
    );
  });

  it("realizationsOf: unknown item → empty, malformed id → error, results frozen", () => {
    const graph = new EntertainmentGraph();
    const id = newEntertainmentItemId();
    graph.upsertItem(makeItem({ id, realizations: [makeRealization(id)] }));
    const realizations = graph.realizationsOf(id);
    expect(Object.isFrozen(realizations)).toBe(true);
    expect(realizations.length).toBe(1);
    expect(graph.realizationsOf(newEntertainmentItemId())).toEqual([]);
    expectGraphError(() =>
      graph.realizationsOf("wfxitm_bad" as unknown as ReturnType<typeof newEntertainmentItemId>),
    );
  });
});

describe("EntertainmentGraph — relationships & neighbors", () => {
  function seededGraph(): { graph: EntertainmentGraph; a: GraphItem; b: GraphItem; c: GraphItem } {
    const graph = new EntertainmentGraph();
    const a = makeItem({ title: "The Matrix" });
    const b = makeItem({ title: "The Matrix Reloaded" });
    const c = makeItem({ title: "The Matrix Revolutions" });
    graph.upsertItem(a);
    graph.upsertItem(b);
    graph.upsertItem(c);
    return { graph, a, b, c };
  }

  it("relate stores a directed edge; neighbors traverse it from both ends", () => {
    const { graph, a, b } = seededGraph();
    const edge = graph.relate(a.id, b.id, "sequelOf");
    expect(edge).toEqual({ fromItemId: a.id, toItemId: b.id, relation: "sequelOf" });
    expect(Object.isFrozen(edge)).toBe(true);

    expect(graph.neighbors(a.id).map((item) => item.id)).toEqual([b.id]);
    expect(graph.neighbors(b.id).map((item) => item.id)).toEqual([a.id]); // direction-agnostic
  });

  it("neighbors is one hop only and deduplicates multi-edge neighbors", () => {
    const { graph, a, b, c } = seededGraph();
    graph.relate(a.id, b.id, "sameSeries");
    graph.relate(b.id, c.id, "sameSeries");
    graph.relate(a.id, b.id, "relatedTo"); // second edge to the same neighbor

    expect(graph.neighbors(a.id).map((item) => item.id)).toEqual([b.id]); // no c, no duplicate b
    expect(graph.neighbors(b.id).map((item) => item.id)).toEqual([a.id, c.id]);
    expect(graph.neighbors(c.id).map((item) => item.id)).toEqual([b.id]);
  });

  it("relate is idempotent per (from, to, relation) triple", () => {
    const { graph, a, b } = seededGraph();
    const first = graph.relate(a.id, b.id, "partOf");
    const second = graph.relate(a.id, b.id, "partOf");
    expect(second).toEqual(first);
    expect(graph.neighbors(a.id).length).toBe(1);
    // A different relation between the same pair is a distinct edge.
    graph.relate(a.id, b.id, "relatedTo");
    expect(graph.neighbors(a.id).length).toBe(1); // still one neighbor item
  });

  it("relate rejects self-edges, unknown items, and invalid relations", () => {
    const { graph, a } = seededGraph();
    expectGraphError(() => graph.relate(a.id, a.id, "relatedTo"));
    expectGraphError(() =>
      graph.relate(a.id, newEntertainmentItemId(), "sequelOf"),
    );
    expectGraphError(() =>
      graph.relate(newEntertainmentItemId(), a.id, "sequelOf"),
    );
    expectGraphError(() =>
      graph.relate(a.id, newEntertainmentItemId(), "nope" as unknown as "sequelOf"),
    );
    expectGraphError(() =>
      graph.relate("wfxitm_bad" as unknown as ReturnType<typeof newEntertainmentItemId>, a.id, "relatedTo"),
    );
  });

  it("neighbors: unknown item → empty, malformed id → error", () => {
    const { graph } = seededGraph();
    expect(graph.neighbors(newEntertainmentItemId())).toEqual([]);
    expectGraphError(() =>
      graph.neighbors("wfxitm_bad" as unknown as ReturnType<typeof newEntertainmentItemId>),
    );
  });
});

describe("EntertainmentGraph — search", () => {
  it("search is a case-insensitive substring match over canonicalTitle", () => {
    const graph = new EntertainmentGraph();
    const a = makeItem({ title: "The Matrix" });
    const b = makeItem({ title: "matrix reloaded" });
    const c = makeItem({ title: "Inception" });
    const untitled = makeItem({}); // no title: never matches
    graph.upsertItem(a);
    graph.upsertItem(b);
    graph.upsertItem(c);
    graph.upsertItem(untitled);

    expect(graph.search("matrix").map((item) => item.id)).toEqual([a.id, b.id]);
    expect(graph.search("MATRIX").map((item) => item.id)).toEqual([a.id, b.id]);
    expect(graph.search("Matr").map((item) => item.id)).toEqual([a.id, b.id]);
    expect(graph.search("Inception").map((item) => item.id)).toEqual([c.id]);
    expect(graph.search("nope")).toEqual([]);
  });

  it("search rejects empty, whitespace-only, and non-string queries", () => {
    const graph = new EntertainmentGraph();
    expectGraphError(() => graph.search(""));
    expectGraphError(() => graph.search("   "));
    expectGraphError(() => graph.search(null as unknown as string));
  });
});

describe("dedupe — normalizeTitle", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace, trims", () => {
    expect(normalizeTitle("  The   Matrix ")).toBe("the matrix");
    expect(normalizeTitle("Café König")).toBe("cafe konig");
    expect(normalizeTitle("Spider-Man: No Way Home!")).toBe("spiderman no way home");
    expect(normalizeTitle("Ça, c'est l'été !!")).toBe("ca cest lete");
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle("...")).toBe("");
    expect(normalizeTitle("ÄÖÜ 123")).toBe("aou 123");
  });
});

describe("dedupe — dedupeKey", () => {
  it("equal for the same type + normalized title + same 60s duration bucket", () => {
    const a = makeItem({ title: "The Matrix", durationMs: 136 * MIN });
    const b = makeItem({ title: "the matrix!!", durationMs: 136 * MIN + 30 * 1000 }); // same bucket
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  it("different for different type, title, or duration bucket", () => {
    const matrix = makeItem({ title: "The Matrix", durationMs: 136 * MIN });
    const series = makeItem({ title: "The Matrix", type: "series", durationMs: 136 * MIN });
    const other = makeItem({ title: "Inception", durationMs: 136 * MIN });
    const longer = makeItem({ title: "The Matrix", durationMs: 136 * MIN + 90 * 1000 }); // next bucket
    expect(dedupeKey(matrix)).not.toBe(dedupeKey(series));
    expect(dedupeKey(matrix)).not.toBe(dedupeKey(other));
    expect(dedupeKey(matrix)).not.toBe(dedupeKey(longer));
  });

  it("duration optionality: absent matches absent, never present", () => {
    const noDurationA = makeItem({ title: "The Matrix" });
    const noDurationB = makeItem({ title: "THE matrix!" });
    const withDuration = makeItem({ title: "The Matrix", durationMs: 136 * MIN });
    expect(dedupeKey(noDurationA)).toBe(dedupeKey(noDurationB));
    expect(dedupeKey(noDurationA)).not.toBe(dedupeKey(withDuration));
  });

  it("missing titles share a key shape but carry no signal (see mergeCandidates)", () => {
    const untitledA = makeItem({});
    const untitledB = makeItem({});
    expect(dedupeKey(untitledA)).toBe(dedupeKey(untitledB)); // pure key function: equal
    expect(mergeCandidates(untitledA, untitledB)).toBe(false); // predicate: no title, no match
  });
});

describe("dedupe — mergeCandidates", () => {
  it("true for the same normalized title + type + duration bucket", () => {
    const a = makeItem({ title: "Café", durationMs: 90 * MIN });
    const b = makeItem({ title: "CAFE!", durationMs: 90 * MIN });
    expect(mergeCandidates(a, b)).toBe(true);
    expect(mergeCandidates(b, a)).toBe(true); // symmetric
  });

  it("true for a shared external (connectorId, externalRef) despite different titles", () => {
    const id = newEntertainmentItemId();
    const a = makeItem({
      title: "The Matrix",
      realizations: [makeRealization(id, { connectorId: "source-a", externalRef: "x-1" })],
    });
    const b = makeItem({
      title: "Matrix (1999)",
      durationMs: 99 * MIN,
      realizations: [makeRealization(id, { connectorId: "source-a", externalRef: "x-1" })],
    });
    expect(mergeCandidates(a, b)).toBe(true);
  });

  it("false for different titles with no shared realization", () => {
    const a = makeItem({ title: "The Matrix", durationMs: 136 * MIN });
    const b = makeItem({ title: "Inception", durationMs: 136 * MIN });
    expect(mergeCandidates(a, b)).toBe(false);
  });

  it("false when titles match but duration buckets differ and no ref is shared", () => {
    const id = newEntertainmentItemId();
    const a = makeItem({
      title: "The Matrix",
      durationMs: 136 * MIN,
      realizations: [makeRealization(id, { connectorId: "source-a", externalRef: "x-1" })],
    });
    const b = makeItem({
      title: "the matrix",
      durationMs: 137 * MIN,
      realizations: [makeRealization(id, { connectorId: "source-b", externalRef: "y-2" })],
    });
    expect(mergeCandidates(a, b)).toBe(false);
  });

  it("shared-ref helper: empty realization lists never match", () => {
    const id = newEntertainmentItemId();
    const realization = makeRealization(id, { connectorId: "source-a", externalRef: "x-1" });
    expect(sharesExternalRealization([realization], [realization])).toBe(true);
    expect(
      sharesExternalRealization(
        [realization],
        [makeRealization(id, { connectorId: "source-a", externalRef: "other" })],
      ),
    ).toBe(false); // same connector, different ref → no shared identity
    expect(sharesExternalRealization([], [realization])).toBe(false);
    expect(sharesExternalRealization([realization], [])).toBe(false);
  });
});

describe("dedupe — mergeRealizations", () => {
  it("merges one identity: stable primary id, capability union, availability policy", () => {
    const id = newEntertainmentItemId();
    const primary = makeRealization(id, {
      connectorId: "source-a",
      externalRef: "ref-1",
      capabilities: ["metadata", "save"],
      availability: "available",
    });
    const duplicate = makeRealization(id, {
      connectorId: "source-a",
      externalRef: "ref-1",
      capabilities: ["playEmbed"],
      availability: "unknown",
    });
    const merged = mergeRealizations(primary, duplicate);
    expect(merged.id).toBe(primary.id);
    expect(merged.entertainmentItemId).toBe(id);
    expect(merged.connectorId).toBe("source-a");
    expect(merged.externalRef).toBe("ref-1");
    expect([...merged.capabilities]).toEqual(["metadata", "save", "playEmbed"]);
    expect(merged.availability).toBe("available"); // primary definite wins over unknown
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.capabilities)).toBe(true);
  });

  it("throws typed errors for mismatched external identities or items", () => {
    const idA = newEntertainmentItemId();
    const idB = newEntertainmentItemId();
    const base = makeRealization(idA, { connectorId: "source-a", externalRef: "ref-1" });
    expectGraphError(() =>
      mergeRealizations(base, makeRealization(idA, { connectorId: "source-a", externalRef: "ref-2" })),
    );
    expectGraphError(() =>
      mergeRealizations(base, makeRealization(idA, { connectorId: "source-b", externalRef: "ref-1" })),
    );
    expectGraphError(() =>
      mergeRealizations(base, makeRealization(idB, { connectorId: "source-a", externalRef: "ref-1" })),
    );
  });
});

describe("dedupe — mergeItems", () => {
  it("unions creators, topics, and realizations; retargets duplicate realizations to the primary id", () => {
    const idPrimary = newEntertainmentItemId();
    const idDuplicate = newEntertainmentItemId();
    const creatorShared = newCreatorId();
    const creatorPrimaryOnly = newCreatorId();
    const creatorDuplicateOnly = newCreatorId();
    const topicShared = newTopicId();
    const topicDuplicateOnly = newTopicId();

    const primary = makeItem({
      id: idPrimary,
      title: "The Matrix",
      creators: [creatorShared, creatorPrimaryOnly],
      topics: [topicShared],
      realizations: [
        makeRealization(idPrimary, {
          id: newSourceRealizationId(),
          connectorId: "source-a",
          externalRef: "ref-1",
          capabilities: ["metadata"],
          availability: "unknown",
        }),
        makeRealization(idPrimary, { connectorId: "source-c", externalRef: "ref-3" }),
      ],
    });
    const duplicate = makeItem({
      id: idDuplicate,
      title: "the matrix!!",
      creators: [creatorShared, creatorDuplicateOnly],
      topics: [topicShared, topicDuplicateOnly],
      realizations: [
        makeRealization(idDuplicate, {
          connectorId: "source-a",
          externalRef: "ref-1",
          capabilities: ["playEmbed"],
          availability: "available",
        }),
        makeRealization(idDuplicate, { connectorId: "source-b", externalRef: "ref-2" }),
      ],
    });

    const merged = mergeItems(primary, duplicate);
    expect(merged.id).toBe(idPrimary); // canonical identity survives
    expect([...merged.creators]).toEqual([creatorShared, creatorPrimaryOnly, creatorDuplicateOnly]);
    expect([...merged.topics]).toEqual([topicShared, topicDuplicateOnly]);

    // Realizations: one per (connectorId, externalRef); all retargeted to the primary id.
    expect(merged.realizations.length).toBe(3);
    for (const realization of merged.realizations) {
      expect(realization.entertainmentItemId).toBe(idPrimary);
    }
    const sourceA = merged.realizations.find(
      (r) => r.connectorId === "source-a" && r.externalRef === "ref-1",
    );
    if (sourceA === undefined) throw new Error("merged realization missing");
    expect([...sourceA.capabilities]).toEqual(["metadata", "playEmbed"]); // union
    expect(sourceA.availability).toBe("available"); // unknown defers to a definite value

    // Deep-frozen result; inputs untouched.
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.creators)).toBe(true);
    expect(merged.realizations.every((realization) => Object.isFrozen(realization))).toBe(true);
    expect(primary.realizations.length).toBe(2);
    expect(duplicate.realizations.length).toBe(2);
  });

  it("keeps the earliest createdAt and the latest updatedAt", () => {
    const primary = makeItem({ createdAt: iso(T0 + 10 * MIN), updatedAt: iso(T0 + 10 * MIN) });
    const duplicate = makeItem({ createdAt: iso(T0 + 2 * MIN), updatedAt: iso(T0 + 30 * MIN) });
    const merged = mergeItems(primary, duplicate);
    expect(merged.createdAt).toBe(iso(T0 + 2 * MIN)); // earliest
    expect(merged.updatedAt).toBe(iso(T0 + 30 * MIN)); // latest
  });

  it("prefers non-undefined optional fields (primary first, then duplicate)", () => {
    const idPrimary = newEntertainmentItemId();
    const idDuplicate = newEntertainmentItemId();
    // Primary untitled: the duplicate's title survives.
    const untitledPrimary = makeItem({ id: idPrimary, durationMs: 136 * MIN });
    const titledDuplicate = makeItem({ id: idDuplicate, title: "The Matrix", durationMs: 148 * MIN });
    const mergedA = mergeItems(untitledPrimary, titledDuplicate);
    expect(mergedA.canonicalTitle).toBe("The Matrix");
    expect(mergedA.durationMs).toBe(136 * MIN); // primary defined wins
    expect(mergedA.canonicalType).toBe("movie");

    // Both titled: primary wins; duplicate's duration/orientation fill absences.
    const primary = makeItem({ id: idPrimary, title: "Primary Title" });
    const duplicate = makeItem({ id: idDuplicate, title: "Duplicate Title", durationMs: 90 * MIN, orientation: "vertical" });
    const mergedB = mergeItems(primary, duplicate);
    expect(mergedB.canonicalTitle).toBe("Primary Title");
    expect(mergedB.durationMs).toBe(90 * MIN);
    expect(mergedB.orientation).toBe("vertical");
  });
});
