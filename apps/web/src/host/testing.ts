/**
 * @wfx/app-web — host test seams (R07; the WFX-CI-FIX law continues).
 *
 * TEST-ONLY — NEVER IMPORT FROM A PRODUCTION PATH.
 *
 * The R07 web host owns exactly the PROCESS-LIFETIME state seams tests
 * must reset for hermetic, machine-independent runs (bun:test groups
 * files into worker PROCESSES whose grouping varies with the machine —
 * the CI test-hermeticity law this module has always kept):
 * - `host/web-host.ts` — the ONE runtime boot promise (the singleton) +
 *   the per-process canonical-identity join;
 * - `host/view-models.ts` — the canonical-id → source-identity join the
 *   card/continue/library projections read.
 *
 * `resetWebHostProcessState()` restores pristine process state so every
 * test starts from the same baseline no matter which files ran before it
 * in the same process.
 *
 * LAWS:
 * - This reset is a TEST SEAM (the repo's testing-export convention): it
 *   MUST NOT be called by any production path — grep-provable: the only
 *   import sites are apps/web tests.
 * - It is deliberately NOT re-exported through `host/index.ts` (minimal
 *   public surface).
 */

import { resetWebRuntimeHostForTests } from "./web-host";
import { resetItemJoinForTests } from "./view-models";
import { resetAcquisitionFixturesForTests } from "./acquisition-fixtures";
import { resetSourceAuthFixturesForTests } from "./source-auth-fixtures";
import { resetByofFixtureState } from "./byof/fixture-state";

/**
 * Reset the web host's PROCESS-LIFETIME state to pristine: the runtime
 * boot promise (the next `getWebRuntimeHost` boots fresh), the canonical
 * join, the item join, the R14 acquisition fixture feed, the R17
 * source-auth fixture state, and the R20-D BYOF fixture drive state.
 * TEST-ONLY — see the module doc.
 */
export function resetWebHostProcessState(): void {
  resetWebRuntimeHostForTests();
  resetItemJoinForTests();
  resetAcquisitionFixturesForTests();
  resetSourceAuthFixturesForTests();
  resetByofFixtureState();
}
