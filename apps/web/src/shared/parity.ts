/**
 * @wfx/app-web — the cross-platform parity invariant (WFX-040, Lane C).
 *
 * `assertParity(runtimeA, runtimeB)` is the machine-checked proof that the
 * three client shells expose IDENTICAL call surfaces and IDENTICAL event
 * vocabulary on the same fixtures — the frozen cross-platform strategy's
 * "All share domain semantics and event vocabulary" made executable:
 *
 * 1. METHOD PARITY — both runtimes expose the same own-property surface
 *    (accessors + methods), including every member of
 *    `REQUIRED_CLIENT_RUNTIME_SURFACE`.
 * 2. GOLDEN-FLOW PARITY — the same golden fixture flow (watch feed →
 *    playback start → like action → library read) returns deeply identical
 *    platform-INDEPENDENT values on both runtimes: feed pages, action
 *    receipts, library entries, and — strongest — the full frozen
 *    `EntertainmentEvent` stream (platform identity must NEVER leak into
 *    events; the three clients emit byte-identical events).
 * 3. OUTCOME-SHAPE PARITY — platform-DEPENDENT outputs (the resolver's
 *    chosen mode, the precedence trace content, the background decision)
 *    are NOT compared value-wise (they differ BY DESIGN — web resolves
 *    `embed`, desktop/mobile `native`); their SHAPES are: valid modes,
 *    one trace line per frozen playback mode, valid decision actions.
 * 4. ERROR-TAXONOMY PARITY — the same unresolvable probe fails with the
 *    SAME `ExperienceResult` reason on both platforms.
 *
 * The helper is a TEST helper (drives the runtimes; mutates their fixture
 * ports' id sequences and event logs) and returns a typed `ParityReport`
 * — never a bare boolean, so a failure prints its differences. It reports
 * `ok: false` instead of throwing, except for genuine caller misuse of the
 * helper itself (malformed ctx throws the typed `ExperienceError`, same
 * channel as the rest of the client layer).
 *
 * PRECONDITION (typed-checked, reported when unmet): both runtimes are
 * bound to `makeFixturePorts()` fixture ports — parity observes the event
 * stream through the recording sink. A runtime on non-fixture ports is
 * reported, never silently skipped.
 */

import { PLAYBACK_MODES } from "@wfx/domain";

import type { ExperienceContext, FixturePorts, Ports } from "@wfx/experience";
import {
  FakeConnectorPort,
  FixedClock,
  RecordingEventSink,
  SequentialIdGen,
  assertValidExperienceContext,
} from "@wfx/experience";

import type { ClientRuntime } from "./runtime";
import type { BackgroundDecision } from "./capabilities";

// ---------------------------------------------------------------------------
// The parity probe fixtures
// ---------------------------------------------------------------------------

/**
 * The golden parity context. Deliberately NOT a fixture-catalog value: any
 * deterministic context drives identical events on identical fixtures.
 */
export const PARITY_CONTEXT: Readonly<ExperienceContext> = Object.freeze({
  userId: "wfx-parity-user",
  sessionId: "wfx-parity-session",
  locale: "en",
});

/**
 * The golden feed query — hits the multi-mode fixture item ("Asteroid
 * Drift": browser + native + external + embed realizations), so every
 * platform has a real resolution decision to make.
 */
export const PARITY_FEED_QUERY = "drift";

/** The external ref that resolves to NOTHING — the error-taxonomy probe. */
export const PARITY_MISSING_REF = "wfx-parity-missing";

/**
 * The members every `ClientRuntime` must expose (methods + accessors).
 * Drift against this list is a parity violation, machine-reported.
 */
export const REQUIRED_CLIENT_RUNTIME_SURFACE: readonly string[] = [
  "platform",
  "profile",
  "device",
  "adapter",
  "engine",
  "ports",
  "getFeed",
  "startPlayback",
  "library",
  "actions",
  "surface",
  "background",
];

