/**
 * @wfx/app-web — the host-side canonical item identity join (WFX-051).
 *
 * WHY THIS EXISTS. The frozen feed use-case mints `wfxitm_` / `wfxsrc_`
 * identities from the injected `IdGen` ON EVERY CALL (packages/experience,
 * use-cases/feed.ts: "a stopgap until the Entertainment Graph, WFX-010,
 * owns item identity"). In this host every REQUEST boots fresh ports, so
 * the same content gets a DIFFERENT canonical id on every request — which
 * would break every cross-request join the experience shell needs:
 * continue-watching (recorded watch-state events are itemId-keyed), the
 * short feed's replacement law (an incoming card whose item id is already
 * in the stack is never a replacement), and like/save correlation.
 *
 * WHAT THIS IS. The documented "host's canonical-item join": this module
 * keeps a per-process map from the STABLE source identity
 * (`connectorId` + `externalRef` — the same key WFX-052's persistence
 * schema anchors with `UNIQUE (connector_id, external_ref)`) to ONE
 * canonical `wfxitm_` id minted on first sight and reused thereafter.
 * Every projected card the shell renders carries the joined id, so events,
 * actions, and feeds all agree on identity within the host process.
 *
 * HONESTY NOTES (typed stopgaps, visible):
 * - This is a HOST COMPOSITION concern, not domain logic: no ranking, no
 *   recommendation, no new event vocabulary — only identity joining.
 * - It is deliberately NOT durable: a process restart re-mints ids (dev
 *   fixtures tolerate this; the SERVICE lane provides stable canonical
 *   identity through the Experience API, where WFX-052's graph owns
 *   `wfxitm_` ids persistently). Durable cross-process identity is that
 *   lane's deliverable, not this shell's.
 * - Minted bodies are zero-padded sequential counters — the SAME canonical
 *   ULID grammar the fixture `SequentialIdGen` produces (decimal digits
 *   are a subset of Crockford Base32; first char stays in `[0-7]`), so
 *   every joined id passes `isEntertainmentItemId`.
 *
 * Determinism: same process + same first-sight order ⇒ same ids. No
 * `Date.now`, no `Math.random`, no globals beyond the one join map.
 */

import type { FeedCard } from "@wfx/experience";
import { isEntertainmentItemId } from "@wfx/domain";

/** The stable source identity of one piece of content. */
export interface SourceKey {
  readonly connectorId: string;
  readonly externalRef: string;
}

/** The per-process join: source key → canonical item id (first sight mints). */
const joinedIds = new Map<string, string>();

/** Sequential body counter for freshly joined items (ULID grammar, see doc). */
let joinCounter = 0;

/** Map key of a source identity (deterministic, collision-free for refs without "\u0000"). */
function keyOf(key: SourceKey): string {
  return `${key.connectorId}\u0000${key.externalRef}`;
}

/**
 * The canonical item id for one source identity — minted on first sight,
 * reused on every later sight within this process.
 */
export function canonicalItemId(key: SourceKey): string {
  const mapKey = keyOf(key);
  const existing = joinedIds.get(mapKey);
  if (existing !== undefined) return existing;
  const body = String(joinCounter).padStart(26, "0");
  joinCounter += 1;
  const id = `wfxitm_${body}`;
  if (!isEntertainmentItemId(id)) {
    // Unreachable: the counter grammar is valid by construction. Fail loudly
    // (never hand out a broken identity) if that invariant ever breaks.
    throw new Error(`canon join: minted invalid item id '${id}'`);
  }
  joinedIds.set(mapKey, id);
  return id;
}

/**
 * Join ONE feed card's canonical identity to the stable id for its source
 * realization: a NEW card object whose `item.id` (and the realization's
 * `entertainmentItemId`) carry the joined id. The input card is untouched.
 */
export function joinFeedCard(card: FeedCard): FeedCard {
  const joined = canonicalItemId({
    connectorId: card.realization.connectorId,
    externalRef: card.realization.externalRef,
  });
  if (card.item.id === joined) return card;
  return {
    item: { ...card.item, id: joined },
    realization: { ...card.realization, entertainmentItemId: joined },
  };
}

/**
 * Join a page of feed cards (order preserved). Two cards for the SAME
 * source identity in one page collapse onto the same joined id — the
 * caller renders per-row lists, so React keys stay unique within a row.
 */
export function joinFeedCards(cards: readonly FeedCard[]): FeedCard[] {
  return cards.map(joinFeedCard);
}

/**
 * TEST-ONLY: clear the join map and restart the mint counter at zero.
 *
 * Consumed EXCLUSIVELY by `host/testing.ts` (the host test seam) — never
 * by a production path (grep-provable: no other import site exists). It
 * exists because bun:test groups test files into worker PROCESSES whose
 * grouping varies with the machine: when several apps/web test files share
 * one process, ids minted by earlier files sit in this PROCESS-LIFETIME
 * map and shift the counter later files' first-sight mints start from
 * (the CI test-hermeticity fix, WFX-CI-FIX). Tests fetch ids through
 * `canonicalItemId(...)` so they ADAPT to re-minting; production behavior
 * is untouched — the documented per-process laws above stand.
 */
export function resetCanonicalItemJoinForTests(): void {
  joinedIds.clear();
  joinCounter = 0;
}
