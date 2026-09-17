/**
 * @wfx/experience — the Media Surface ANSWER (R09): the precedence wired.
 *
 * THE frozen precedence, wired end-to-end:
 *
 *   Native > Embed > Browser > External
 *
 * `answerMediaSurface` composes the FROZEN resolver (`resolveSurface` —
 * untouched, still the single decision engine) with the R09 additive truth
 * layers and answers ONE auditable object:
 *
 * - `resolution`  — the frozen `SurfaceResolution` verbatim (the
 *   authoritative chosen realization + its `precedenceTrace`);
 * - `rungs`       — ONE verdict per rung, parsed from the frozen trace's
 *   deterministic formats: `accepted` / `skipped` / `rejected` with the
 *   NAMED reason verbatim. THE ANSWER NAMES WHAT WAS CHOSEN AND WHY, and
 *   names every honestly-unavailable rung it skipped;
 * - `embed`       — the official-embed capability truth consumed from the
 *   request's realizations (`official` / `unofficial` / `absent` — the
 *   marker model of `embed.ts`; a fixture is never silently presented as
 *   production capability);
 * - `externalReturn` — when the EXTERNAL rung wins (J09), the durable
 *   continuation identity (item + source) the adapter completes with the
 *   position at handoff through `buildExternalReturnContext`.
 *
 * CAPABILITY TRUTH (invariant 3) is the whole law of this module:
 * availability is never aspiration. A rung without a realization is
 * skipped and NAMED; a rung whose device cannot realize it is rejected and
 * NAMED; a restricted rung is rejected and NAMED; the winner is the highest
 * truthfully-available rung, and the trace explains every step. The embed
 * marker NEVER overrides the frozen precedence (the same law provider
 * hints obey) — it names the attestation level the rung truthfully carries.
 *
 * CONSISTENCY LAW: `parsePrecedenceTrace` reads the frozen resolver's
 * documented line formats (`"<mode>: accepted|skipped|rejected — …"`, one
 * line per mode in precedence order). A trace that does not carry exactly
 * one line per rung is an out-of-sync resolver — the typed
 * `ExperienceError` (never a silently-parsed lie).
 *
 * PURE + DETERMINISTIC: no clock, no entropy, no network. The decision
 * instant enters only through `request.now` (the frozen request's law).
 */

import { ExperienceError } from "../ports";
import { isOfficialEmbed, officialEmbedTruth, type OfficialEmbedTruthReport } from "./embed";
import { resolveSurface } from "./resolve";
import type { SurfaceRequest } from "./request";
import type { SurfaceResolution } from "./resolve";
import { PLAYBACK_MODE_PRECEDENCE } from "../use-cases/playback";

// ---------------------------------------------------------------------------
// The rung verdicts (parsed from the frozen trace — the answer NAMES the why)
// ---------------------------------------------------------------------------

/** The four rungs of the frozen precedence. */
export type SurfaceRung = "native" | "embed" | "browser" | "external";

/** One rung's verdict, with the frozen trace's reason VERBATIM. */
export interface SurfaceRungVerdict {
  /** The rung (frozen precedence order). */
  readonly rung: SurfaceRung;
  /**
   * - `accepted`  — this rung won the precedence walk;
   * - `skipped`   — a higher-precedence rung won; this rung was never needed;
   * - `rejected`  — this rung was honestly unavailable (no realization /
   *   device cannot realize it / not permitted / no viable realization /
   *   undecodable native demands) — the reason NAMES which.
   */
  readonly verdict: "accepted" | "skipped" | "rejected";
  /** The frozen trace line verbatim (NON-EMPTY — the named reason). */
  readonly reason: string;
}

/** The trace line prefixes the frozen resolver emits (deterministic formats). */
const TRACE_VERDICT_PREFIXES: Readonly<Record<"accepted" | "skipped" | "rejected", string>> = {
  accepted: ": accepted — ",
  skipped: ": skipped — ",
  rejected: ": rejected — ",
};

/**
 * Parse the frozen resolver's `precedenceTrace` into one verdict per rung.
 * Every rung of the frozen precedence MUST appear exactly once, in order —
 * anything else is an out-of-sync resolver and throws the typed
 * `ExperienceError` (the consistency law).
 */
export function parsePrecedenceTrace(trace: readonly string[]): readonly SurfaceRungVerdict[] {
  if (!Array.isArray(trace)) {
    throw new ExperienceError("trace: expected an array of precedence-trace lines");
  }
  if (trace.length < PLAYBACK_MODE_PRECEDENCE.length) {
    throw new ExperienceError(
      `trace: expected one line per rung (${PLAYBACK_MODE_PRECEDENCE.length}), got ${trace.length}`,
    );
  }
  const verdicts: SurfaceRungVerdict[] = [];
  for (let index = 0; index < PLAYBACK_MODE_PRECEDENCE.length; index += 1) {
    const rung = PLAYBACK_MODE_PRECEDENCE[index] as SurfaceRung;
    const line = trace[index];
    if (typeof line !== "string" || line.length === 0) {
      throw new ExperienceError(
        `trace[${index}]: expected a non-empty line for rung '${rung}', got ${line}`,
      );
    }
    const verdict = verdictOfLine(rung, line, index);
    verdicts.push({ rung, verdict, reason: line });
  }
  // The trace may carry additional advisory lines (the provider-hint note)
  // after the four rung lines — legal, not part of the rung verdicts.
  return verdicts;
}

