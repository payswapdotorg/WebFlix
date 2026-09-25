/**
 * @wfx/app-web — the account chrome view (R30-B: the corpus-pending
 * family's binding grammar, joined to WebFlix's real account model).
 *
 * THE CORPUS LAW (docs/parity-lab/r30/lead-captures/CORPUS.md §1–§4):
 * the logged-in window's account chrome — the masthead end cluster
 * (bell 40x40 + the avatar squircle; the sign-in pill is the LOGGED-OUT
 * variant), the bell panel, the account menu (the 14-row grammar), and
 * the subscriptions rail (the flat list with 24x24 avatars, entries
 * 204x40) — binds against the SIGNED-IN state's own truth.
 *
 * THE SEAM (the player page's composer-gate pattern — the established
 * law): the pages render through the ANONYMOUS host singleton by design
 * (the one-runtime-at-boot law), so the account chrome reads the
 * request's SIGN-IN truth through `readRequestSessionView` (the same
 * machinery `/api/auth/session` uses — never a fabricated profile), and
 * the RAIL SUBSCRIPTIONS from the page host's own library truth (the
 * SAME fold the Library page renders and the Subscribe pill writes —
 * the R30-A `hydrate()` seam: the fold IS the stored truth after one
 * memoized server read per engine; the write paths keep it current, so
 * the rail reflects the app's own subscribe/unsubscribe round trips).
 *
 * THE NOTIFICATION TRUTH (CORPUS §1's two grammar layers, honestly
 * bound): this host carries NO notification source — nothing generates
 * notification rows — so the real unread count is the honest ZERO and
 * the badge/title layers stay unpainted (a zero paints no badge, keeps
 * the title un-prefixed — YouTube's own grammar). The count is typed
 * data, not a constant masquerading as one: a notification source that
 * honestly lands later binds to the same layers.
 *
 * THE HONESTY LAWS (every one frozen from the repo's own book):
 * - never a fabricated account: the signed-in view comes only from the
 *   request's resolved session (the persona file or the real /auth/me);
 * - never a fabricated subscription row: the rail lists only the stored
 *   Subscriptions-list entries the fold knows (the join's own law — a
 *   row without a joined source identity renders UNLINKED, never a
 *   fabricated link);
 * - never a fabricated unread count: 0 is the truth; the badge and the
 *   title layers are real mechanisms bound to it.
 */

import type { WebRuntimeHost } from "@/host/web-host";
import { getWebRuntimeHost } from "@/host/web-host";
import type { RequestSessionView } from "@/host/request-session-view";
import { readRequestSessionView } from "@/host/request-session-view";
import type { JoinedItem } from "@/host/view-models";
import { joinedItemOf } from "@/host/view-models";
import { SUBSCRIPTIONS_LIST } from "@/components/player/subscription-list";

/**
 * The notification truth the bell binds to (CORPUS §1's two layers).
 * `unread` is the REAL count — the honest zero today (no notification
 * source exists on this host; the capability-placement row's own empty
 * state names it: "No notifications yet — follow sources to get them").
 */
export interface NotificationTruth {
  /** The real unread count (0 — this host has no notification source). */
  readonly unread: number;
  /**
   * The honest empty-state line (the capability-placement row's own
   * frozen vocabulary — the panel's content when no rows exist).
   */
  readonly emptyState: string;
  /** The honest source-absence line (why the panel carries no rows). */
  readonly sourceNote: string;
}

/**
 * One rail subscriptions entry (CORPUS §4): the stored Subscriptions-list
 * entry joined to the identity this process knows — `joined === null`
 * renders UNLINKED (the cards' own law: never a fabricated link).
 */
export interface RailSubscriptionEntry {
  readonly itemId: string;
  readonly title: string;
  readonly joined: JoinedItem | null;
}

/** The account chrome view (what the shell's account surfaces render). */
export interface AccountChromeView {
  /** The request's session truth (the composer-gate seam's answer). */
  readonly session: RequestSessionView;
  /**
   * The session's REAL locale (the session context's own law: the env
   * override, then the navigator language, then "en") — the account
   * menu's Display-language state label (CORPUS §3 row 8).
   */
  readonly locale: string;
  /** The notification truth (the bell's two grammar layers bind to it). */
  readonly notifications: NotificationTruth;
  /** The rail subscriptions (the stored Subscriptions list, joined). */
  readonly railSubscriptions: readonly RailSubscriptionEntry[];
}

/**
 * The notification truth: this host has NO notification source (the
 * frozen capability vocabulary — delivery is permission-gated through
 * the platform, generation is absent), so the unread count is the
 * honest zero. The badge and title layers are real mechanisms bound to
 * this datum (bell-grammar.ts) — a zero paints nothing, and a real
 * source that lands later binds to the same layers.
 */
const NOTIFICATION_TRUTH: NotificationTruth = {
  unread: 0,
  // The capability-placement row's own frozen empty state, verbatim.
  emptyState: "No notifications yet — follow sources to get them",
  sourceNote:
    "No notification source is connected on this host — nothing generates notification rows, so none are ever fabricated.",
};

/**
 * Compose the account chrome view (the pure seam — the cookie read is
 * the caller's thin wrapper; tests compose the view directly with the
 * session view they resolved through the REAL drives). Async: the rail
 * subscriptions AWAIT the fold's hydration (the R30-A memoized seam —
 * one server read per engine; a fire-and-forget read would race the
 * first render against an empty fold).
 */
export async function accountChromeViewOf(
  host: WebRuntimeHost,
  session: RequestSessionView,
): Promise<AccountChromeView> {
  // The rail subscriptions: the page host's own library fold — the same
  // truth the Library page renders and the Subscribe pill writes. The
  // hydrate() call is the R30-A seam (memoized per engine: the first
  // read seeds the stored truth; later calls return the settled
  // promise), so this is ONE server read per process, not per page.
  await host.runtime.libraryOps.hydrate();
  const subscriptions = host.runtime.libraryOps
    .entries()
    .filter((entry) => entry.listName === SUBSCRIPTIONS_LIST)
    .map((entry) => ({
      itemId: entry.itemId,
      title: entry.title,
      joined: joinedItemOf(entry.itemId),
    }));
  return {
    session,
    locale: host.session.context.locale,
    notifications: NOTIFICATION_TRUTH,
    railSubscriptions: subscriptions,
  };
}

/**
 * The page-level loader (the cookie read + the composition). The pages
 * pass its answer to the shell's `account` prop — the player page's
 * own pattern (`readRequestSessionView`) extended to the account
 * chrome. The RAIL SUBSCRIPTIONS always read the ANONYMOUS SINGLETON's
 * fold (the library surfaces' own host — the one runtime the Subscribe
 * writes and the Library reads flow through; the settings page's
 * identity-scoped host is a different surface's truth, never the
 * rail's). NOT imported by tests directly (it wraps `next/headers`);
 * the composition is covered through `accountChromeViewOf`.
 */
export async function loadAccountChrome(): Promise<AccountChromeView> {
  const host = await getWebRuntimeHost();
  const session = await readRequestSessionView(host.config);
  return await accountChromeViewOf(host, session);
}
