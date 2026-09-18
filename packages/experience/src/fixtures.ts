/**
 * @wfx/experience — deterministic fixtures (WFX-005, Lane C).
 *
 * TEST FIXTURES ONLY — never a production source (product invariant 10: no
 * hidden mocks; "Capability truth" in product-boundaries.md).
 *
 * Everything here is DETERMINISTIC: NO randomness, no `Date.now()`, no
 * `crypto`. The clock starts at a fixed instant, the id generator is a
 * zero-padded sequential counter producing VALID canonical ULID bodies
 * (decimal digits are a subset of the Crockford Base32 alphabet, and the
 * first char stays within `[0-7]` for any realistic counter), and the fake
 * connector answers from an in-memory catalog. Two freshly-built fixture
 * bundles driven by the same call sequence produce byte-identical output.
 *
 * The fake connector mirrors the WFX-003 BaseConnector semantics on the
 * frozen plain surface: undeclared capabilities degrade search to `[]`,
 * metadata to `null`, actions to `status: "unsupported"` receipts, library
 * reads to `[]` — and `resolve()` only returns realizations whose mode
 * matches a DECLARED play capability. It is therefore an honest stand-in
 * for the SDK's degradation map without importing @wfx/connectors.
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  EntertainmentEvent,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
} from "@wfx/domain";
import { isRecord } from "@wfx/domain";

import { USER_ACTION_TYPES } from "./use-cases/actions";
import type { Clock, ConnectorPort, EventSink, IdGen, Ports } from "./ports";

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------

/** Stable connector id of the fake source. */
export const FIXTURE_CONNECTOR_ID = "fake-source";

/** The one timestamp the fixtures ever produce (the frozen-architecture date). */
export const FIXTURE_OCCURRED_AT = "2026-09-13T00:00:00.000Z";

/** Epoch milliseconds of `FIXTURE_OCCURRED_AT` — the default fixed-clock start. */
export const FIXTURE_CLOCK_START_MS = Date.UTC(2026, 8, 13); // month is 0-based: 8 = September

/** Capabilities the default fake connector declares (a rich but explicit set). */
export const FIXTURE_CAPABILITIES: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
];

// ---------------------------------------------------------------------------
// Catalog fixture
// ---------------------------------------------------------------------------

/** One in-memory catalog item of the fake connector. */
export interface FakeCatalogItem {
  externalRef: string;
  title: string;
  /**
   * Canonical type reported by search/metadata. Optional so tests can model
   * hits WITHOUT a canonical classification (the feed drops those — no
   * fabricated cards).
   */
  canonicalType?:
    | "movie"
    | "series"
    | "episode"
    | "video"
    | "short"
    | "post"
    | "audio";
  durationMs?: number;
  orientation?: "horizontal" | "vertical" | "square" | "unknown";
  availability: "available" | "unknown" | "unavailable";
  /** Per-item capabilities reported through `metadata()` (subset of declared). */
  itemCapabilities: Capability[];
  /** Realizations returned by `resolve()` (modes must match declared play capabilities). */
  realizations: readonly PlaybackRealization[];
  /**
   * `false` models "search hit without metadata" — `metadata()` answers
   * `null` for this ref (the connector-level capability fallback path).
   */
  includeMetadata?: boolean;
}

/**
 * The default catalog. Deterministic order; realizations are deliberately
 * NOT in precedence order so precedence-based picking is observable; the
 * titles "…Rain…" cross surfaces so one query can split watch/short feeds.
 */
