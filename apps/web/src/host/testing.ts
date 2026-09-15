/**
 * @wfx/app-web — host test seams (WFX-CI-FIX, Task W2-D).
 *
 * TEST-ONLY — NEVER IMPORT FROM A PRODUCTION PATH.
 *
 * The experience host owns exactly two PROCESS-LIFETIME state seams (both
 * documented stopgaps, both deliberate):
 * - `host/watch-state.ts` — the per-user recorded-events buffer (ring of
 *   512) the home/detail surfaces fold into continue-watching rows;
 * - `host/canon.ts` — the source-identity → canonical-item join map plus
 *   its sequential mint counter.
 *
 * WHY THIS MODULE EXISTS. bun:test runs test files grouped into worker
 * PROCESSES, and the grouping varies with the machine (the lead's 2-core
 * sandbox grouped differently than GitHub's 4-core ubuntu runner). When
 * several apps/web test files share one process, the watch-state events
 * they record and the canonical ids they mint accumulate in that shared
 * process state — so a later file's ABSOLUTE-count assertions (one start
 * event, one continue entry, one queue, one joined id) answer with the
 * earlier files' leftovers. That made `bun test` machine-dependent: green
 * locally, red on CI (run 35012781915, commit dcc85f6 —
 * `home-surface.test.ts:184` expected 1 start event, received 5).
 *
 * `resetExperienceHostProcessState()` restores the pristine process state
 * — empty buffer, empty join map, counter at zero — so every test starts
 * from the same baseline NO MATTER which files ran before it in the same
 * process. Call it from `beforeEach` in every apps/web test file whose
 * assertions are sensitive to these seams (surfaces reading
 * `recordedWatchEvents` / `recordedWatchStates` / continue entries /
 * up-next queues / joined identities).
 *
 * LAWS:
 * - This reset is a TEST SEAM, following the repo's testing-export
 *   convention (`@wfx/connectors` `src/testing.ts`): a dedicated,
 *   loudly-documented module. It MUST NOT be called by any production
 *   path — grep-provable: the only import sites are apps/web tests.
 * - It is deliberately NOT re-exported through `host/index.ts` (the boot
 *   barrel a request path imports): unlike the connectors LIBRARY — whose
 *   fixtures other packages import through the package barrel — this
 *   reset is consumed only by this package's own tests, so it stays out
 *   of the app's boot surface entirely (minimal public surface).
 * - The narrow per-module resets (`resetWatchStateRecordingForTests`,
 *   `resetCanonicalItemJoinForTests`) are consumed ONLY here — tests
 *   import the one composed seam, never the module privates.
 * - Production behavior is untouched: the per-process laws of both stopgap
 *   modules (documented in their headers) stand unchanged.
 */

import { resetCanonicalItemJoinForTests } from "./canon";
import { resetWatchStateRecordingForTests } from "./watch-state";

/**
 * Reset the experience host's PROCESS-LIFETIME state to pristine: the
 * recorded watch-state events buffer (every user) and the canonical-identity
 * join map + mint counter. TEST-ONLY — see the module doc.
 */
export function resetExperienceHostProcessState(): void {
  resetWatchStateRecordingForTests();
  resetCanonicalItemJoinForTests();
}
