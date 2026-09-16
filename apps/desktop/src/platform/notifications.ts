/**
 * @wfx/app-desktop — NotificationPort over OS notifications (R08).
 *
 * The Desktop notification seam: the native shell's OS notification
 * channel (permission-gated). The truth law is absolute: `notify` NEVER
 * fabricates delivery —
 *
 * - a permission not granted answers `{ delivered: false, reason:
 *   "permission-denied" }` (the shell is never even asked to show);
 * - an unavailable channel (OS notifications disabled, channel error)
 *   answers `"unavailable"` with the honest detail;
 * - a malformed request (empty title) answers `"invalid-request"`;
 * - only a real OS handoff answers `{ delivered: true }`.
 *
 * `permission()`/`requestPermission()` report the truthful OS state
 * (`canRequest: false` once hard-denied — the shell says so, never a
 * guess).
 */

import type {
  NotificationOutcome,
  NotificationPermission,
  NotificationPort,
  NotificationRequest,
} from "@wfx/platform-contracts";

import type { ShellIpc, ShellPermissionState, ShellNotifyOutcome } from "./shell-ipc";

/** Map the shell's permission state onto the port's shape (verbatim fields). */
function toPermission(state: ShellPermissionState): NotificationPermission {
  return {
    granted: state.granted,
    canRequest: state.canRequest,
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
  };
}

/** Map the shell's OS handoff outcome onto the port's typed outcome. */
function toOutcome(outcome: ShellNotifyOutcome): NotificationOutcome {
  if (outcome.delivered) return { delivered: true };
  return {
    delivered: false,
    reason: outcome.reason,
    detail: outcome.detail,
  };
}

/** Build the Desktop `NotificationPort` over the shell's OS channel. */
export function createShellNotificationPort(shell: ShellIpc): NotificationPort {
  return {
    async permission(): Promise<NotificationPermission> {
      return toPermission(await shell.notificationPermission());
    },

    async requestPermission(): Promise<NotificationPermission> {
      return toPermission(await shell.notificationRequestPermission());
    },

    async notify(request: NotificationRequest): Promise<NotificationOutcome> {
      // Request-level honesty first: the OS channel cannot show an
      // untitled notification — an invalid request is named, never fixed.
      if (typeof request.title !== "string" || request.title.trim().length === 0) {
        return {
          delivered: false,
          reason: "invalid-request",
          detail: `notification.title: expected a non-empty string, got '${String(request.title)}'`,
        };
      }
      const outcome = await shell.notificationShow({
        title: request.title,
        ...(request.body !== undefined ? { body: request.body } : {}),
        category: request.category,
        ...(request.itemId !== undefined ? { itemId: request.itemId } : {}),
      });
      return toOutcome(outcome);
    },
  };
}
