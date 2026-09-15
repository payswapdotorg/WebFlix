/**
 * Telemetry barrel (WFX-041, Lane A — intelligence).
 *
 * - metrics.ts:   the typed metric units (QoE, recommendation, engagement)
 *                 + provenance + the injected clock + the typed error.
 * - derive.ts:    pure derivation from the merged artifacts (playback
 *                 session trails, WFX-021 feed pages, engagement events)
 *                 with typed degraded markers for absent fields.
 * - aggregate.ts: pure windowed aggregation (merge-safe max-merge, canonical
 *                 order, deterministic percentile + bounded sketch).
 * - redact.ts:    privacy redaction levels (full/internal/shared) with the
 *                 auditable RedactionReport.
 * - sink.ts:      the TelemetrySink port, the in-memory recorder sink, and
 *                 the schema-versioned telemetry report.
 */
export * from "./metrics";
export * from "./derive";
export * from "./aggregate";
export * from "./redact";
export * from "./sink";
