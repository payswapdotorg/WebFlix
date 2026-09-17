/**
 * @wfx/app-web — the Web SharingPort (R07).
 *
 * The Web adapter's share capability over the REAL Web Share API —
 * constructed exactly when `navigator.share` exists (see `capabilities.ts`:
 * the bundle declares `sharing: true` only then).
 *
 * HONESTY LAWS (the frozen SharingPort contract):
 *
 * - `canShare` answers the truthful availability for ONE request
 *   (`navigator.canShare` when present, else the API's own presence).
 * - `share` distinguishes the typed outcomes honestly:
 *   - `shared` — the OS/browser share target really received the request
 *     (`navigator.share` resolved);
 *   - `dismissed` — the USER closed the share sheet (the standard
 *     `AbortError`); a dismissal is NOT a failure and is never rendered as
 *     one;
 *   - `failed` — the channel broke (any other rejection), with the honest
 *     detail.
 * - There is NO fabricated fallback: a boot context without the Web Share
 *   API gets NO port (the capability is declared absent), and surfaces
 *   offer the honest copy-link affordance as UI — a plain clipboard
 *   action with visible feedback, never presented through this port as an
 *   OS share.
 */

import type { ShareOutcome, ShareRequest, SharingPort } from "@wfx/platform-contracts";

import type { WebEnvironment } from "./environment";

/** Options for {@link createWebSharingPort}. */
export interface WebSharingPortOptions {
  /** The environment (must carry `navigator.share` — the caller checks). */
  readonly environment: WebEnvironment;
}

/** Create the Web Share API port (truthful outcomes, no fallback theater). */
export function createWebSharingPort(options: WebSharingPortOptions): SharingPort {
  const navigator = options.environment.navigator;
  const share = navigator?.share;
  if (share === undefined) {
    // Defensive: the capability bundle only constructs this port when the
    // API exists. Reached without it, every request answers the honest
    // unshareable false — never a fake handoff.
    return {
      canShare: async () => false,
      share: async () => ({
        outcome: "failed",
        detail: "the Web Share API is not available in this context",
      }),
    };
  }
  const canShare = navigator?.canShare;

  function shareDataOf(request: ShareRequest): {
    readonly title?: string;
    readonly text?: string;
    readonly url?: string;
  } {
    const data: { title?: string; text?: string; url?: string } = {};
    if (request.title !== undefined) data.title = request.title;
    if (request.text !== undefined) data.text = request.text;
    if (request.url !== undefined) data.url = request.url;
    return data;
  }

  return {
    async canShare(request: ShareRequest): Promise<boolean> {
      if (typeof request?.title !== "string" || request.title.length === 0) {
        return false; // a share request needs a title (the typed shape law)
      }
      if (canShare !== undefined) {
        try {
          return canShare(shareDataOf(request));
        } catch {
          return false; // a throwing canShare is an honest false
        }
      }
      return true; // navigator.share exists and canShare is absent
    },

    async share(request: ShareRequest): Promise<ShareOutcome> {
      const shareable = await this.canShare(request);
      if (!shareable) {
        return {
          outcome: "failed",
          detail:
            typeof request?.title !== "string" || request.title.length === 0
              ? "a share request requires a non-empty title"
              : "the browser reports this request is not shareable",
        };
      }
      try {
        await share(shareDataOf(request));
        return { outcome: "shared" };
      } catch (thrown) {
        if (thrown instanceof Error && thrown.name === "AbortError") {
          // The user dismissed the share sheet — the distinct, non-failure
          // outcome the frozen contract mandates.
          return { outcome: "dismissed" };
        }
        return {
          outcome: "failed",
          detail: `the share handoff failed: ${
            thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
          }`,
        };
      }
    },
  };
}
