/**
 * @wfx/app-web — the Web background-work HONESTY module (R07).
 *
 * The Web adapter truthfully declares `backgroundWork: "none"` and provides
 * NO BackgroundWorkPort — the capability-truth law (`none` ⇔ no port).
 * This module is the ONE place that decision lives: the honest reason, the
 * surface-facing explanation, and the typed unsupported answer any caller
 * that asks for background work on this platform receives.
 *
 * WHY "none" IS THE TRUTHFUL DECLARATION (not "limited"):
 *
 * - A browser tab is SUSPENDED when hidden/backgrounded by the OS; timers
 *   and script execution stop. There is no truthful "keep acquiring while
 *   the user is elsewhere" on this platform.
 * - The real web background facilities (Service Worker one-shot Background
 *   Sync, Periodic Background Sync) are browser-gated, Chromium-partial,
 *   require an installed PWA, and — decisively — cannot host the runtime's
 *   tracked-task semantics (`scheduled/running/suspended/completed/failed`
 *   with honest progress) without SW↔page messaging machinery that would
 *   be half-fake today. A port whose status tracking is theater violates
 *   the scheduling-honesty law; the honest answer is NONE.
 * - Desktop is the background-capable reference client (`"full"`); the
 *   future Mobile adapter declares its OS-scheduled `"limited"` windows.
 *   Web renders honest unsupported states for native-only functionality
 *   (the frozen architecture law).
 *
 * WHAT R02–R16 MUST DO TO CHANGE THIS: a truthful web `"limited"` needs a
 * real BackgroundWorkPort over service-worker sync with honest status
 * tracking and browser-level journey evidence (the lead's R16). Until
 * then, this declaration is the law — escalate through the lead, do not
 * patch it in an adapter.
 */

import type { BackgroundTaskSpec, BackgroundWorkOutcome } from "@wfx/platform-contracts";

/** The honest limitation reason carried on the capability descriptor. */
export const WEB_BACKGROUND_WORK_LIMITATION =
  "browser tabs suspend when hidden — there is no truthful background execution on the web platform; background acquisition is Desktop-only (the reference client), so Web renders honest unsupported states";

/** The honest, user-facing explanation the settings surface renders. */
export function describeWebBackgroundWork(): string {
  return WEB_BACKGROUND_WORK_LIMITATION;
}

/**
 * The typed answer any background-work request receives on this platform:
 * `unsupported-kind` with the limitation named — NEVER a silent drop, NEVER
 * a fake acceptance. The runtime's action engine already gates
 * native-acquisition actions (`download`) through the capability truth; the
 * web settings surface renders this answer as the honest capability state.
 */
export function webBackgroundWorkUnsupported(task: BackgroundTaskSpec): BackgroundWorkOutcome {
  return {
    accepted: false,
    reason: "unsupported-kind",
    detail: `background work is truthfully unavailable on the web platform — the task '${task.taskId}' (${task.kind}) was NOT scheduled. ${WEB_BACKGROUND_WORK_LIMITATION}`,
  };
}
