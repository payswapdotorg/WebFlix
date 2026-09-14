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
 * - sync/outbox.ts    — `ActionOutbox` (transactional record store,
 *                       idempotency keys, deterministic record ids),
 *                       `OutboxRecord`/`OutboxEntry`/`EnqueueResult`,
 *                       `OutboxFailureCause`, typed error channels
 * - sync/drivers.ts   — `SyncDriver` (the execution seam),
 *                       `createConnectorDriver` (production adapter over
 *                       the SDK's `executeActionResult`),
 *                       `createFixtureDriver` (deterministic TEST FIXTURE)
 * - sync/dispatch.ts  — `SyncDispatcher` (the durable worker: capability
 *                       gate, typed result mapping, retries with backoff,
 *                       attempts cap), `SyncLog` (audit trail),
 *                       `TickReport`, `RetryPolicy`
 * - sync/reconcile.ts — `reconcile` (drift REPORTING only — never
 *                       auto-mutates), `ReconciliationDrift`
 */

export * from "./sync/outbox";
export * from "./sync/drivers";
export * from "./sync/dispatch";
export * from "./sync/reconcile";
