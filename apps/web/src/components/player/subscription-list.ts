/**
 * @wfx/app-web — the Subscriptions named-list constant (R29-B).
 *
 * ONE frozen name shared by the server-side view derivation (the player
 * shell's initial subscribed truth — the library entries read) and the
 * client channel row (the Subscribe pill's write target). The runtime's
 * library keeps ONE canonical entry per item with ONE list name; the
 * "Subscriptions" list is the durable follow surface the pill writes
 * (rendered by the Library's playlists section — a real capability,
 * never a dead button).
 */

/** The library list the Subscribe pill writes (the frozen name). */
export const SUBSCRIPTIONS_LIST = "Subscriptions";
