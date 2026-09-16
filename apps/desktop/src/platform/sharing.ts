/**
 * @wfx/app-desktop — SharingPort over the OS share sheet (R08).
 *
 * The Desktop sharing seam: the native shell's OS share-surface command.
 *
 * HONESTY LAWS (the port contract, kept verbatim):
 * - A user DISMISSAL of the share sheet is NOT a failure — it is the
 *   distinct `"dismissed"` outcome; only a real handoff answers
 *   `"shared"`; a broken channel answers `"failed"` with detail.
 * - `canShare` answers TRUTHFULLY per request: the OS share target must
 *   exist for this platform AND the request must be well-formed (a
 *   non-empty title plus something to share — text or url). A request
 *   the platform cannot present answers `false` (honest unsupported
 *   state, never a fake capability).
 *
 * PLATFORM TRUTH (the shell consults the OS, per request):
 * - macOS: the real `NSSharingServicePicker` share sheet.
 * - Windows: the real WinRT `DataTransferManager` share UI.
 * - Linux: no standard OS share sheet — the shell answers the honest
 *   `unsupported` outcome, `canShare` answers `false`, and the UI renders
 *   the honest unsupported state (a clipboard copy is NOT presented as a
 *   share). The descriptor's limitation note names this per-OS truth.
 */

import type { ShareOutcome, ShareRequest, SharingPort } from "@wfx/platform-contracts";

import type { ShellIpc, ShellShareOutcome, ShellShareRequest } from "./shell-ipc";

/** Map the shell's share outcome onto the port's typed outcome. */
function toOutcome(outcome: ShellShareOutcome): ShareOutcome {
  switch (outcome.outcome) {
    case "shared":
      return { outcome: "shared" };
    case "dismissed":
      return { outcome: "dismissed" };
    case "failed":
      return { outcome: "failed", detail: outcome.detail };
    case "unsupported":
      // The shell says the platform cannot present this request. The
      // port vocabulary has no "unsupported" outcome — `canShare` is the
      // honest pre-check that answers false for exactly this case, so a
      // caller that checked first never lands here. Reaching it anyway
      // surfaces the honest failed-with-detail (never a fake share).
      return { outcome: "failed", detail: outcome.detail };
  }
}

/** Is the request well-formed enough to hand to the OS sheet? */
function isWellFormed(request: ShareRequest): boolean {
  return (
    typeof request.title === "string" &&
    request.title.trim().length > 0 &&
    ((request.text !== undefined && request.text.length > 0) ||
      (request.url !== undefined && request.url.length > 0))
  );
}

function toShellRequest(request: ShareRequest): ShellShareRequest {
  return {
    title: request.title,
    ...(request.text !== undefined ? { text: request.text } : {}),
    ...(request.url !== undefined ? { url: request.url } : {}),
    ...(request.itemId !== undefined ? { itemId: request.itemId } : {}),
  };
}

/** Build the Desktop `SharingPort` over the shell's OS share surface. */
export function createShellSharingPort(shell: ShellIpc): SharingPort {
  return {
    async canShare(request: ShareRequest): Promise<boolean> {
      if (!isWellFormed(request)) return false; // truthful: nothing to present
      return shell.shareCanPresent(toShellRequest(request));
    },

    async share(request: ShareRequest): Promise<ShareOutcome> {
      if (!isWellFormed(request)) {
        return {
          outcome: "failed",
          detail:
            "share request needs a non-empty title plus text or url to present an OS share target",
        };
      }
      return toOutcome(await shell.sharePresent(toShellRequest(request)));
    },
  };
}