/** Read one trace line's verdict (the frozen prefix formats). */
function verdictOfLine(
  rung: SurfaceRung,
  line: string,
  index: number,
): SurfaceRungVerdict["verdict"] {
  const verdicts: readonly SurfaceRungVerdict["verdict"][] = ["accepted", "skipped", "rejected"];
  for (const verdict of verdicts) {
    if (line.startsWith(`${rung}${TRACE_VERDICT_PREFIXES[verdict]}`)) return verdict;
  }
  throw new ExperienceError(
    `trace[${index}]: the line for rung '${rung}' does not match the frozen resolver's format — got '${line}'`,
  );
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** The continuation identity when the EXTERNAL rung wins (J09). */
export interface ExternalReturnSeed {
  /** The canonical item of the request. */
  readonly itemId: string;
  /** The chosen realization's connector. */
  readonly connectorId: string;
  /** The chosen realization's source reference. */
  readonly externalRef: string;
}

/** The Media Surface answer: the frozen resolution + the named rungs + truth. */
export interface MediaSurfaceAnswer {
  /** The frozen resolver's authoritative answer (verbatim). */
  readonly resolution: SurfaceResolution;
  /** One verdict per rung (frozen precedence order) — the answer NAMES the why. */
  readonly rungs: readonly SurfaceRungVerdict[];
  /** The official-embed capability truth consumed from the request. */
  readonly embed: OfficialEmbedTruthReport;
  /**
   * The return-context seed when the EXTERNAL rung won (J09): the item +
   * source identity the adapter completes with the position at handoff
   * (`buildExternalReturnContext`). `null` otherwise.
   */
  readonly externalReturn: ExternalReturnSeed | null;
}

/**
 * Answer ONE playback request: run the FROZEN resolver, parse the rung
 * verdicts from its trace, consume the official-embed marker truth, and
 * seed the external return context when the external rung wins.
 *
 * `resolveSurface`'s own laws apply verbatim (request-container validation
 * throws the typed `ExperienceError`; per-realization problems are typed
 * exclusions inside the resolution — never a crash, never a fake success).
 */
export function answerMediaSurface(request: SurfaceRequest): MediaSurfaceAnswer {
  const resolution = resolveSurface(request);
  const rungs = parsePrecedenceTrace(resolution.ok ? resolution.precedenceTrace : failureTrace(resolution));
  const embed = officialEmbedTruth(request.realizations);
  const externalReturn: ExternalReturnSeed | null =
    resolution.ok && resolution.mode === "external"
      ? {
          itemId: resolution.itemId,
          connectorId: resolution.chosen.connectorId,
          externalRef: resolution.chosen.externalRef ?? "",
        }
      : null;
  return { resolution, rungs, embed, externalReturn };
}

/**
 * The rung verdicts of an UNRESOLVABLE resolution: every mode line the
 * frozen resolver recorded (its `reasons` carry the per-mode rejection
 * lines in precedence order after the summary + exclusions — the honest
 * dead-end audit). Extracts the four rung lines by their frozen prefixes;
 * an unresolvable resolution that cannot name all four rungs is
 * out-of-sync and throws the typed error (the consistency law).
 */
function failureTrace(resolution: Extract<SurfaceResolution, { ok: false }>): readonly string[] {
  const lines: string[] = [];
  for (const reason of resolution.reasons) {
    if (typeof reason !== "string") continue;
    if (isRungLine(reason)) lines.push(reason);
  }
  if (lines.length < PLAYBACK_MODE_PRECEDENCE.length) {
    throw new ExperienceError(
      `resolution.reasons: an unresolvable resolution must name every rung (${PLAYBACK_MODE_PRECEDENCE.length} mode lines), found ${lines.length}`,
    );
  }
  return lines;
}

/** Whether one reason line is a rung line (starts with a rung prefix). */
function isRungLine(line: string): boolean {
  for (const rung of PLAYBACK_MODE_PRECEDENCE) {
    if (line.startsWith(`${rung}: `)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Convenience reads over the answer (the vocabulary the adapters consume)
// ---------------------------------------------------------------------------

/**
 * The chosen rung's verdict line (the "what was chosen and why" line), or
 * `null` for an unresolvable answer.
 */
export function chosenRungLine(answer: MediaSurfaceAnswer): string | null {
  if (!answer.resolution.ok) return null;
  const accepted = answer.rungs.find((verdict) => verdict.verdict === "accepted");
  return accepted !== undefined ? accepted.reason : null;
}

/**
 * Whether the chosen embed realization carries the official marker — the
 * adapter renders the attestation honestly from this. `null` when the
 * answer did not choose the embed rung (or is unresolvable).
 */
export function chosenEmbedIsOfficial(answer: MediaSurfaceAnswer): boolean | null {
  if (!answer.resolution.ok) return null;
  if (answer.resolution.mode !== "embed") return null;
  return isOfficialEmbed(answer.resolution.chosen);
}
