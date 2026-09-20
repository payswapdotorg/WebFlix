/**
 * @wfx/domain — the BYOF feed lane (R20-A/R20-C, Worker 1).
 *
 * Runtime half of the frozen BYOF contracts (contracts/frozen.ts, generated
 * from docs/architecture/contracts.md "Bring Your Own Feed"):
 * - `model.ts`     — closed vocabularies, guards, the deterministic
 *                    idempotent import key, the sync-state fold, validators
 * - `reconcile.ts` — the PURE reconciliation engine (snapshot diff by
 *                    import key: add/update/remove/keep + dedupe) and the
 *                    frozen report fold
 */

export * from "./model";
export * from "./reconcile";
