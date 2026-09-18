/**
 * @wfx/actions — implementation governed by docs/plans/2026-09-13-webflix-implementation-plan.md
 *
 * WFX-022 — external action synchronization (Lane B): the transactional
 * outbox that mirrors user actions (like/save/follow/comment) to external
 * sources with idempotency, deterministic exponential-backoff retries, a
 * full audit log, and reporting-only reconciliation — WITHOUT real network
 * calls (drivers injected at the seam in sync/drivers.ts).
 *
 * Surface (import ONLY from "@wfx/actions"):
 * - sync/outbox.ts    — `ActionOutboxStore` (R15: THE store contract — the
 *                       in-memory and SQL-backed stores both implement it),
 *                       `ActionOutbox` (transactional in-memory record
 *                       store, idempotency keys, deterministic record ids),
 *                       `OutboxRecord`/`OutboxEntry`/`EnqueueResult`
 *                       (R15: `profileId` attribution), `OutboxFailureCause`,
 *                       typed error channels
 * - sync/drivers.ts   — `SyncDriver` (the execution seam),
 *                       `createConnectorDriver` (production adapter over
 *                       the SDK's `executeActionResult`; R15: the optional
 *                       profile-aware typed surface is preferred when the
 *                       request carries a profileId),
 *                       `createFixtureDriver` (deterministic TEST FIXTURE)
 * - sync/dispatch.ts  — `SyncDispatcher` (the durable worker: capability
 *                       gate, typed result mapping, retries with backoff,
 *                       attempts cap, superseded-claim race handling),
 *                       `SyncAuditLog` (the audit contract) + `SyncLog`
 *                       (the in-memory implementation), `TickReport`,
 *                       `RetryPolicy`
 * - sync/reconcile.ts — `reconcile` (drift REPORTING only — never
 *                       auto-mutates), `ReconciliationDrift`
 */

export * from "./sync/outbox";
export * from "./sync/drivers";
export * from "./sync/dispatch";
export * from "./sync/reconcile";
