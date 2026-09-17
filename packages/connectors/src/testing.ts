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
import { defineAuthFlow, type AuthFlow } from "./auth/flows";

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

// ---------------------------------------------------------------------------
// R03 — stub AUTH fixtures (test-only; never production sources)
// ---------------------------------------------------------------------------

/**
 * The auth kinds the stub auth fixtures cover (the three COMPLETABLE kinds —
 * `none` is covered by {@link makeStubConnector}).
 */
export type StubAuthKind = "oauth" | "device" | "local";

/** Stable ids of the stub auth fixtures (distinct from `stub-test`). */
export const STUB_OAUTH_CONNECTOR_ID = "stub-oauth";
export const STUB_DEVICE_CONNECTOR_ID = "stub-device";
export const STUB_LOCAL_CONNECTOR_ID = "stub-local";

/** The stub auth fixtures' capability set — minimal, like the base stub's. */
const STUB_AUTH_CAPABILITIES: readonly Capability[] = ["catalogSearch", "metadata"];

/** The stub oauth fixture's documented authorization endpoint shape. */
export const STUB_OAUTH_AUTHORIZATION_URL_TEMPLATE =
  "https://stub.example/oauth/authorize?client_id={clientId}&response_type=code&redirect_uri={redirectUri}&state={state}";

/** The stub device fixture's documented verification endpoint shape. */
export const STUB_DEVICE_VERIFICATION_URL_TEMPLATE =
  "https://stub.example/device/activate?code={code}";

/**
 * The auth-flow details for each stub auth fixture — the wiring shape hosts
 * hand a `ConnectorAuthService` (or the R03 source-management service) for
 * these connectors. Templates point at the RESERVED `.example` TLD: no real
 * provider, no invented real endpoints.
 */
export function stubAuthFlowDetails(kind: StubAuthKind): AuthFlow {
  switch (kind) {
    case "oauth":
      return defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: STUB_OAUTH_AUTHORIZATION_URL_TEMPLATE,
        scopes: ["stub.read"],
        tokenRefresh: false,
      });
    case "device":
      return defineAuthFlow({
        kind: "device",
        verificationUrlTemplate: STUB_DEVICE_VERIFICATION_URL_TEMPLATE,
        pollIntervalSeconds: 5,
      });
    case "local":
      return defineAuthFlow({ kind: "local", method: "token" });
  }
}

/**
 * A stub connector TEST FIXTURE with a configurable AUTH MODE — the R03
 * source-management lanes exercise begin/complete/disconnect per flow kind
 * without any network. Same limited capabilities as the base stub; the auth
 * mode is the ONLY difference.
 */
export class StubAuthTestConnector extends BaseConnector {
  /** Brand: this object is a test fixture, never a production source. */
  public static readonly isTestFixture = true as const;
  public readonly isTestFixture = true as const;

  constructor(input: { readonly auth: StubAuthKind; readonly id?: string }) {
    super({
      id: input.id ?? stubAuthConnectorId(input.auth),
      version: "0.1.0",
      displayName: `Stub ${input.auth} Auth Connector (TEST FIXTURE — never production)`,
      capabilities: [...STUB_AUTH_CAPABILITIES],
      auth: input.auth,
    });
  }

  protected override onSearch(): AsyncConnectorResultInput<SearchResult[]> {
    return [...STUB_DEFAULT_SEARCH_RESULTS];
  }

  protected override onMetadata(
    _ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<SourceItem | null> {
    return this.stubMetadataByRef[ref] ?? null;
  }

  protected override onResolve(): AsyncConnectorResultInput<PlaybackRealization[]> {
    return [...STUB_DEFAULT_REALIZATIONS];
  }

  protected override onExecuteAction(): AsyncConnectorResultInput<ActionReceipt> {
    // Unreachable in practice: the stub declares no action capability.
    return {
      kind: "unsupported",
      capability: "like",
      detail: "the stub auth fixtures declare no action capabilities",
    };
  }

  private readonly stubMetadataByRef: Record<string, SourceItem | null> = {
    "stub:1": STUB_DEFAULT_METADATA,
  };
}

/** The canonical id of the stub auth fixture for a kind. */
export function stubAuthConnectorId(kind: StubAuthKind): string {
  switch (kind) {
    case "oauth":
      return STUB_OAUTH_CONNECTOR_ID;
    case "device":
      return STUB_DEVICE_CONNECTOR_ID;
    case "local":
      return STUB_LOCAL_CONNECTOR_ID;
  }
}

/**
 * Create a stub AUTH connector TEST FIXTURE (`stub-oauth` / `stub-device` /
 * `stub-local` by kind). Returned in the `registered` state. NEVER register
 * as a production source.
 */
export function makeStubAuthConnector(
  kind: StubAuthKind,
  options: { readonly id?: string } = {},
): StubAuthTestConnector {
  return new StubAuthTestConnector({ auth: kind, ...(options.id !== undefined ? { id: options.id } : {}) });
}
