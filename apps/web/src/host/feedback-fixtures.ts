/**
 * @wfx/app-web — the fixtures-mode feedback persona (R21-E).
 *
 * The dev-only, deterministic twin of the API service's
 * `POST/GET/DELETE /experience/feedback` (R05): the J15 control set as
 * per-profile, timestamped, REVERSIBLE records — `more-like-this`,
 * `not-interested`, `dont-recommend-source`, `dont-recommend-creator`,
 * `already-watched`.
 *
 * This exists for the SAME law the fixtures ServerPort's model-controls
 * persona exists for (R21-B): the fixtures boot renders REAL controls —
 * a submitted feedback control answers a real record, the read lists
 * what was recorded, and the undo DELETES it — so the discovery
 * affordances (and the J34 sweep) exercise the true product path, never
 * a fake dead button. Service mode never touches this module: the
 * `/api/feedback` route proxies the REAL service routes with the
 * session's bearer token.
 *
 * Determinism: a fixed record clock (no Date reads), sequential ids, and
 * the shared module state the dev-server persona family uses.
 */

/** The closed feedback-control vocabulary (the J15 set — frozen order). */
export const FEEDBACK_FIXTURE_KINDS: readonly string[] = [
  "more-like-this",
  "not-interested",
  "dont-recommend-source",
  "dont-recommend-creator",
  "already-watched",
];

/** One recorded feedback control (the service route's record shape). */
export interface FixtureFeedbackRecord {
  readonly id: string;
  readonly kind: string;
  readonly target: string;
  readonly note: string | null;
  readonly createdAt: string;
}

/** The persona's fixed record clock (deterministic — no wall reads). */
const FIXTURE_RECORD_TIME = "2026-09-20T00:00:00.000Z";

/** The persona's shared state (the dev-server route-module law). */
const records = new Map<string, FixtureFeedbackRecord>();
let recordCounter = 1;

/** The persona's record key (idempotency per (profile-scope, kind, target)). */
function keyOf(kind: string, target: string): string {
  return `${kind}:${target}`;
}

/** Reset the persona (the testing seam — deterministic from zero). */
export function resetFixtureFeedback(): void {
  records.clear();
  recordCounter = 1;
}

/** The typed validation of one submit (the service route's law, verbatim). */
export function fixtureFeedbackProblems(input: {
  readonly kind?: unknown;
  readonly target?: unknown;
  readonly note?: unknown;
}): readonly string[] {
  const problems: string[] = [];
  if (
    typeof input.kind !== "string" ||
    !FEEDBACK_FIXTURE_KINDS.includes(input.kind)
  ) {
    problems.push(
      `kind: expected one of ${FEEDBACK_FIXTURE_KINDS.join(" | ")}, got ${JSON.stringify(input.kind ?? null)}`,
    );
  }
  if (typeof input.target !== "string" || input.target.trim().length === 0) {
    problems.push("target: expected a non-empty canonical item or source id");
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    problems.push("note: expected a string when present");
  }
  return problems;
}

/**
 * Submit one feedback control (idempotent per (kind, target) — the
 * service's own law: re-submitting answers the existing record).
 */
export function submitFixtureFeedback(input: {
  readonly kind: string;
  readonly target: string;
  readonly note?: string | null;
}): FixtureFeedbackRecord {
  const key = keyOf(input.kind, input.target);
  const existing = records.get(key);
  if (existing !== undefined) return existing;
  const record: FixtureFeedbackRecord = {
    id: `wfxfb_${String(recordCounter).padStart(22, "0")}`,
    kind: input.kind,
    target: input.target,
    note: input.note ?? null,
    createdAt: FIXTURE_RECORD_TIME,
  };
  recordCounter += 1;
  records.set(key, record);
  return record;
}

/** List the recorded controls, oldest first (the reversibility read). */
export function listFixtureFeedback(target?: string): readonly FixtureFeedbackRecord[] {
  const all = [...records.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return target !== undefined ? all.filter((record) => record.target === target) : all;
}

/**
 * Undo one feedback control (the REAL delete — the record and its
 * composition effect vanish together). Answers null when the id is
 * unknown (the honest not-found).
 */
export function undoFixtureFeedback(id: string): FixtureFeedbackRecord | null {
  for (const [key, record] of records) {
    if (record.id === id) {
      records.delete(key);
      return record;
    }
  }
  return null;
}