// ---------------------------------------------------------------------------
// ParityReport
// ---------------------------------------------------------------------------

/** The machine-checked parity verdict with full diagnostics. */
export interface ParityReport {
  /** True iff every parity check passed (no differences recorded). */
  readonly ok: boolean;
  /** Every recorded parity violation, human-readable (empty iff ok). */
  readonly differences: readonly string[];
  /** Runtime A's own-property surface (sorted). */
  readonly surfaceA: readonly string[];
  /** Runtime B's own-property surface (sorted). */
  readonly surfaceB: readonly string[];
  /** The frozen event `type` sequence emitted by runtime A on the golden flow. */
  readonly eventVocabularyA: readonly string[];
  /** The frozen event `type` sequence emitted by runtime B on the golden flow. */
  readonly eventVocabularyB: readonly string[];
  /** The playback mode runtime A's resolver chose on the golden item (null: not driven). */
  readonly modeA: string | null;
  /** The playback mode runtime B's resolver chose on the golden item (null: not driven). */
  readonly modeB: string | null;
  /** The failure reason runtime A produced on the unresolvable probe (null: not driven). */
  readonly errorReasonA: string | null;
  /** The failure reason runtime B produced on the unresolvable probe (null: not driven). */
  readonly errorReasonB: string | null;
}

// ---------------------------------------------------------------------------
// Helpers (deterministic, dependency-free)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON for parity comparison: object keys sorted recursively,
 * `undefined`-valued entries dropped (absent ≡ undefined). Only applied to
 * JSON-safe data (feeds, events, receipts, library entries) — never to
 * ports or adapters.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return typeof value === "undefined" ? "undefined" : JSON.stringify(value) ?? "unserializable";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record)
    .filter(([, entry]) => typeof entry !== "undefined")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function isPlaybackModeString(value: unknown): boolean {
  return typeof value === "string" && (PLAYBACK_MODES as readonly string[]).includes(value);
}

