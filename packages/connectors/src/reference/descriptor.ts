/**
 * @wfx/connectors — the reference connector's descriptor (WFX-013, Lane B).
 *
 * The descriptor is the reference connector's identity card and the single
 * source of capability truth (docs/architecture/product-boundaries.md:
 * "Connectors must declare actual capabilities. Unsupported operations
 * return typed unsupported results. UI availability never implies provider
 * support.").
 *
 * The capability set is DELIBERATELY read-only:
 * - DECLARED: catalogSearch, metadata, playEmbed, playBrowser, playExternal,
 *   availability, libraryRead.
 * - NOT DECLARED (and therefore answered with typed `unsupported` results by
 *   the WFX-003 result surface): playNative (the fixture source has no native
 *   media — see docs/architecture/product-boundaries.md "Native media"),
 *   libraryWrite, like, save, follow, comment, download, transform, identity.
 *
 * `auth: "none"` — the reference source is fixture data with no provider, so
 * there is nothing to authenticate against.
 *
 * The descriptor object is built through the SDK's strict `defineDescriptor`
 * validation at module load, so an invalid reference descriptor fails loudly
 * at import time instead of drifting silently.
 */

import type { Capability, ConnectorDescriptor } from "@wfx/domain";

import { defineDescriptor } from "../descriptor";

/** Stable id of the reference connector. */
export const REFERENCE_CONNECTOR_ID = "wfx-reference";

/**
 * The exact capability set of the reference connector.
 *
 * Order mirrors the frozen `Capability` union (see descriptor.ts in the SDK
 * root). The set is read-only by design: every mutating capability
 * (libraryWrite, like, save, follow, comment, download, transform) is
 * deliberately absent so the WFX-003 capability gate answers those
 * operations with typed `unsupported` errors — never a fake success.
 */
export const REFERENCE_CONNECTOR_CAPABILITIES: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "availability",
  "libraryRead",
] as const;

/**
 * The validated, deep-frozen descriptor of the reference connector.
 *
 * Constructed through the SDK's public `defineDescriptor` (strict validation
 * + freeze), never hand-rolled: the reference connector demonstrates the
 * golden path, and the golden path validates its descriptor through the SDK.
 */
export const REFERENCE_CONNECTOR_DESCRIPTOR: ConnectorDescriptor = defineDescriptor({
  id: REFERENCE_CONNECTOR_ID,
  version: "0.1.0",
  displayName: "WebFlix Reference Source",
  capabilities: [...REFERENCE_CONNECTOR_CAPABILITIES],
  auth: "none",
});
