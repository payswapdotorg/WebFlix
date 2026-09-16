/**
 * @wfx/platform-contracts — SharingPort (R01).
 *
 * INTERFACE ONLY. The OS share capability: Web maps to the Web Share API
 * (where available), Desktop to OS share sheets/clipboard handoff, Mobile
 * to the native share sheet. Honesty law: a user DISMISSAL of the share
 * sheet is NOT a failure — it is the distinct `"dismissed"` outcome; only a
 * real handoff answers `"shared"`, and a broken channel answers `"failed"`.
 */

/** One share request (what the user asked to share). */
export interface ShareRequest {
  readonly title: string;
  readonly text?: string;
  readonly url?: string;
  /** Canonical item being shared, when there is one. */
  readonly itemId?: string;
}

/** The typed outcome of one `share` call. */
export type ShareOutcome =
  /** Handed to the OS share target. */
  | { readonly outcome: "shared" }
  /** The user dismissed the share surface — not an error. */
  | { readonly outcome: "dismissed" }
  | { readonly outcome: "failed"; readonly detail: string };

/**
 * The sharing capability port. INTERFACE ONLY: adapters implement it over
 * the OS share facilities; the runtime uses it for source-neutral sharing.
 */
export interface SharingPort {
  /** Whether this request is shareable on this platform (truthful). */
  canShare(request: ShareRequest): Promise<boolean>;
  /** Share; the outcome distinguishes shared/dismissed/failed honestly. */
  share(request: ShareRequest): Promise<ShareOutcome>;
}
