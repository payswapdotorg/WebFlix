/**
 * @wfx/connectors — the Connector SDK public entry (WFX-003, Lane B).
 *
 * Surface (all re-exported here; import ONLY from "@wfx/connectors"):
 * - result.ts      — `ConnectorResult` / `ConnectorError` + constructors,
 *                    type guards, result helpers
 * - descriptor.ts  — `CAPABILITIES` truth constant, `defineDescriptor`
 *                    strict validation, `DescriptorValidationError`
 * - lifecycle.ts   — `ConnectorLifecycle` state machine,
 *                    `assertOperational`, `LifecycleError`
 * - base.ts        — `BaseConnector` (dual surface: typed result surface +
 *                    frozen-contract plain shims), `asyncResult`
 * - registry.ts    — `ConnectorRegistry`, `CapabilityMatrixRow`,
 *                    `DuplicateConnectorError`
 * - testing.ts     — TEST FIXTURES (`makeStubConnector`, `StubTestConnector`)
 *                    — never register as production sources
 * - auth/secrets.ts   — `CredentialVault`, `SecretHandle`,
 *                    `createInMemoryVault` (XOR-obfuscated, zero-on-delete;
 *                    PRODUCTION: back the interface with a real secret
 *                    manager)
 * - auth/session.ts   — `AuthSession` state machine (signedOut →
 *                    authorizing → signedIn, + expired/failed),
 *                    `AuthStateError`
 * - auth/flows.ts     — `AuthFlow` descriptors (none | oauth | device |
 *                    local), `defineAuthFlow`, `flowFor`
 * - auth/service.ts   — `ConnectorAuthService` (binds vault + sessions +
 *                    registry; typed `AuthResult` outcomes)
 *
 * Domain types (`Capability`, `SourceConnector`, `SearchResult`, ...) are
 * imported from `@wfx/domain`, the frozen public entry — never deep paths.
 *
 * Provider-specific connectors are OUT of scope here: this package is the
 * NEUTRAL SDK only (see docs/work-items: WFX-012/013 build on it).
 */

export * from "./result";
export * from "./descriptor";
export * from "./lifecycle";
export * from "./base";
export * from "./registry";
export * from "./testing";
export * from "./auth/secrets";
export * from "./auth/session";
export * from "./auth/flows";
export * from "./auth/service";
export * from "./reference";
// WFX-054: the first REAL provider connector. Same extension pattern as the
// WFX-013 reference connector — the barrel grows one export line; provider
// modules stay under their own directory with the SDK's laws enforced by
// BaseConnector exactly as for the reference implementation.
export * from "./youtube";
