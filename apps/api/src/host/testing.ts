/**
 * @wfx/app-api — host test seams (WFX-055A, slice 3).
 *
 * TEST-ONLY — NEVER IMPORT FROM A PRODUCTION PATH.
 *
 * The service host owns exactly ONE process-lifetime state seam: the
 * `getApiBoot()` singleton slot (`host/boot.ts`) every route handler awaits.
 * Route handlers read `process.env` through that boot, so tests cannot rely
 * on the natural path (it would open a REAL postgres connection); they need
 * explicit, per-test control of the slot.
 *
 * This module mirrors the WFX-CI-FIX precedent (`apps/web/src/host/testing.ts`):
 * a dedicated, loudly-documented module composing the narrow per-module
 * control (`setBootSlotForTests`, exported from `host/boot.ts` exactly like
 * `watch-state.ts` exported `resetWatchStateRecordingForTests`) into the
 * seams tests consume:
 *
 * - `setApiBootForTests(boot)` — install a booted composition (tests inject
 *   a PGlite-backed `ApiBoot` built with the SAME migrations and the SAME
 *   real adapters — see `tests/test-boot.ts`).
 * - `failApiBootForTests(reason)` — install a FAILING boot (the slot holds a
 *   rejected promise), so route handlers exercise their boot-failure
 *   classification (loud 500 for config crimes, honest degradation answers
 *   for the 052 degradation family) without touching `process.env`.
 * - `resetApiBootForTests()` — restore natural behavior (the next
 *   `getApiBoot()` boots from `process.env`; used by the boot-env-law tests
 *   with a scrubbed environment).
 *
 * LAWS (mirroring the CI-FIX precedent):
 * - These are TEST SEAMS, following the repo's testing-export convention:
 *   a dedicated, loudly-documented module. They MUST NOT be called by any
 *   production path — grep-provable: the only import sites of this file are
 *   apps/api tests.
 * - Deliberately NOT re-exported through `src/index.ts` (the package barrel
 *   a consumer might import): this reset is consumed only by this package's
 *   own tests, so it stays out of the service's public surface entirely.
 * - Production behavior is untouched: the singleton law of `host/boot.ts`
 *   stands unchanged; the slot is only ever written here or by `getApiBoot`
 *   itself.
 */

import type { ApiBoot } from "./boot";
import { setBootSlotForTests } from "./boot";

/**
 * Install a booted service composition as the singleton every route handler
 * sees. `null` (or {@link resetApiBootForTests}) restores natural behavior.
 * TEST-ONLY — see the module doc.
 */
export function setApiBootForTests(boot: ApiBoot | null): void {
  setBootSlotForTests(boot === null ? null : Promise.resolve(boot));
}

/**
 * Install a FAILING boot: every `getApiBoot()` caller observes the given
 * rejection, exactly as a failed natural boot would surface it. TEST-ONLY —
 * see the module doc.
 */
export function failApiBootForTests(reason: unknown): void {
  const failing = Promise.reject(reason);
  // Mark the rejection as handled so an injected failure nobody awaits can
  // never surface as a spurious unhandled rejection; route handlers that DO
  // await the boot still observe the rejection itself.
  failing.catch(() => {});
  setBootSlotForTests(failing);
}

/**
 * Restore natural boot behavior: the next `getApiBoot()` call boots from
 * `process.env` (throwing the typed config/degradation failures when the
 * environment cannot boot the service). TEST-ONLY — see the module doc.
 */
export function resetApiBootForTests(): void {
  setBootSlotForTests(null);
}
