/**
 * @wfx/experience — the EXTERNAL handoff's RETURN CONTEXT (R09, J09).
 *
 * The external rung (frozen precedence step 4) is the honest handoff: the
 * provider's page/app opens OUTSIDE WebFlix and the provider keeps the
 * playback path. What R09 adds is the DURABLE CONTINUATION: the surface
 * answers a RETURN CONTEXT — the canonical item + the position at handoff —
 * so the journey can return to the same place inside WebFlix afterwards
 * (J09: "External playback fallback / return context").
 *
 * The shape is deliberately minimal and durable:
 * - the CANONICAL item identity (`wfxitm_` id) — content identity is
 *   canonical, source realization secondary (invariant 2);
 * - the source identity (connector + external ref) — how to re-resolve
 *   realizations for the same item on return;
 * - the POSITION at handoff (milliseconds; 0 when playback never started) —
 *   the honest resume point, from playback evidence only (never a guess);
 * - the handoff instant (ISO 8601 with explicit offset, from the injected
 *   time source — never a hidden clock).
 *
 * The adapters render the handoff visibly ("opens on its source" — the R07
 * contract stays green) and carry this context so the return is explicit:
 * a link/affordance that re-enters the SAME item at the SAME position.
 * Nothing here inspects, intercepts, or steers the provider's experience —
 * the external rung's security boundary is the frozen law.
 *
 * PURE DATA + PURE FUNCTIONS ONLY — the clock enters ONLY through the
 * caller-supplied `now` (no `Date.now()` in this package).
 */

import { isEntertainmentItemId, isIso8601, isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// The return context
// ---------------------------------------------------------------------------

/**
 * The durable continuation of an external handoff: the item + position at
 * handoff, so the journey can return to the same place in WebFlix.
 */
export interface ExternalReturnContext {
  /** The canonical entertainment-item ID (`wfxitm_` + ULID body). */
  readonly itemId: string;
  /** The connector the realization came from (re-resolution on return). */
  readonly connectorId: string;
  /** The source's own reference (re-resolution on return). */
  readonly externalRef: string;
  /** The position at handoff, in milliseconds (>= 0; evidence-backed only). */
  readonly positionMs: number;
  /** The handoff instant — ISO 8601 with explicit offset. */
  readonly handedOffAt: string;
}

/** Input to {@link buildExternalReturnContext}. */
export interface ExternalReturnContextInput {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly positionMs: number;
}

/**
 * Build the external handoff's return context. PURE: the caller supplies
 * the handoff instant (`now`, ISO 8601 with explicit offset) — the clock is
 * never read here.
 *
 * @throws `ExperienceError` listing EVERY problem for invalid input (the
 *         error-channel law of ports.ts — caller misuse is a typed throw,
 *         never a silent pass, never a fabricated context).
 */
export function buildExternalReturnContext(
  input: ExternalReturnContextInput,
  now: string,
): ExternalReturnContext {
  if (!isRecord(input)) {
    throw new ExperienceError("input: expected an ExternalReturnContextInput object");
  }
  const problems: string[] = [];
  if (!isEntertainmentItemId(input.itemId)) {
    problems.push(
      `input.itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(input.itemId)}`,
    );
  }
  if (typeof input.connectorId !== "string" || input.connectorId.length === 0) {
    problems.push(
      `input.connectorId: expected a non-empty string, got ${previewValue(input.connectorId)}`,
    );
  }
  if (typeof input.externalRef !== "string" || input.externalRef.length === 0) {
    problems.push(
      `input.externalRef: expected a non-empty string, got ${previewValue(input.externalRef)}`,
    );
  }
  if (
    typeof input.positionMs !== "number" ||
    !Number.isFinite(input.positionMs) ||
    input.positionMs < 0
  ) {
    problems.push(
      `input.positionMs: expected a finite non-negative number, got ${previewValue(input.positionMs)}`,
    );
  }
  if (!isIso8601(now)) {
    problems.push(
      `now: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-16T12:00:00.000Z), got ${previewValue(now)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
  return {
    itemId: input.itemId,
    connectorId: input.connectorId,
    externalRef: input.externalRef,
    positionMs: input.positionMs,
    handedOffAt: now,
  };
}

/**
 * The honest one-line summary of a return context (the adapters render it
 * verbatim — the answer NAMES the continuation). Deterministic format.
 */
export function describeExternalReturnContext(context: ExternalReturnContext): string {
  return `Return context kept: ${context.itemId} at ${context.positionMs}ms (handed off ${context.handedOffAt}) — WebFlix keeps your place`;
}
