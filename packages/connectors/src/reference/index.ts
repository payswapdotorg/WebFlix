/**
 * @wfx/connectors — the reference read-only connector barrel (WFX-013, Lane B).
 *
 * The golden-path reference implementation of the Connector SDK: a complete,
 * deterministic, read-only connector over bundled fixture data. New connector
 * authors should read these modules as the canonical example:
 * - descriptor.ts     — the honest, read-only capability declaration
 * - data.ts           — the offline fixture catalog + tokenized search index
 * - connector.ts      — `ReferenceConnector` (BaseConnector subclass) and
 *                       `createReferenceConnector()`
 * - lifecycle-demo.ts — pure FSM demonstration (created → initialized →
 *                       disposed, with the SDK's error-channel split on show)
 */

export * from "./descriptor";
export * from "./data";
export * from "./connector";
export * from "./lifecycle-demo";