export const FIXTURE_CATALOG: readonly FakeCatalogItem[] = [
  {
    externalRef: "fake:movie-1",
    title: "Asteroid Drift",
    canonicalType: "movie",
    durationMs: 7_200_000,
    orientation: "horizontal",
    availability: "available",
    itemCapabilities: ["playNative", "playEmbed", "playBrowser", "playExternal"],
    realizations: [
      {
        mode: "browser",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        url: "https://fixture.invalid/watch/fake:movie-1",
        capabilities: ["playBrowser"],
      },
      {
        mode: "native",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        capabilities: ["playNative"],
      },
      {
        mode: "external",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        capabilities: ["playExternal"],
      },
      {
        mode: "embed",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        url: "https://fixture.invalid/embed/fake:movie-1",
        capabilities: ["playEmbed"],
      },
    ],
  },
  {
    externalRef: "fake:series-1",
    title: "Harbor Lights",
    canonicalType: "series",
    orientation: "horizontal",
    availability: "available",
    itemCapabilities: ["playEmbed"],
    realizations: [
      {
        mode: "embed",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:series-1",
        url: "https://fixture.invalid/embed/fake:series-1",
        capabilities: ["playEmbed"],
      },
    ],
  },
  {
    externalRef: "fake:short-1",
    title: "Neon Rain",
    canonicalType: "short",
    durationMs: 45_000,
    orientation: "vertical",
    availability: "available",
    itemCapabilities: ["playNative", "playEmbed"],
    realizations: [
      {
        mode: "embed",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:short-1",
        url: "https://fixture.invalid/embed/fake:short-1",
        capabilities: ["playEmbed"],
      },
      {
        mode: "native",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:short-1",
        capabilities: ["playNative"],
      },
    ],
  },
  {
    externalRef: "fake:short-2",
    title: "Midnight Scoop",
    canonicalType: "video",
    durationMs: 90_000,
    orientation: "vertical",
    availability: "available",
    itemCapabilities: ["playEmbed"],
    realizations: [
      {
        mode: "embed",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:short-2",
        url: "https://fixture.invalid/embed/fake:short-2",
        capabilities: ["playEmbed"],
      },
    ],
  },
  {
    externalRef: "fake:video-1",
    title: "Deep Field Diary",
    canonicalType: "video",
    durationMs: 1_800_000,
    orientation: "horizontal",
    availability: "available",
    itemCapabilities: ["playBrowser", "playExternal"],
    realizations: [
      {
        mode: "browser",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:video-1",
        url: "https://fixture.invalid/watch/fake:video-1",
        capabilities: ["playBrowser"],
      },
      {
        mode: "external",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:video-1",
        capabilities: ["playExternal"],
      },
    ],
  },
  {
    // Search hit WITHOUT metadata: the feed must fall back to connector-level
    // capability truth with availability "unknown" — never fabricate a card.
    externalRef: "fake:video-2",
    title: "Static Bloom",
    canonicalType: "video",
    durationMs: 600_000,
    orientation: "unknown",
    availability: "available",
    itemCapabilities: [],
    realizations: [
      {
        mode: "browser",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:video-2",
        url: "https://fixture.invalid/watch/fake:video-2",
        capabilities: ["playBrowser"],
      },
    ],
    includeMetadata: false,
  },
  {
    externalRef: "fake:short-3",
    title: "Rain Check",
    canonicalType: "short",
    durationMs: 30_000,
    orientation: "vertical",
    availability: "available",
    itemCapabilities: ["playEmbed"],
    realizations: [
      {
        mode: "embed",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:short-3",
        url: "https://fixture.invalid/embed/fake:short-3",
        capabilities: ["playEmbed"],
      },
    ],
  },
  {
    externalRef: "fake:video-3",
    title: "Desert Rain Doc",
    canonicalType: "video",
    durationMs: 2_400_000,
    orientation: "horizontal",
    availability: "available",
    itemCapabilities: ["playEmbed"],
    realizations: [
      {
        mode: "embed",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:video-3",
        url: "https://fixture.invalid/embed/fake:video-3",
        capabilities: ["playEmbed"],
      },
    ],
  },
  {
    // R17 network-loss scripted item (Static Bloom's drive): metadata-
    // bearing + acquisition-capable (browser + native realizations) so the
    // ITEM PAGE mounts the acquisition panel. The no-metadata law stays
    // with fake:video-2 ("Static Bloom") — the frozen fixture entry other
    // tests rely on (incl. the single-card "bloom" feed fallback); this
    // distinct, query-collision-free title keeps both searches honest.
    externalRef: "fake:video-4",
    title: "Signal Fade",
    canonicalType: "video",
    durationMs: 600_000,
    orientation: "horizontal",
    availability: "available",
    itemCapabilities: ["playNative", "playBrowser"],
    realizations: [
      {
        mode: "browser",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:video-4",
        url: "https://fixture.invalid/watch/fake:video-4",
        capabilities: ["playBrowser"],
      },
      {
        mode: "native",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:video-4",
        capabilities: ["playNative"],
      },
    ],
  },
];

