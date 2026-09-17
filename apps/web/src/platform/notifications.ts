/**
 * @wfx/app-web — the Web NotificationPort (R07).
 *
 * The Web adapter's notification capability over the REAL Web Notifications
 * API — permission-gated, never fabricating delivery:
 *
 * - `permission()` reports the truthful current state (`granted` /
 *   `denied` / `default`) with `canRequest` true exactly while the state is
 *   `default` (a hard `denied` cannot be re-asked in most browsers without
 *   the user changing site settings — the honest reading).
 * - `requestPermission()` asks the USER through the browser's real prompt.
 *   It never auto-grants and never assumes; the answer is whatever the
 *   browser reports.
 * - `notify()` constructs one REAL notification only when permission is
 *   granted. A denied permission answers the typed
 *   `{ delivered: false, reason: "permission-denied" }`; a malformed
 *   request answers `invalid-request`; a construction failure answers
 *   `unavailable`. `delivered: true` means the browser accepted the
 *   notification for display — nothing more is claimed (read receipts and
 *   display guarantees belong to the OS, not to this port).
 *
 * The port is CONSTRUCTED ONLY when the environment has the Notification
 * API (see `capabilities.ts` — the bundle declares `notifications: true`
 * exactly then). A boot context without the API declares the capability
 * absent and provides no port: the honest unsupported state, never a stub
 * that pretends.
 */

import type {
  NotificationOutcome,
  NotificationPermission,
  NotificationPort,
  NotificationRequest,
} from "@wfx/platform-contracts";

import type { NotificationPermissionState, WebEnvironment } from "./environment";

/** Options for {@link createWebNotificationPort}. */
export interface WebNotificationPortOptions {
  /** The environment (must carry the Notification API — the caller checks). */
  readonly environment: WebEnvironment;
}

/** Create the permission-gated Web notification port. */
export function createWebNotificationPort(options: WebNotificationPortOptions): NotificationPort {
  const api = options.environment.notificationApi;
  const ctor = options.environment.notificationCtor;
  if (api === null || ctor === null) {
    // Defensive: the capability bundle only constructs this port when the
    // API exists. If reached without it, every operation answers the
    // honest unavailable outcome — never a fabricated delivery.
    return {
      permission: async () => ({
        granted: false,
        canRequest: false,
        reason: "the Web Notifications API is not available in this context",
      }),
      requestPermission: async () => ({
        granted: false,
        canRequest: false,
        reason: "the Web Notifications API is not available in this context",
      }),
      notify: async () => ({
        delivered: false,
        reason: "unavailable",
        detail: "the Web Notifications API is not available in this context",
      }),
    };
  }

  function permissionFrom(state: NotificationPermissionState): NotificationPermission {
    switch (state) {
      case "granted":
        return { granted: true, canRequest: false };
      case "denied":
        return {
          granted: false,
          canRequest: false,
          reason: "notification permission was denied — the browser requires the user to re-enable it in site settings",
        };
      case "default":
        return {
          granted: false,
          canRequest: true,
          reason: "notification permission has not been asked for yet",
        };
    }
  }

  return {
    async permission(): Promise<NotificationPermission> {
      return permissionFrom(api.permission);
    },

    async requestPermission(): Promise<NotificationPermission> {
      try {
        const state = await api.requestPermission();
        return permissionFrom(state);
      } catch (thrown) {
        // Some browsers throw when the prompt cannot be shown (e.g. denied
        // prompts re-asked, or no user gesture). The honest answer is the
        // CURRENT state — never an assumed grant.
        return {
          granted: false,
          canRequest: api.permission === "default",
          reason: `the permission prompt could not be shown: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        };
      }
    },

    async notify(request: NotificationRequest): Promise<NotificationOutcome> {
      if (typeof request?.title !== "string" || request.title.trim().length === 0) {
        return {
          delivered: false,
          reason: "invalid-request",
          detail: "title: expected a non-empty string",
        };
      }
      if (api.permission !== "granted") {
        return {
          delivered: false,
          reason: "permission-denied",
          detail: `the current permission state is '${api.permission}' — only a granted permission can show notifications`,
        };
      }
      try {
        // The REAL handoff: one OS/browser notification. Constructing it IS
        // the delivery claim; nothing beyond acceptance is claimed.
        new ctor(request.title, {
          ...(request.body !== undefined ? { body: request.body } : {}),
          ...(request.itemId !== undefined ? { tag: `wfx:${request.category}:${request.itemId}` } : {}),
        });
        return { delivered: true };
      } catch (thrown) {
        return {
          delivered: false,
          reason: "unavailable",
          detail: `the notification could not be constructed: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        };
      }
    },
  };
}
