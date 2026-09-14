/**
 * WFX-013 — reference read-only connector tests.
 *
 * Covers the acceptance criteria of the packet:
 * - capability honesty: descriptor caps vs the ACTUAL method support matrix
 *   (every advertised capability works; every unadvertised one is
 *   typed-unsupported or structurally absent);
 * - search / metadata / resolve golden paths AND miss paths (ok-empty /
 *   ok-null — never throws);
 * - read-only enforcement: every mutating user action returns a typed
 *   `unsupported` result;
 * - context validation: typed `invalid-input` errors;
 * - lifecycle demo: created → initialized → disposed transitions.
 *
 * Plus determinism guards (identical outputs across calls and instances)
 * and registry interop through public APIs only.
 */

import { describe, expect, it } from "bun:test";

import type { Capability, ConnectorContext, UserAction } from "@wfx/domain";

import {
  CAPABILITIES,
  ConnectorRegistry,
  DuplicateConnectorError,
  isErr,
  isInvalidInput,
  isOk,
  isUnsupported,
  createReferenceConnector,
  demonstrateReferenceConnectorLifecycle,
  findReferenceCatalogEntry,
  REFERENCE_CATALOG,
  REFERENCE_CONNECTOR_CAPABILITIES,
  REFERENCE_CONNECTOR_DESCRIPTOR,
  REFERENCE_CONNECTOR_ID,
  REFERENCE_LIBRARY,
  REFERENCE_PLAYBACK_MODE_PRECEDENCE,
  REFERENCE_SEARCH_INDEX,
  ReferenceConnector,
  tokenize,
  type ConnectorError,
  type ConnectorResult,
} from "../src/index";

const CTX: ConnectorContext = { userId: "user-1", locale: "en-US" };

