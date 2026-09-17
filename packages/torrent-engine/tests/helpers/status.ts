/**
 * TEST-ONLY helper: the unwrapping status reader (tests assert on the
 * happy path and want the typed value; failures throw with the honest
 * detail so a broken precondition fails the test loudly).
 */

import type { TorrentEngine, TorrentSessionStatus } from "@wfx/torrent-engine";

export function statusOf(engine: TorrentEngine, sessionId: string): TorrentSessionStatus {
  const result = engine.status(sessionId);
  if (!result.ok) {
    throw new Error(`status(${sessionId}) failed: ${result.error.code}: ${result.error.detail ?? ""}`);
  }
  return result.value;
}

/** Bounded wait for a predicate (real-clock, small; the R10 precedent). */
export async function waitFor(predicate: () => boolean, tries = 200): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return predicate();
}
