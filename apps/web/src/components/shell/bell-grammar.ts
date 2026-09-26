/**
 * @wfx/app-web — the notification bell's two-layer grammar (R30-B, §1).
 *
 * THE CORPUS LAW (docs/parity-lab/r30/lead-captures/CORPUS.md §1 +
 * "Cross-cutting truths"): the bell button 40x40 carries an unread badge
 * whose text CAPS AT "9+" while the TRUE count surfaces ONLY in the
 * document title ("(167) YouTube" — the captured window's title read
 * 167 while the badge read "9+"). Two grammar layers for one datum:
 *
 * 1. THE BADGE LAYER (`bellBadgeText`): an unread count of 0 paints NO
 *    badge (the honest zero — YouTube's own grammar: no unread, no
 *    badge); 1–9 paints the count verbatim; 10 and above paints the
 *    "9+" cap. The captured window: badge "9+", truth 167.
 * 2. THE TITLE LAYER (`documentTitleWithCount`): the TRUE count rides
 *    the document title as the "(N) " prefix — never capped, never
 *    hidden by the badge's cap. The captured window: "(167) YouTube".
 *
 * THE HONEST BINDING (the frozen law): WebFlix carries NO notification
 * source (the capability-placement row's own truth — delivery is
 * permission-gated through the platform, but nothing generates
 * notifications on this host), so the real unread count is the honest
 * ZERO and BOTH layers stay unpainted in production today. The layers
 * are implemented as real mechanisms bound to the real datum — never a
 * fabricated "9+", never a fabricated "(167)".
 *
 * Pure module (no client/server directive — both sides import it).
 */

/** The badge layer: the unread count → the badge text (null = no badge). */
export function bellBadgeText(unread: number): string | null {
  // The honest zero (and any non-finite input): NO badge paints — an
  // unread count of nothing is nothing (never a "0" badge).
  if (!Number.isFinite(unread)) return null;
  const count = Math.floor(unread);
  if (count <= 0) return null;
  // CORPUS §1 — the cap: the badge caps at "9+" (the captured badge read
  // "9+" while the title read 167 — the two layers' whole point).
  if (count > 9) return "9+";
  return String(count);
}

/**
 * The title layer: the document title composition — the TRUE count rides
 * as the "(N) " prefix (never capped); an honest zero keeps the base
 * title byte-identical.
 */
export function documentTitleWithCount(unread: number, baseTitle: string): string {
  if (!Number.isFinite(unread)) return baseTitle;
  const count = Math.floor(unread);
  // CORPUS §1 — the true count surfaces in the title (167 in the captured
  // window) while the badge caps at 9+.
  if (count <= 0) return baseTitle;
  return `(${count}) ${baseTitle}`;
}
