/**
 * @wfx/journeys — journey narration helper (R16).
 *
 * One recorded narration step: what the journey DID and OBSERVED at a
 * checkpoint (the journey doc's evidence format wants "actions
 * performed" and "observed result" — narrations are those records).
 * A narration never passes or fails a journey by itself; assertions do.
 */

import type { JourneyContext } from "../lib/journeys";

/** Record one narration line in the journey's artifact set. */
export async function describe(context: JourneyContext, text: string): Promise<void> {
  // The narration rides alongside the snapshot artifact: appended to the
  // journey's narration buffer, which the runner saves as a step log.
  const buffer = (context as JourneyContext & { narration?: string[] }).narration ?? [];
  buffer.push(text);
  (context as JourneyContext & { narration?: string[] }).narration = buffer;
}

/** Read the journey's narration lines (the runner serializes them). */
export function narrationsOf(context: JourneyContext): readonly string[] {
  const buffer = (context as JourneyContext & { narration?: string[] }).narration ?? [];
  return [...buffer];
}