const ACTION_TYPES: readonly UserAction["type"][] = [
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

function action(type: UserAction["type"], externalRef = "ref:movie-aurora"): UserAction {
  return { type, connectorId: REFERENCE_CONNECTOR_ID, externalRef };
}

/** Create + initialize a reference connector (the golden-path setup). */
async function initializedReference(): Promise<ReferenceConnector> {
  const connector = createReferenceConnector();
  await connector.initialize();
  return connector;
}

/** Unwrap an ok result (fails the test loudly if it is an error). */
function unwrapOk<T>(result: ConnectorResult<T>): T {
  if (isOk(result)) return result.value;
  throw new Error(`expected ok result, received error '${result.error.kind}'`);
}

/** Unwrap an err result (fails the test loudly if it is a success). */
function unwrapErr<T>(result: ConnectorResult<T>): ConnectorError {
  if (isErr(result)) return result.error;
  throw new Error("expected err result, received ok");
}

/** Narrow to the invalid-input variant, failing loudly otherwise. */
function asInvalidInput(error: ConnectorError) {
  if (!isInvalidInput(error)) {
    throw new Error(`expected invalid-input error, got '${error.kind}'`);
  }
  return error;
}

/** Narrow to the unsupported variant, failing loudly otherwise. */
function asUnsupported(error: ConnectorError) {
  if (!isUnsupported(error)) {
    throw new Error(`expected unsupported error, got '${error.kind}'`);
  }
  return error;
}

// ---------------------------------------------------------------------------
// Descriptor — honest capability declaration
// ---------------------------------------------------------------------------

describe("WFX-013 descriptor — capability truth", () => {
  it("declares the exact identity fields", () => {
    expect(REFERENCE_CONNECTOR_DESCRIPTOR.id).toBe("wfx-reference");
    expect(REFERENCE_CONNECTOR_DESCRIPTOR.version).toBe("0.1.0");
    expect(REFERENCE_CONNECTOR_DESCRIPTOR.displayName).toBe("WebFlix Reference Source");
    expect(REFERENCE_CONNECTOR_DESCRIPTOR.auth).toBe("none");
  });

  it("declares EXACTLY the seven read-only capabilities", () => {
    expect([...REFERENCE_CONNECTOR_DESCRIPTOR.capabilities]).toEqual([
      ...REFERENCE_CONNECTOR_CAPABILITIES,
    ]);
    expect([...REFERENCE_CONNECTOR_DESCRIPTOR.capabilities]).toEqual([
      "catalogSearch",
      "metadata",
      "playEmbed",
      "playBrowser",
      "playExternal",
      "availability",
      "libraryRead",
    ]);
  });

  it("deliberately declares NO mutating or native capability", () => {
    for (const cap of [
      "identity",
      "playNative",
      "libraryWrite",
      "like",
      "save",
      "follow",
      "comment",
      "download",
      "transform",
    ] as const) {
      expect(REFERENCE_CONNECTOR_DESCRIPTOR.capabilities.includes(cap)).toBe(false);
    }
  });

  it("every declared capability is a member of the frozen Capability union", () => {
    for (const cap of REFERENCE_CONNECTOR_CAPABILITIES) {
      expect(CAPABILITIES.includes(cap)).toBe(true);
    }
  });

  it("the descriptor is validated and frozen (SDK defineDescriptor semantics)", () => {
    expect(Object.isFrozen(REFERENCE_CONNECTOR_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(REFERENCE_CONNECTOR_DESCRIPTOR.capabilities)).toBe(true);
  });

  it("the factory's connector carries the same descriptor", async () => {
    const connector = await initializedReference();
    expect(connector.descriptor()).toEqual(REFERENCE_CONNECTOR_DESCRIPTOR);
    expect(connector.id).toBe(REFERENCE_CONNECTOR_ID);
    expect(connector.hasCapability("libraryRead")).toBe(true);
    expect(connector.hasCapability("libraryWrite")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixture catalog integrity
// ---------------------------------------------------------------------------

describe("WFX-013 fixture catalog — deterministic, offline, well-formed", () => {
  it("has at least 10 items (12 in the fixture)", () => {
    expect(REFERENCE_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(REFERENCE_CATALOG.length).toBe(12);
  });

  it("covers EVERY canonical type", () => {
    const types = new Set(REFERENCE_CATALOG.map((entry) => entry.item.canonicalType));
    for (const type of ["movie", "series", "episode", "video", "short", "post", "audio"]) {
      expect(types.has(type as never)).toBe(true);
    }
  });

  it("has unique external refs", () => {
    const refs = REFERENCE_CATALOG.map((entry) => entry.item.externalRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("every item reports a well-formed availability; all three values occur", () => {
    const seen = new Set<string>();
    for (const entry of REFERENCE_CATALOG) {
      const availability = entry.item.availability;
      expect(["available", "unavailable", "unknown"]).toContain(availability);
      seen.add(availability);
    }
    expect([...seen].sort()).toEqual(["available", "unavailable", "unknown"]);
  });

  it("every item has at least one playback realization", () => {
    for (const entry of REFERENCE_CATALOG) {
      expect(entry.realizations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("realization modes are only embed/browser/external — native is ABSENT", () => {
    for (const entry of REFERENCE_CATALOG) {
      for (const realization of entry.realizations) {
        expect(realization.mode).not.toBe("native");
        expect(["embed", "browser", "external"]).toContain(realization.mode);
      }
    }
  });

  it("per-item realization modes are unique and precedence-ordered in the fixture", () => {
    for (const entry of REFERENCE_CATALOG) {
      const modes = entry.realizations.map((realization) => realization.mode);
      expect(new Set(modes).size).toBe(modes.length);
      const precedences = modes.map((mode) => REFERENCE_PLAYBACK_MODE_PRECEDENCE[mode]);
      for (let i = 1; i < precedences.length; i += 1) {
        expect(precedences[i]).toBeGreaterThan(precedences[i - 1] ?? 0);
      }
    }
  });

  it("every realization is branded with the connector id and its mode's capability", () => {
    const capabilityForMode: Record<string, string> = {
      embed: "playEmbed",
      browser: "playBrowser",
      external: "playExternal",
    };
    for (const entry of REFERENCE_CATALOG) {
      for (const realization of entry.realizations) {
        expect(realization.connectorId).toBe(REFERENCE_CONNECTOR_ID);
        expect(realization.externalRef).toBe(entry.item.externalRef);
        expect(realization.url).toMatch(/^https:\/\/reference\.invalid\//);
        const expectedCapability = capabilityForMode[realization.mode];
        if (expectedCapability === undefined) throw new Error("unmapped mode");
        expect(realization.capabilities).toEqual([expectedCapability]);
      }
    }
  });

  it("item.capabilities mirror the item's realization modes (derived, not hand-maintained)", () => {
    for (const entry of REFERENCE_CATALOG) {
      const expected = [
        ...new Set(
          entry.realizations.map((realization) => {
            const capability = realization.capabilities[0];
            if (capability === undefined) throw new Error("realization without capability");
            return capability;
          }),
        ),
      ];
      expect(entry.item.capabilities).toEqual(expected);
    }
  });

  it("fixture data is deep-frozen (deterministic, mutation-proof)", () => {
    expect(Object.isFrozen(REFERENCE_CATALOG)).toBe(true);
    expect(Object.isFrozen(REFERENCE_LIBRARY)).toBe(true);
    expect(Object.isFrozen(REFERENCE_SEARCH_INDEX)).toBe(true);
    for (const entry of REFERENCE_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.item)).toBe(true);
      expect(Object.isFrozen(entry.realizations)).toBe(true);
    }
  });

  it("the search index is aligned with the catalog and tokenized", () => {
    expect(REFERENCE_SEARCH_INDEX.length).toBe(REFERENCE_CATALOG.length);
    for (let i = 0; i < REFERENCE_SEARCH_INDEX.length; i += 1) {
      const document = REFERENCE_SEARCH_INDEX[i];
      const entry = REFERENCE_CATALOG[i];
      if (document === undefined || entry === undefined) throw new Error("misaligned index");
      expect(document.externalRef).toBe(entry.item.externalRef);
      for (const token of [...document.titleTokens, ...document.topicTokens]) {
        expect(token).toBe(token.toLowerCase());
        expect(token).toMatch(/^[a-z0-9]+$/);
      }
    }
  });

  it("tokenize: case-insensitive, punctuation-splitting, empties dropped", () => {
    expect(tokenize("Aurora Protocol!")).toEqual(["aurora", "protocol"]);
    expect(tokenize("Lighthouse Keepers S1E1 The First Light")).toEqual([
      "lighthouse",
      "keepers",
      "s1e1",
      "the",
      "first",
      "light",
    ]);
    expect(tokenize("The Cartographer's Daughter")).toEqual([
      "the",
      "cartographer",
      "s",
      "daughter",
    ]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("?!...")).toEqual([]);
    expect(tokenize("MiXeD CaSe")).toEqual(["mixed", "case"]);
  });

  it("findReferenceCatalogEntry: same frozen entry per ref, undefined for unknown", () => {
    const entry = findReferenceCatalogEntry("ref:movie-aurora");
    if (entry === undefined) throw new Error("expected catalog entry");
    expect(entry.item.title).toBe("Aurora Protocol");
    expect(findReferenceCatalogEntry("ref:movie-aurora")).toBe(entry);
    expect(findReferenceCatalogEntry("ref:no-such-item")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Capability honesty — advertised capabilities WORK
// ---------------------------------------------------------------------------

describe("WFX-013 capability honesty — every ADVERTISED capability works", () => {
  it("catalogSearch: search returns typed ok hits", async () => {
    const connector = await initializedReference();
    const result = await connector.searchResult(CTX, "aurora");
    const hits = unwrapOk(result);
    expect(hits.length).toBe(4);
    for (const hit of hits) expect(hit.connectorId).toBe(REFERENCE_CONNECTOR_ID);
  });

  it("metadata: metadata returns a typed ok item for a known ref", async () => {
    const connector = await initializedReference();
    const item = unwrapOk(await connector.metadataResult(CTX, "ref:movie-aurora"));
    if (item === null) throw new Error("expected item");
    expect(item.title).toBe("Aurora Protocol");
  });

  it("playEmbed / playBrowser / playExternal: resolve yields a realization for each mode", async () => {
    const connector = await initializedReference();
    const realizations = unwrapOk(await connector.resolveResult(CTX, "ref:movie-aurora"));
    const modes = realizations.map((realization) => realization.mode);
    expect(modes).toEqual(["embed", "browser", "external"]);
  });

  it("availability (informational): reported per item via SourceItem.availability", () => {
    // The availability capability gates no SDK operation (see base.ts); its
    // working surface is every item's availability value.
    for (const entry of REFERENCE_CATALOG) {
      expect(["available", "unavailable", "unknown"]).toContain(entry.item.availability);
    }
    expect(
      REFERENCE_CATALOG.some((entry) => entry.item.availability === "unavailable"),
    ).toBe(true);
    expect(REFERENCE_CATALOG.some((entry) => entry.item.availability === "unknown")).toBe(true);
  });

  it("libraryRead: readLibrary returns the typed ok fixture list", async () => {
    const connector = await initializedReference();
    const library = unwrapOk(await connector.readLibraryResult(CTX));
    expect(library).toEqual([...REFERENCE_LIBRARY]);
    expect(library.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Capability honesty — unadvertised capabilities are typed-unsupported
// ---------------------------------------------------------------------------

describe("WFX-013 capability honesty — every UNADVERTISED capability is unsupported or absent", () => {
  it("playNative: resolve NEVER fabricates a native realization (any ref)", async () => {
    const connector = await initializedReference();
    for (const entry of REFERENCE_CATALOG) {
      const realizations = unwrapOk(
        await connector.resolveResult(CTX, entry.item.externalRef),
      );
      for (const realization of realizations) {
        expect(realization.mode).not.toBe("native");
      }
    }
  });

  it("libraryWrite: writeLibraryResult answers typed unsupported", async () => {
    const connector = await initializedReference();
    const error = asUnsupported(
      unwrapErr(
        await connector.writeLibraryResult(CTX, { op: "add", externalRef: "ref:movie-aurora" }),
      ),
    );
    expect(error.capability).toBe("libraryWrite");
    expect(error.detail).toBeTruthy();
  });

  it("identity: undeclared and gates no SDK operation (informational only)", () => {
    // identity gates no SDK operation (base.ts), so there is no probe to
    // call; the honest assertion is the declaration itself.
    expect(REFERENCE_CONNECTOR_DESCRIPTOR.capabilities.includes("identity")).toBe(false);
  });

  for (const type of ACTION_TYPES) {
    it(`'${type}': executeAction answers typed unsupported`, async () => {
      const connector = await initializedReference();
      const error = asUnsupported(
        unwrapErr(await connector.executeActionResult(CTX, action(type))),
      );
      expect(error.capability).toBe(type);
      expect(typeof error.detail).toBe("string");
      expect(error.detail?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Search — golden paths, miss paths, determinism
// ---------------------------------------------------------------------------

describe("WFX-013 search — deterministic tokenized matching", () => {
  it("golden path: 'aurora' ranks the four title matches in catalog order", async () => {
    const connector = await initializedReference();
    const hits = unwrapOk(await connector.searchResult(CTX, "aurora"));
    expect(hits.map((hit) => hit.externalRef)).toEqual([
      "ref:movie-aurora",
      "ref:video-featurette-aurora",
      "ref:post-storyboards",
      "ref:audio-aurora-score",
    ]);
  });

  it("ranks are 1-based, ascending, and carried in metadata.rank", async () => {
    const connector = await initializedReference();
    const hits = unwrapOk(await connector.searchResult(CTX, "aurora"));
    hits.forEach((hit, index) => {
      expect(hit.metadata?.["rank"]).toBe(index + 1);
    });
  });

  it("case-insensitive: 'AURORA' equals 'aurora'", async () => {
    const connector = await initializedReference();
    expect(unwrapOk(await connector.searchResult(CTX, "AURORA"))).toEqual(
      unwrapOk(await connector.searchResult(CTX, "aurora")),
    );
  });

  it("topic tokens match (topic weight): 'mystery' hits the series and episodes", async () => {
    const connector = await initializedReference();
    const hits = unwrapOk(await connector.searchResult(CTX, "mystery"));
    expect(hits.map((hit) => hit.externalRef)).toEqual([
      "ref:series-lighthouse",
      "ref:series-static-harbor",
      "ref:episode-lighthouse-s1e1",
      "ref:episode-lighthouse-s1e2",
    ]);
  });

  it("multi-token queries score per token; exact title matches outrank partial ones", async () => {
    const connector = await initializedReference();
    const hits = unwrapOk(await connector.searchResult(CTX, "aurora protocol"));
    expect(hits.map((hit) => hit.externalRef)).toEqual([
      "ref:movie-aurora", // aurora (2) + protocol (2) = 4
      "ref:audio-aurora-score", // 4
      "ref:video-featurette-aurora", // aurora only = 2
      "ref:post-storyboards", // 2
    ]);
  });

  it("title tokens outrank topic tokens for the same query", async () => {
    const connector = await initializedReference();
    // 'drama' is only a TOPIC token → topic-only weight, catalog order.
    const drama = unwrapOk(await connector.searchResult(CTX, "drama"));
    expect(drama.map((hit) => hit.externalRef)).toEqual([
      "ref:movie-cartographer",
      "ref:series-lighthouse",
      "ref:series-static-harbor",
    ]);
    // 'keepers' is a TITLE token only.
    const keepers = unwrapOk(await connector.searchResult(CTX, "keepers"));
    expect(keepers.map((hit) => hit.externalRef)).toEqual([
      "ref:series-lighthouse",
      "ref:episode-lighthouse-s1e1",
      "ref:episode-lighthouse-s1e2",
    ]);
  });

  it("miss path: a query with no matching tokens returns typed ok-empty", async () => {
    const connector = await initializedReference();
    expect(unwrapOk(await connector.searchResult(CTX, "zzz-nomatch"))).toEqual([]);
  });

  it("miss path: a non-empty query that TOKENIZES to nothing returns typed ok-empty", async () => {
    // "empty query ⇒ empty result (typed ok)": the empty-string case is
    // rejected by the SDK's canonical input guard (invalid-input, see
    // below); a tokenless query is the ok-empty branch.
    const connector = await initializedReference();
    expect(unwrapOk(await connector.searchResult(CTX, "?!..."))).toEqual([]);
  });

  it("empty-string query is rejected by the SDK's canonical input guard (typed invalid-input)", async () => {
    const connector = await initializedReference();
    const error = asInvalidInput(unwrapErr(await connector.searchResult(CTX, "")));
    expect(error.detail).toContain("query");
  });

  it("plain surface: search() equals the result surface, and degrades empty query to []", async () => {
    const connector = await initializedReference();
    const hits = unwrapOk(await connector.searchResult(CTX, "aurora"));
    expect(await connector.search(CTX, "aurora")).toEqual(hits);
    expect(await connector.search(CTX, "")).toEqual([]);
    expect(connector.lastError()?.kind).toBe("invalid-input");
  });

  it("hits mirror item fields (canonicalType, durationMs, orientation) where defined", async () => {
    const connector = await initializedReference();
    const hits = unwrapOk(await connector.searchResult(CTX, "silence"));
    expect(hits.map((hit) => hit.externalRef)).toEqual(["ref:short-silence"]);
    const hit = hits[0];
    if (hit === undefined) throw new Error("expected hit");
    expect(hit.canonicalType).toBe("short");
    expect(hit.durationMs).toBe(60_000);
    expect(hit.orientation).toBe("vertical");
  });

  it("determinism: identical queries yield identical results (same and separate instances)", async () => {
    const connector = await initializedReference();
    const first = unwrapOk(await connector.searchResult(CTX, "aurora protocol"));
    const second = unwrapOk(await connector.searchResult(CTX, "aurora protocol"));
    expect(second).toEqual(first);

    const other = await initializedReference();
    expect(unwrapOk(await other.searchResult(CTX, "aurora protocol"))).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// Metadata — golden and miss paths
// ---------------------------------------------------------------------------

describe("WFX-013 metadata — golden and miss paths", () => {
  it("golden path: a known ref resolves to its full SourceItem", async () => {
    const connector = await initializedReference();
    const item = unwrapOk(await connector.metadataResult(CTX, "ref:series-lighthouse"));
    if (item === null) throw new Error("expected item");
    expect(item.connectorId).toBe(REFERENCE_CONNECTOR_ID);
    expect(item.title).toBe("Lighthouse Keepers");
    expect(item.canonicalType).toBe("series");
    expect(item.availability).toBe("available");
    expect(item.capabilities).toEqual(["playEmbed", "playBrowser"]);
  });

  it("miss path: an unknown ref resolves to typed ok-null — NEVER a throw", async () => {
    const connector = await initializedReference();
    const result = await connector.metadataResult(CTX, "ref:no-such-item");
    expect(isOk(result)).toBe(true);
    expect(unwrapOk(result)).toBeNull();
  });

  it("plain surface: metadata() serves the item and null for misses", async () => {
    const connector = await initializedReference();
    const item = await connector.metadata(CTX, "ref:movie-aurora");
    expect(item?.title).toBe("Aurora Protocol");
    expect(await connector.metadata(CTX, "ref:no-such-item")).toBeNull();
  });

  it("metadata returns the frozen fixture item (deterministic identity)", async () => {
    const connector = await initializedReference();
    const item = unwrapOk(await connector.metadataResult(CTX, "ref:movie-aurora"));
    if (item === null) throw new Error("expected item");
    expect(Object.isFrozen(item)).toBe(true);
    expect(unwrapOk(await connector.metadataResult(CTX, "ref:movie-aurora"))).toBe(item);
  });
});

// ---------------------------------------------------------------------------
// Resolve — precedence-ordered realizations
// ---------------------------------------------------------------------------

describe("WFX-013 resolve — frozen precedence (embed → browser → external)", () => {
  it("golden path: a three-mode item resolves in exact precedence order", async () => {
    const connector = await initializedReference();
    const realizations = unwrapOk(await connector.resolveResult(CTX, "ref:movie-aurora"));
    expect(realizations.map((realization) => realization.mode)).toEqual([
      "embed",
      "browser",
      "external",
    ]);
  });

  it("a two-mode item resolves as its precedence-ordered subset", async () => {
    const connector = await initializedReference();
    const realizations = unwrapOk(await connector.resolveResult(CTX, "ref:series-lighthouse"));
    expect(realizations.map((realization) => realization.mode)).toEqual(["embed", "browser"]);
  });

  it("an external-only item resolves to exactly one external realization", async () => {
    const connector = await initializedReference();
    const realizations = unwrapOk(await connector.resolveResult(CTX, "ref:series-static-harbor"));
    expect(realizations.map((realization) => realization.mode)).toEqual(["external"]);
  });

  it("miss path: an unknown ref resolves to typed ok-empty — NEVER a throw", async () => {
    const connector = await initializedReference();
    const result = await connector.resolveResult(CTX, "ref:no-such-item");
    expect(isOk(result)).toBe(true);
    expect(unwrapOk(result)).toEqual([]);
  });

  it("resolve returns a FRESH array: caller mutation cannot corrupt later calls", async () => {
    const connector = await initializedReference();
    const first = unwrapOk(await connector.resolveResult(CTX, "ref:movie-aurora"));
    first.reverse();
    first.push({
      mode: "external",
      connectorId: REFERENCE_CONNECTOR_ID,
      capabilities: ["playExternal"],
    });
    const second = unwrapOk(await connector.resolveResult(CTX, "ref:movie-aurora"));
    expect(second.map((realization) => realization.mode)).toEqual([
      "embed",
      "browser",
      "external",
    ]);
  });

  it("plain surface: resolve() equals the result surface list", async () => {
    const connector = await initializedReference();
    expect(await connector.resolve(CTX, "ref:movie-aurora")).toEqual(
      unwrapOk(await connector.resolveResult(CTX, "ref:movie-aurora")),
    );
  });

  it("every ref resolves in precedence order (global scan)", async () => {
    const connector = await initializedReference();
    for (const entry of REFERENCE_CATALOG) {
      const realizations = unwrapOk(
        await connector.resolveResult(CTX, entry.item.externalRef),
      );
      for (let i = 1; i < realizations.length; i += 1) {
        const previous = realizations[i - 1];
        const current = realizations[i];
        if (previous === undefined || current === undefined) throw new Error("bad list");
        expect(
          REFERENCE_PLAYBACK_MODE_PRECEDENCE[current.mode],
        ).toBeGreaterThan(REFERENCE_PLAYBACK_MODE_PRECEDENCE[previous.mode]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Read-only enforcement
// ---------------------------------------------------------------------------

describe("WFX-013 read-only enforcement — every mutating action is typed unsupported", () => {
  for (const type of ACTION_TYPES) {
    it(`'${type}' returns a typed unsupported result (never a throw, never a fake receipt)`, async () => {
      const connector = await initializedReference();
      const result = await connector.executeActionResult(CTX, action(type));
      const error = asUnsupported(unwrapErr(result));
      expect(error.capability).toBe(type);
      expect(error.detail).toContain(REFERENCE_CONNECTOR_ID);
    });
  }

  it("readLibrary is the ONLY library surface: deterministic fixture list, fixed timestamps", async () => {
    const connector = await initializedReference();
    const library = unwrapOk(await connector.readLibraryResult(CTX));
    expect(library.map((entry) => entry.externalRef)).toEqual([
      "ref:movie-aurora",
      "ref:series-lighthouse",
      "ref:audio-aurora-score",
    ]);
    expect(library.map((entry) => entry.addedAt)).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-03T18:30:00.000Z",
      "2026-09-05T12:15:00.000Z",
    ]);
  });

  it("writeLibraryResult is gated to typed unsupported (libraryWrite undeclared)", async () => {
    const connector = await initializedReference();
    const error = asUnsupported(
      unwrapErr(
        await connector.writeLibraryResult(CTX, { op: "remove", externalRef: "ref:movie-aurora" }),
      ),
    );
    expect(error.capability).toBe("libraryWrite");
  });

  it("plain surface degrades honestly: unsupported receipts, never fake successes", async () => {
    const connector = await initializedReference();

    const receipt = await connector.executeAction(CTX, action("save"));
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toBeTruthy();
    expect(connector.lastError()?.kind).toBe("unsupported");

    const writeReceipt = await connector.writeLibrary(CTX, {
      op: "add",
      externalRef: "ref:movie-aurora",
    });
    expect(writeReceipt.status).toBe("unsupported");
    expect(connector.lastError()?.kind).toBe("unsupported");
  });

  it("an action addressed to a DIFFERENT connector is rejected as invalid-input", async () => {
    const connector = await initializedReference();
    const error = asInvalidInput(
      unwrapErr(
        await connector.executeActionResult(CTX, {
          type: "like",
          connectorId: "some-other-connector",
          externalRef: "ref:movie-aurora",
        }),
      ),
    );
    expect(error.detail).toContain("some-other-connector");
  });
});

// ---------------------------------------------------------------------------
// Context + argument validation (typed invalid-input)
// ---------------------------------------------------------------------------

describe("WFX-013 context validation — typed invalid-input errors", () => {
  const BAD_CTXS: readonly { name: string; ctx: unknown; field: string }[] = [
    { name: "empty userId", ctx: { userId: "", locale: "en-US" }, field: "userId" },
    { name: "whitespace userId", ctx: { userId: "   ", locale: "en-US" }, field: "userId" },
    { name: "empty locale", ctx: { userId: "user-1", locale: "" }, field: "locale" },
    {
      name: "non-string region",
      ctx: { userId: "user-1", locale: "en-US", region: 7 },
      field: "region",
    },
    { name: "null ctx", ctx: null, field: "ctx" },
    { name: "non-object ctx", ctx: 42, field: "ctx" },
  ];

  it("every method validates the context before anything else (except lifecycle)", async () => {
    const connector = await initializedReference();

    for (const { name, ctx, field } of BAD_CTXS) {
      const probes: readonly { op: string; call: () => Promise<ConnectorResult<unknown>> }[] = [
        { op: "searchResult", call: () => connector.searchResult(ctx as never, "aurora") },
        {
          op: "metadataResult",
          call: () => connector.metadataResult(ctx as never, "ref:movie-aurora"),
        },
        { op: "resolveResult", call: () => connector.resolveResult(ctx as never, "ref:movie-aurora") },
        { op: "executeActionResult", call: () => connector.executeActionResult(ctx as never, action("like")) },
        { op: "readLibraryResult", call: () => connector.readLibraryResult(ctx as never) },
        {
          op: "writeLibraryResult",
          call: () =>
            connector.writeLibraryResult(ctx as never, { op: "add", externalRef: "ref:movie-aurora" }),
        },
      ];
      for (const { op, call } of probes) {
        const error = asInvalidInput(unwrapErr(await call()));
        expect(`${name}/${op}: ${error.detail}`).toContain(field);
      }
    }
  });

  it("empty/whitespace query and ref are typed invalid-input", async () => {
    const connector = await initializedReference();
    for (const query of ["", "   "]) {
      asInvalidInput(unwrapErr(await connector.searchResult(CTX, query)));
    }
    for (const ref of ["", "  "]) {
      asInvalidInput(unwrapErr(await connector.metadataResult(CTX, ref)));
      asInvalidInput(unwrapErr(await connector.resolveResult(CTX, ref)));
    }
  });

  it("malformed user actions are typed invalid-input", async () => {
    const connector = await initializedReference();
    const badActions: readonly { name: string; action: unknown }[] = [
      { name: "unknown type", action: { ...action("like"), type: "bookmark" } },
      {
        name: "missing connectorId",
        action: { type: "like", externalRef: "ref:movie-aurora" },
      },
      { name: "empty externalRef", action: action("like", "") },
      { name: "non-object", action: "like" as never },
    ];
    for (const { name, action: bad } of badActions) {
      const error = asInvalidInput(
        unwrapErr(await connector.executeActionResult(CTX, bad as UserAction)),
      );
      expect(`${name}: ${error.detail}`).toBeTruthy();
    }
  });

  it("malformed library commands are typed invalid-input (input guard runs before the capability gate)", async () => {
    const connector = await initializedReference();
    const badCommands: readonly unknown[] = [
      { op: "upsert", externalRef: "ref:movie-aurora" },
      { op: "add", externalRef: "" },
    ];
    for (const command of badCommands) {
      asInvalidInput(unwrapErr(await connector.writeLibraryResult(CTX, command as never)));
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle demo — FSM transitions
// ---------------------------------------------------------------------------

describe("WFX-013 lifecycle demo — created → initialized → disposed", () => {
  it("walks the FSM cleanly: registered → initialized → disposed", async () => {
    const report = await demonstrateReferenceConnectorLifecycle();
    expect(report.connectorId).toBe(REFERENCE_CONNECTOR_ID);
    expect([...report.states]).toEqual(["registered", "initialized", "disposed"]);
    expect(report.cleanTransition).toBe(true);
  });

  it("operations on the DISPOSED connector produce the typed LifecycleError", async () => {
    const report = await demonstrateReferenceConnectorLifecycle();
    const probe = report.postDisposeOperation;
    expect(probe.operation).toBe("searchResult");
    expect(probe.threwLifecycleError).toBe(true);
    expect(probe.from).toBe("disposed");
    expect(probe.attempted).toBe("assertOperational");
  });

  it("all three refusal probes are typed LifecycleErrors from the right states", async () => {
    const report = await demonstrateReferenceConnectorLifecycle();
    expect(report.refusals.length).toBe(3);
    const [before, after, doubleDispose] = report.refusals;
    if (before === undefined || after === undefined || doubleDispose === undefined) {
      throw new Error("expected three refusals");
    }
    expect(before.phase).toBe("operation-before-initialize");
    expect(before.from).toBe("registered");
    expect(after.phase).toBe("operation-after-dispose");
    expect(after.from).toBe("disposed");
    expect(doubleDispose.phase).toBe("double-dispose");
    expect(doubleDispose.from).toBe("disposed");
    for (const refusal of report.refusals) {
      expect(refusal.threwLifecycleError).toBe(true);
    }
  });

  it("the error-channel split is on show: operational unsupported is RETURNED, not thrown", async () => {
    const report = await demonstrateReferenceConnectorLifecycle();
    expect(report.operationalUnsupportedReturned).toBe(true);
    expect(
      report.observations.some((line) => line.includes("executeAction(like)")),
    ).toBe(true);
  });

  it("pure + deterministic: two runs produce identical reports", async () => {
    const first = await demonstrateReferenceConnectorLifecycle();
    const second = await demonstrateReferenceConnectorLifecycle();
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// Registry interop — registration through PUBLIC APIs only
// ---------------------------------------------------------------------------

describe("WFX-013 registry interop — public APIs only", () => {
  it("registers as a live instance and renders an honest capability matrix row", async () => {
    const connector = await initializedReference();
    const registry = new ConnectorRegistry();
    registry.register(connector);

    const row = registry
      .capabilityMatrix()
      .find((candidate) => candidate.id === REFERENCE_CONNECTOR_ID);
    if (row === undefined) throw new Error("expected matrix row");
    expect(row.hasInstance).toBe(true);
    expect(row.displayName).toBe("WebFlix Reference Source");
    expect(row.auth).toBe("none");
    expect(row.version).toBe("0.1.0");

    // Every frozen capability is truthfully rendered.
    for (const cap of CAPABILITIES) {
      expect(row.capabilities[cap as Capability]).toBe(
        REFERENCE_CONNECTOR_CAPABILITIES.includes(cap),
      );
    }
  });

  it("the registered instance serves the frozen plain contract", async () => {
    const connector = await initializedReference();
    const registry = new ConnectorRegistry();
    registry.register(connector);

    const viaRegistry = registry.get(REFERENCE_CONNECTOR_ID);
    if (viaRegistry === undefined) throw new Error("expected registered instance");
    const hits = await viaRegistry.search(CTX, "aurora");
    expect(hits.length).toBe(4);
    expect(hits[0]?.externalRef).toBe("ref:movie-aurora");
  });

  it("withCapability filters reflect the honest declaration", async () => {
    const connector = await initializedReference();
    const registry = new ConnectorRegistry();
    registry.register(connector);

    expect(registry.withCapability("libraryRead")).toEqual([connector]);
    expect(registry.withCapability("libraryWrite")).toEqual([]);
    expect(registry.withCapability("like")).toEqual([]);
    expect(registry.withCapability("playEmbed")).toEqual([connector]);
  });

  it("duplicate registration is rejected (stable ids)", async () => {
    const registry = new ConnectorRegistry();
    registry.register(createReferenceConnector());
    expect(() => registry.register(createReferenceConnector())).toThrow(
      DuplicateConnectorError,
    );
  });
});