/** The default seeded connector-side library. */
export const FIXTURE_LIBRARY: readonly LibraryEntry[] = [
  {
    connectorId: FIXTURE_CONNECTOR_ID,
    externalRef: "fake:movie-1",
    title: "Asteroid Drift",
    addedAt: FIXTURE_OCCURRED_AT,
  },
  {
    connectorId: FIXTURE_CONNECTOR_ID,
    externalRef: "fake:short-1",
    title: "Neon Rain",
    addedAt: FIXTURE_OCCURRED_AT,
  },
];

/** Overrides for `FakeConnectorPort` / `makeFixturePorts`. */
export interface FakeConnectorOverrides {
  /** Replaces the default capability set (the descriptor truth). */
  capabilities?: readonly Capability[];
  /** Replaces the default catalog. */
  items?: readonly FakeCatalogItem[];
  /** Replaces the seeded library. */
  library?: readonly LibraryEntry[];
}

/** The play capability that must be declared for each playback mode. */
const PLAY_CAPABILITY_FOR_MODE: Readonly<Record<PlaybackRealization["mode"], Capability>> = {
  native: "playNative",
  embed: "playEmbed",
  browser: "playBrowser",
  external: "playExternal",
};

// ---------------------------------------------------------------------------
// FakeConnectorPort
// ---------------------------------------------------------------------------

/**
 * The fake `ConnectorPort` — an in-memory source with items, realizations,
 * library, and actions. Honest about capabilities: undeclared operations
 * degrade exactly like the WFX-003 SDK's plain surface, and `resolve()`
 * only ever returns realizations whose mode matches a declared play
 * capability. TEST FIXTURE — never a production source.
 */
export class FakeConnectorPort implements ConnectorPort {
  private readonly catalog: readonly FakeCatalogItem[];
  private readonly declared: readonly Capability[];
  private readonly library: Map<string, LibraryEntry>;
  private readonly likes = new Set<string>();
  private readonly saves = new Set<string>();
  private readonly follows = new Set<string>();
  private receiptCounter = 0;

  constructor(overrides: FakeConnectorOverrides = {}) {
    this.declared = [...(overrides.capabilities ?? FIXTURE_CAPABILITIES)];
    this.catalog = [...(overrides.items ?? FIXTURE_CATALOG)];
    this.library = new Map(
      (overrides.library ?? FIXTURE_LIBRARY).map((entry) => [entry.externalRef, { ...entry }]),
    );
  }

  descriptor() {
    return {
      id: FIXTURE_CONNECTOR_ID,
      version: "0.1.0",
      displayName: "Fake Source (TEST FIXTURE — never production)",
      capabilities: [...this.declared],
      auth: "none" as const,
    };
  }

  async search(_ctx: ConnectorContext, query: string): Promise<SearchResult[]> {
    if (!this.declared.includes("catalogSearch")) return []; // SDK degrade map
    if (typeof query !== "string" || query.trim().length === 0) return [];
    const needle = query.trim().toLowerCase();
    return this.catalog
      .filter((item) => item.title.toLowerCase().includes(needle))
      .map((item) => {
        const result: SearchResult = {
          connectorId: FIXTURE_CONNECTOR_ID,
          externalRef: item.externalRef,
          title: item.title,
        };
        if (item.canonicalType !== undefined) result.canonicalType = item.canonicalType;
        if (item.durationMs !== undefined) result.durationMs = item.durationMs;
        if (item.orientation !== undefined) result.orientation = item.orientation;
        return result;
      });
  }

