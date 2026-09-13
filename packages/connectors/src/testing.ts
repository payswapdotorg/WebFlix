/**
 * @wfx/connectors — test fixtures (WFX-003).
 *
 * TEST FIXTURES ONLY — NEVER REGISTER AS A PRODUCTION SOURCE.
 *
 * `makeStubConnector()` builds an in-memory connector on `BaseConnector`
 * with a deliberately LIMITED capability set (`catalogSearch`, `metadata`,
 * `playEmbed` — nothing else) so unsupported paths are deterministically
 * testable: every action/library/other-play operation answers a typed
 * `unsupported` result without any network or provider SDK. Canned results
 * are returned for search/metadata/resolve.
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  PlaybackRealization,
  SearchResult,
  SourceItem,
} from "@wfx/domain";

import { BaseConnector, type AsyncConnectorResultInput } from "./base";

/** Stable id of the stub connector fixture. */
export const STUB_CONNECTOR_ID = "stub-test";

/** Capabilities the stub declares — intentionally limited (see module docs). */
export const STUB_CAPABILITIES: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playEmbed",
];

/** Canned search results returned by the stub (overridable). */
export const STUB_DEFAULT_SEARCH_RESULTS: readonly SearchResult[] = [
  {
    connectorId: STUB_CONNECTOR_ID,
    externalRef: "stub:1",
    title: "Stub Result One",
    canonicalType: "video",
    durationMs: 60_000,
  },
  {
    connectorId: STUB_CONNECTOR_ID,
    externalRef: "stub:2",
    title: "Stub Result Two",
    canonicalType: "short",
  },
];

/** Canned metadata for `stub:1` (overridable via `metadataByRef`). */
export const STUB_DEFAULT_METADATA: SourceItem = {
  connectorId: STUB_CONNECTOR_ID,
  externalRef: "stub:1",
  title: "Stub Result One",
  canonicalType: "video",
  durationMs: 60_000,
  availability: "available",
  capabilities: ["playEmbed"],
};

/** Canned playback realizations (embed mode, matching the declared playEmbed). */
export const STUB_DEFAULT_REALIZATIONS: readonly PlaybackRealization[] = [
  {
    mode: "embed",
    connectorId: STUB_CONNECTOR_ID,
    url: "https://example.invalid/embed/stub-1",
    externalRef: "stub:1",
    capabilities: ["playEmbed"],
  },
];

/** Overrides for the stub's canned data. */
export interface StubConnectorOverrides {
  /** Replaces the canned search results. */
  searchResults?: SearchResult[];
  /** Per-ref metadata; `null` values model explicit "not found". */
  metadataByRef?: Record<string, SourceItem | null>;
  /** Replaces the canned playback realizations. */
  realizations?: PlaybackRealization[];
}

/**
 * The stub connector TEST FIXTURE.
 *
 * In-memory, offline, limited to `catalogSearch | metadata | playEmbed`.
 * `executeAction` / `readLibrary` / `writeLibrary` are unsupported BY
 * DESIGN (undeclared capabilities) — that is the point of the fixture.
 */
export class StubTestConnector extends BaseConnector {
  /** Brand: this object is a test fixture, never a production source. */
  public static readonly isTestFixture = true as const;
  public readonly isTestFixture = true as const;

  private readonly stubSearchResults: readonly SearchResult[];
  private readonly stubMetadataByRef: Record<string, SourceItem | null>;
  private readonly stubRealizations: readonly PlaybackRealization[];

  constructor(overrides: StubConnectorOverrides = {}) {
    super({
      id: STUB_CONNECTOR_ID,
      version: "0.1.0",
      displayName: "Stub Test Connector (TEST FIXTURE — never production)",
      capabilities: [...STUB_CAPABILITIES],
      auth: "none",
    });
    this.stubSearchResults = overrides.searchResults ?? STUB_DEFAULT_SEARCH_RESULTS;
    this.stubMetadataByRef = overrides.metadataByRef ?? { "stub:1": STUB_DEFAULT_METADATA };
    this.stubRealizations = overrides.realizations ?? STUB_DEFAULT_REALIZATIONS;
  }

  protected override onSearch(): AsyncConnectorResultInput<SearchResult[]> {
    // Canned: the same results for every query, by design.
    return [...this.stubSearchResults];
  }

  protected override onMetadata(
    _ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<SourceItem | null> {
    return this.stubMetadataByRef[ref] ?? null;
  }

  protected override onResolve(): AsyncConnectorResultInput<PlaybackRealization[]> {
    return [...this.stubRealizations];
  }

  protected override onExecuteAction(): AsyncConnectorResultInput<ActionReceipt> {
    // Unreachable in practice: the stub declares no action capability, so
    // the result surface answers `unsupported` before this hook runs.
    // Kept explicit so the fixture's limits are self-documenting.
    return {
      kind: "unsupported",
      capability: "like",
      detail: "stub-test declares no action capabilities",
    };
  }
}

/**
 * Create the stub connector TEST FIXTURE (id `stub-test`).
 * Returned in the `registered` state — call `initialize()` before use, to
 * exercise the real lifecycle. NEVER register as a production source.
 */
export function makeStubConnector(overrides?: StubConnectorOverrides): StubTestConnector {
  return new StubTestConnector(overrides);
}
