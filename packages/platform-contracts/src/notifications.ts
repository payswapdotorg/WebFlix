/**
 * @wfx/platform-contracts — NotificationPort (R01).
 *
 * INTERFACE ONLY. The OS notification capability: Web maps to the Web
 * Notifications API (permission-gated), Desktop to native notifications,
 * Mobile to OS notification channels. Truthful permission handling is the
 * law: `notify` NEVER fabricates delivery. A denied permission answers
 * `permission-denied`; an unavailable channel answers `unavailable`; only a
 * real handoff to the OS answers `delivered`.
 */

/** The truthful permission state of the notification channel. */
export interface NotificationPermission {
  /** Whether notifications may be shown right now. */
  readonly granted: boolean;
  /** Whether asking the user is still possible (false: hard-denied or unsupported). */
  readonly canRequest: boolean;
  /** Honest reason text when not granted. */
  readonly reason?: string;
}

/** Why the notification is shown (surfaced to the user, drives presentation). */
export type NotificationCategory =
  /** Playback-related (e.g. background completion of an acquisition). */
  | "acquisition"
  /** Playback-related (e.g. resume reminders). */
  | "playback"
  /** Anything else. */
  | "general";

/** One notification request. */
export interface NotificationRequest {
  readonly title: string;
  readonly body?: string;
  readonly category: NotificationCategory;
  /** Canonical item the notification is about, when there is one. */
  readonly itemId?: string;
  /** Adapter-opaque payload (deep-link data etc.). */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The typed outcome of one `notify` call — never a fake success. */
export type NotificationOutcome =
  | { readonly delivered: true }
  | {
      readonly delivered: false;
      readonly reason: "permission-denied" | "unavailable" | "invalid-request";
      readonly detail: string;
    };

/**
 * The notification capability port. INTERFACE ONLY: adapters implement it
 * over the OS/Web channel; the runtime uses it for honest, permission-aware
 * notifications (e.g. acquisition completion on Desktop).
 */
export interface NotificationPort {
  /** The truthful current permission state. */
  permission(): Promise<NotificationPermission>;
  /** Ask the user (where possible); answers the resulting state. */
  requestPermission(): Promise<NotificationPermission>;
  /** Show one notification; the outcome is typed and honest. */
  notify(request: NotificationRequest): Promise<NotificationOutcome>;
}