  async metadata(_ctx: ConnectorContext, ref: string): Promise<SourceItem | null> {
    if (!this.declared.includes("metadata")) return null; // SDK degrade map
    const item = this.catalog.find((entry) => entry.externalRef === ref);
    if (item === undefined || item.includeMetadata === false) return null;
    const source: SourceItem = {
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: item.externalRef,
      title: item.title,
      availability: item.availability,
      capabilities: [...item.itemCapabilities],
    };
    if (item.canonicalType !== undefined) source.canonicalType = item.canonicalType;
    if (item.durationMs !== undefined) source.durationMs = item.durationMs;
    if (item.orientation !== undefined) source.orientation = item.orientation;
    return source;
  }

  async resolve(_ctx: ConnectorContext, ref: string): Promise<PlaybackRealization[]> {
    const item = this.catalog.find((entry) => entry.externalRef === ref);
    if (item === undefined) return [];
    // Only realizations whose mode matches a DECLARED play capability —
    // the same law the WFX-003 SDK imposes on concrete connectors.
    return item.realizations
      .filter((realization) => this.declared.includes(PLAY_CAPABILITY_FOR_MODE[realization.mode]))
      .map((realization) => ({ ...realization }));
  }

  async executeAction(_ctx: ConnectorContext, action: unknown): Promise<ActionReceipt> {
    if (!isRecord(action) || typeof action.type !== "string") {
      return this.failed("action: expected a UserAction object");
    }
    if (action.connectorId !== FIXTURE_CONNECTOR_ID) {
      return this.failed(
        `action targets connector '${String(action.connectorId)}' but was sent to '${FIXTURE_CONNECTOR_ID}'`,
      );
    }
    if (!USER_ACTION_TYPES.includes(action.type as (typeof USER_ACTION_TYPES)[number])) {
      return this.failed(`action.type '${String(action.type)}' is not a UserAction type`);
    }
    const type = action.type as (typeof USER_ACTION_TYPES)[number];
    if (!this.declared.includes(type)) {
      return {
        status: "unsupported",
        detail: `capability '${type}' is not declared by '${FIXTURE_CONNECTOR_ID}'`,
        occurredAt: FIXTURE_OCCURRED_AT,
      };
    }
    const ref = action.externalRef;
    if (typeof ref !== "string" || ref.length === 0) {
      return this.failed("action.externalRef: expected a non-empty string");
    }
    switch (type) {
      case "like":
        this.likes.add(ref);
        break;
      case "save":
        this.saves.add(ref);
        break;
      case "follow":
        this.follows.add(ref);
        break;
      default:
        return this.failed(`fixture does not implement '${type}' actions`);
    }
    return this.confirmed();
  }

  async readLibrary(_ctx: ConnectorContext): Promise<LibraryEntry[]> {
    if (!this.declared.includes("libraryRead")) return []; // SDK degrade map
    return [...this.library.values()].map((entry) => ({ ...entry }));
  }

  async writeLibrary(_ctx: ConnectorContext, command: unknown): Promise<ActionReceipt> {
    if (!this.declared.includes("libraryWrite")) {
      return {
        status: "unsupported",
        detail: `capability 'libraryWrite' is not declared by '${FIXTURE_CONNECTOR_ID}'`,
        occurredAt: FIXTURE_OCCURRED_AT,
      };
    }
    if (!isRecord(command) || (command.op !== "add" && command.op !== "remove")) {
      return this.failed("command.op: expected 'add' or 'remove'");
    }
    const ref = command.externalRef;
    if (typeof ref !== "string" || ref.length === 0) {
      return this.failed("command.externalRef: expected a non-empty string");
    }
    if (command.op === "add") {
      const entry: LibraryEntry = {
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: ref,
        title: typeof command.title === "string" ? command.title : ref,
        addedAt: FIXTURE_OCCURRED_AT,
      };
      if (command.metadata !== undefined && isRecord(command.metadata)) {
        entry.metadata = { ...command.metadata };
      }
      this.library.set(ref, entry);
    } else {
      this.library.delete(ref);
    }
    return this.confirmed();
  }