/** Guard the fixture-ports precondition; report (never skip) when unmet. */
function asFixturePorts(ports: Ports, label: string, differences: string[]): FixturePorts | null {
  if (
    ports.connector instanceof FakeConnectorPort &&
    ports.events instanceof RecordingEventSink &&
    ports.clock instanceof FixedClock &&
    ports.ids instanceof SequentialIdGen
  ) {
    return ports as FixturePorts;
  }
  differences.push(
    `runtime ${label} is not bound to fixture ports (makeFixturePorts) — parity cannot observe the event stream`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// assertParity
// ---------------------------------------------------------------------------

/**
 * Machine-check the parity invariant between two client runtimes on the
 * same fixture flow. Drives BOTH runtimes (feed → start → like → library →
 * surface → background → unresolvable probe) and compares everything that
 * must be platform-independent, shape-checking everything that is not.
 *
 * @param a   the first runtime (on `makeFixturePorts()`).
 * @param b   the second runtime (on its own `makeFixturePorts()`).
 * @param ctx the shared experience context (default: {@link PARITY_CONTEXT}).
 * @returns the typed parity report — `ok: false` carries every difference.
 * @throws `ExperienceError` for a malformed context (misuse of the helper).
 */
export async function assertParity(
  a: ClientRuntime,
  b: ClientRuntime,
  ctx: ExperienceContext = PARITY_CONTEXT,
): Promise<ParityReport> {
  assertValidExperienceContext(ctx);

  const differences: string[] = [];
  const surfaceA = Object.keys(a).sort();
  const surfaceB = Object.keys(b).sort();
  let eventVocabularyA: string[] = [];
  let eventVocabularyB: string[] = [];
  let modeA: string | null = null;
  let modeB: string | null = null;
  let errorReasonA: string | null = null;
  let errorReasonB: string | null = null;

  // --- 1. method surface parity ----------------------------------------------
  if (!stringArraysEqual(surfaceA, surfaceB)) {
    differences.push(
      `call surfaces differ: A=[${surfaceA.join(", ")}] B=[${surfaceB.join(", ")}]`,
    );
  }
  for (const member of REQUIRED_CLIENT_RUNTIME_SURFACE) {
    if (!surfaceA.includes(member)) {
      differences.push(`runtime A is missing the required surface member '${member}'`);
    }
    if (!surfaceB.includes(member)) {
      differences.push(`runtime B is missing the required surface member '${member}'`);
    }
  }

  // --- 2. fixture-ports precondition ----------------------------------------
  const fixtureA = asFixturePorts(a.ports, "A", differences);
  const fixtureB = asFixturePorts(b.ports, "B", differences);

  if (differences.length > 0 || fixtureA === null || fixtureB === null) {
    // Surface drift or non-observable ports: no flows are driven (a drifted
    // runtime may crash the golden flow — the drift IS the finding).
    return {
      ok: false,
      differences,
      surfaceA,
      surfaceB,
      eventVocabularyA,
      eventVocabularyB,
      modeA,
      modeB,
      errorReasonA,
      errorReasonB,
    };
  }

  // --- 3. golden flow: watch feed --------------------------------------------
  const pageA = await a.getFeed(ctx, "watch", PARITY_FEED_QUERY);
  const pageB = await b.getFeed(ctx, "watch", PARITY_FEED_QUERY);
  if (canonicalJson(pageA) !== canonicalJson(pageB)) {
    differences.push(
      "watch feed pages differ across platforms — the WFX-005 feed use-case is platform-neutral and must agree on identical fixtures",
    );
  }
  const cardA = pageA.cards[0];
  const cardB = pageB.cards[0];
  if (cardA === undefined || cardB === undefined) {
    differences.push(
      `golden fixture query '${PARITY_FEED_QUERY}' produced no watch cards — the parity fixtures are broken`,
    );
  } else {
    // --- golden flow: playback start (platform-differentiated resolution) --
    const startA = await a.startPlayback(ctx, {
      item: cardA.item,
      externalRef: cardA.realization.externalRef,
    });
    const startB = await b.startPlayback(ctx, {
      item: cardB.item,
      externalRef: cardB.realization.externalRef,
    });
    if (startA.ok !== startB.ok) {
      differences.push(
        `startPlayback outcome status differs: A ok=${String(startA.ok)}, B ok=${String(startB.ok)}`,
      );
    }
    if (startA.ok && startB.ok) {
      modeA = startA.mode;
      modeB = startB.mode;
      if (!isPlaybackModeString(startA.mode)) {
        differences.push(`runtime A chose the non-mode value '${String(startA.mode)}'`);
      }
      if (!isPlaybackModeString(startB.mode)) {
        differences.push(`runtime B chose the non-mode value '${String(startB.mode)}'`);
      }
      if (startA.value.id !== startB.value.id) {
        differences.push(
          "playback session ids differ across platforms — identical fixtures must mint identical id sequences",
        );
      }
      if (startA.value.itemId !== startB.value.itemId) {
        differences.push("playback session item ids differ across platforms");
      }
      if (startA.precedenceTrace.length !== startB.precedenceTrace.length) {
        differences.push(
          `precedence trace shapes differ: A has ${startA.precedenceTrace.length} lines, B has ${startB.precedenceTrace.length} lines (one per frozen playback mode expected)`,
        );
      }
    }

    // --- golden flow: user action (like) ------------------------------------
    const likeA = await a.actions(ctx, {
      type: "like",
      connectorId: cardA.realization.connectorId,
      externalRef: cardA.realization.externalRef,
      itemId: cardA.item.id,
    });
    const likeB = await b.actions(ctx, {
      type: "like",
      connectorId: cardB.realization.connectorId,
      externalRef: cardB.realization.externalRef,
      itemId: cardB.item.id,
    });
    if (canonicalJson(likeA) !== canonicalJson(likeB)) {
      differences.push("user-action results differ across platforms (receipts must agree)");
    }

    // --- golden flow: surface resolution (shape parity only) ----------------
    const realizationsA = await fixtureA.connector.resolve(ctx, cardA.realization.externalRef);
    const realizationsB = await fixtureB.connector.resolve(ctx, cardB.realization.externalRef);
    const resolutionA = a.surface({ item: cardA.item, realizations: realizationsA });
    const resolutionB = b.surface({ item: cardB.item, realizations: realizationsB });
    if (resolutionA.ok !== resolutionB.ok) {
      differences.push("surface resolution outcome status differs across platforms");
    } else if (resolutionA.ok && resolutionB.ok) {
      if (resolutionA.precedenceTrace.length !== PLAYBACK_MODES.length) {
        differences.push(
          `runtime A's precedence trace has ${resolutionA.precedenceTrace.length} lines (expected one per frozen playback mode)`,
        );
      }
      if (resolutionB.precedenceTrace.length !== PLAYBACK_MODES.length) {
        differences.push(
          `runtime B's precedence trace has ${resolutionB.precedenceTrace.length} lines (expected one per frozen playback mode)`,
        );
      }
    }

    // --- error taxonomy probe ------------------------------------------------
    const errorA = await a.startPlayback(ctx, { item: cardA.item, externalRef: PARITY_MISSING_REF });
    const errorB = await b.startPlayback(ctx, { item: cardB.item, externalRef: PARITY_MISSING_REF });
    if (errorA.ok || errorB.ok) {
      differences.push(
        `the unresolvable probe ref '${PARITY_MISSING_REF}' unexpectedly resolved (A ok=${String(errorA.ok)}, B ok=${String(errorB.ok)})`,
      );
    } else {
      errorReasonA = errorA.reason;
      errorReasonB = errorB.reason;
      if (errorA.reason !== errorB.reason) {
        differences.push(
          `error taxonomy differs on the unresolvable probe: '${errorA.reason}' vs '${errorB.reason}'`,
        );
      }
    }
  }

  // --- golden flow: library --------------------------------------------------
  const libraryA = await a.library(ctx);
  const libraryB = await b.library(ctx);
  if (canonicalJson(libraryA) !== canonicalJson(libraryB)) {
    differences.push("library results differ across platforms");
  }

  // --- golden flow: background decision (shape parity only) ------------------
  const backgroundA = a.background();
  const backgroundB = b.background();
  const backgroundChecks: readonly [string, BackgroundDecision][] = [
    ["A", backgroundA],
    ["B", backgroundB],
  ];
  for (const [label, decision] of backgroundChecks) {
    // Runtime shape guards (untyped callers included) — captured as unknown
    // so the checks stay honest rather than narrowed away by the compiler.
    const action: unknown = decision.action;
    const reason: unknown = decision.reason;
    if (action !== "continue" && action !== "pause") {
      differences.push(`runtime ${label} produced the invalid background action '${String(action)}'`);
    }
    if (typeof reason !== "string" || reason.length === 0) {
      differences.push(`runtime ${label} produced a background decision without a reason`);
    }
  }

  // --- 4. event vocabulary + deep event parity (the core invariant) -----------
  eventVocabularyA = fixtureA.events.events.map((event) => event.type);
  eventVocabularyB = fixtureB.events.events.map((event) => event.type);
  if (!stringArraysEqual(eventVocabularyA, eventVocabularyB)) {
    differences.push(
      `event vocabulary differs: A=[${eventVocabularyA.join(", ")}] B=[${eventVocabularyB.join(", ")}]`,
    );
  }
  if (canonicalJson(fixtureA.events.events) !== canonicalJson(fixtureB.events.events)) {
    differences.push(
      "emitted EntertainmentEvents are not deeply identical across platforms — platform identity leaked into the event stream",
    );
  }

  return {
    ok: differences.length === 0,
    differences,
    surfaceA,
    surfaceB,
    eventVocabularyA,
    eventVocabularyB,
    modeA,
    modeB,
    errorReasonA,
    errorReasonB,
  };
}
