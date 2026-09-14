/**
 * @wfx/experience — Media Surface session builder (WFX-025, Lane C).
 *
 * `buildPlaybackSession` turns a SUCCESSFUL `SurfaceResolution` into the
 * frozen `PlaybackSession` (docs/architecture/contracts.md, "Media Surface"):
 * the last step of the frozen playback-resolution flow before the Media
 * Surface shell takes over.
 *
 * Purity law: `createdAt` comes EXCLUSIVELY from the injected `Clock` (no
 * hidden `Date.now()` anywhere in this package), and the session id is
 * validated with the WFX-002 canonical guard (`wfxpses_` + 26-char Crockford
 * Base32 ULID body) — the caller supplies it, typically minted through a
 * `Ports.ids` generator like the WFX-005 playback use-case does.
 *
 * Error-channel law (ports.ts): invalid CALLER INPUT throws the typed
 * `ExperienceError` — including an UNRESOLVABLE resolution, which by
 * definition cannot produce a session (its reasons are surfaced verbatim in
 * the error details). Nothing is fabricated: no synthetic ids, no clock
 * fallbacks, no default item.
 */

import type { PlaybackSession } from "@wfx/domain";
import {
  PLAYBACK_MODES,
  isEntertainmentItemId,
  isPlaybackSessionId,
  isRecord,
  previewValue,
  validatePlaybackRealization,
} from "@wfx/domain";

import { ExperienceError, type Clock } from "../ports";
import type { SurfaceResolution } from "./resolve";

/** Maximum ECMAScript epoch milliseconds a Date can represent (8.64e15). */
const MAX_EPOCH_MS = 8.64e15;

/**
 * Build the frozen `PlaybackSession` from a successful surface resolution.
 *
 * @param resolution      a `SurfaceResolution` — MUST be `ok: true` (an
 *                        unresolvable resolution is rejected with a typed
 *                        error carrying its reasons verbatim).
 * @param userId          the playing user (non-empty string).
 * @param sessionId       canonical playback-session id (`wfxpses_` + ULID
 *                        body, validated with the WFX-002 guard).
 * @param resumePositionMs resume position in milliseconds (finite, >= 0).
 * @param clock           the injected time source; `now()` must return finite
 *                        epoch milliseconds in `[0, 8.64e15)`.
 * @returns the frozen `PlaybackSession` (`createdAt` is the ISO 8601
 *          rendering of `clock.now()`).
 * @throws `ExperienceError` listing EVERY problem for invalid input.
 */
export function buildPlaybackSession(
  resolution: SurfaceResolution,
  userId: string,
  sessionId: string,
  resumePositionMs: number,
  clock: Clock,
): PlaybackSession {
  const problems: string[] = [];

  // --- resolution ----------------------------------------------------------
  if (!isRecord(resolution)) {
    throw new ExperienceError("resolution: expected a SurfaceResolution object");
  }
  if (resolution.ok !== true) {
    // Unresolvable input: typed rejection, reasons surfaced verbatim.
    const reasons = Array.isArray(resolution.reasons)
      ? resolution.reasons.map((reason) => String(reason))
      : ["(unresolvable resolution carried no reasons)"];
    throw new ExperienceError([
      "resolution: unresolvable — a playback session cannot be built from a failed surface resolution",
      ...reasons,
    ]);
  }

  const chosenCheck = validatePlaybackRealization(resolution.chosen);
  if (!chosenCheck.ok) {
    problems.push(
      ...chosenCheck.errors.map((message) => `resolution.chosen: ${message}`),
    );
  }
  if (
    typeof resolution.mode !== "string" ||
    !(PLAYBACK_MODES as readonly string[]).includes(resolution.mode)
  ) {
    problems.push(
      `resolution.mode: expected one of ${PLAYBACK_MODES.join(" | ")}, got ${previewValue(resolution.mode)}`,
    );
  } else if (chosenCheck.ok && chosenCheck.value.mode !== resolution.mode) {
    problems.push(
      `resolution.mode: '${resolution.mode}' does not match the chosen realization's mode '${chosenCheck.value.mode}'`,
    );
  }
  if (!isEntertainmentItemId(resolution.itemId)) {
    problems.push(
      `resolution.itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(resolution.itemId)}`,
    );
  }
  if (
    !Array.isArray(resolution.precedenceTrace) ||
    !resolution.precedenceTrace.every((line) => typeof line === "string")
  ) {
    problems.push(
      `resolution.precedenceTrace: expected an array of trace strings, got ${previewValue(resolution.precedenceTrace)}`,
    );
  }

  // --- caller identity + position -------------------------------------------
  if (typeof userId !== "string" || userId.trim().length === 0) {
    problems.push(`userId: expected a non-empty string, got ${previewValue(userId)}`);
  }
  if (!isPlaybackSessionId(sessionId)) {
    problems.push(
      `sessionId: expected a canonical playback-session ID (wfxpses_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(sessionId)}`,
    );
  }
  if (
    typeof resumePositionMs !== "number" ||
    !Number.isFinite(resumePositionMs) ||
    resumePositionMs < 0
  ) {
    problems.push(
      `resumePositionMs: expected a finite non-negative number, got ${previewValue(resumePositionMs)}`,
    );
  }

  // --- clock (the ONLY time source — no hidden Date.now) --------------------
  if (!isRecord(clock) || typeof clock.now !== "function") {
    problems.push(`clock: expected a Clock object with a now() function, got ${previewValue(clock)}`);
  }

  if (problems.length > 0) {
    throw new ExperienceError(problems);
  }

  let createdAt: string | undefined;
  try {
    const nowMs = clock.now();
    if (
      typeof nowMs !== "number" ||
      !Number.isFinite(nowMs) ||
      nowMs < 0 ||
      nowMs >= MAX_EPOCH_MS
    ) {
      problems.push(
        `clock.now(): expected finite epoch milliseconds in [0, ${MAX_EPOCH_MS}), got ${previewValue(nowMs)}`,
      );
    } else {
      createdAt = new Date(nowMs).toISOString();
    }
  } catch (thrown) {
    problems.push(
      `clock.now(): threw instead of returning epoch milliseconds (${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : previewValue(thrown)})`,
    );
  }

  if (problems.length > 0 || createdAt === undefined || !chosenCheck.ok) {
    throw new ExperienceError(problems.length > 0 ? problems : ["clock.now(): produced no timestamp"]);
  }

  return {
    id: sessionId,
    userId,
    itemId: resolution.itemId,
    realization: chosenCheck.value,
    resumePositionMs,
    createdAt,
  };
}