  // --- fixture state inspection (for test assertions) ----------------------

  /** External refs that received a confirmed `like` action, in insertion order. */
  recordedLikes(): readonly string[] {
    return [...this.likes];
  }

  /** External refs that received a confirmed `save` action, in insertion order. */
  recordedSaves(): readonly string[] {
    return [...this.saves];
  }

  /** External refs that received a confirmed `follow` action, in insertion order. */
  recordedFollows(): readonly string[] {
    return [...this.follows];
  }

  /** The current connector-side library (fixture state). */
  libraryEntries(): readonly LibraryEntry[] {
    return [...this.library.values()].map((entry) => ({ ...entry }));
  }

  // --- internals --------------------------------------------------------------

  private confirmed(): ActionReceipt {
    this.receiptCounter += 1;
    return {
      status: "confirmed",
      externalId: `fake-act-${String(this.receiptCounter).padStart(6, "0")}`,
      occurredAt: FIXTURE_OCCURRED_AT,
    };
  }

  private failed(detail: string): ActionReceipt {
    return { status: "failed", detail, occurredAt: FIXTURE_OCCURRED_AT };
  }
}

// ---------------------------------------------------------------------------
// RecordingEventSink
// ---------------------------------------------------------------------------

/**
 * An `EventSink` that records every emitted event in order. Optionally
 * constructed with an error to throw on every emit (to test the documented
 * sink-failure propagation).
 */
export class RecordingEventSink implements EventSink {
  private readonly failure: Error | undefined;
  private readonly recorded: EntertainmentEvent[] = [];

  constructor(failure?: Error) {
    this.failure = failure;
  }

  emit(event: EntertainmentEvent): void {
    if (this.failure !== undefined) throw this.failure;
    this.recorded.push(event);
  }

  /** Every event emitted so far, in order. */
  get events(): readonly EntertainmentEvent[] {
    return this.recorded;
  }

  clear(): void {
    this.recorded.length = 0;
  }
}

// ---------------------------------------------------------------------------
// FixedClock
// ---------------------------------------------------------------------------

/**
 * A deterministic `Clock`: returns the constructor instant until `advance`
 * moves it. Negative advances are allowed (time travel is a test concern).
 */
export class FixedClock implements Clock {
  private current: number;

  constructor(start: number = FIXTURE_CLOCK_START_MS) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(deltaMs: number): void {
    this.current += deltaMs;
  }
}

// ---------------------------------------------------------------------------
// SequentialIdGen
// ---------------------------------------------------------------------------

/**
 * A deterministic `IdGen`: zero-padded decimal counter bodies. Every body is
 * a valid canonical ULID body (decimal digits are a subset of Crockford
 * Base32; the leading char stays in `[0-7]`). Bodies are unique, sequential,
 * and identical across two freshly-built fixtures — the property that makes
 * the whole shell reproducible.
 */
export class SequentialIdGen implements IdGen {
  private counter: number;

  constructor(start: number = 0) {
    this.counter = start;
  }

  next(): string {
    const body = String(this.counter).padStart(26, "0");
    this.counter += 1;
    return body;
  }
}

// ---------------------------------------------------------------------------
// The ports bundle
// ---------------------------------------------------------------------------

/** `Ports` with narrowed fixture members (so tests can inspect state). */
export interface FixturePorts extends Ports {
  connector: FakeConnectorPort;
  events: RecordingEventSink;
  clock: FixedClock;
  ids: SequentialIdGen;
}

/**
 * Build a full deterministic fixture bundle: the fake connector, a recording
 * sink, a fixed clock, and the sequential id generator.
 */
export function makeFixturePorts(connectorOverrides?: FakeConnectorOverrides): FixturePorts {
  return {
    connector: new FakeConnectorPort(connectorOverrides),
    events: new RecordingEventSink(),
    clock: new FixedClock(FIXTURE_CLOCK_START_MS),
    ids: new SequentialIdGen(),
  };
}
