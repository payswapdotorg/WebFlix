/**
 * @wfx/connectors — reference connector lifecycle demonstration (WFX-013).
 *
 * A PURE demonstration that the reference connector transitions cleanly
 * through the WFX-003 lifecycle FSM:
 *
 * ```text
 *   registered ──initialize()──> initialized ──dispose()──> disposed
 * ```
 *
 * ("created" in the WFX-013 packet is the factory-fresh `registered`
 * state — the SDK's FSM name for it.)
 *
 * The demo also demonstrates the SDK's ERROR-CHANNEL SPLIT (lifecycle.ts),
 * which this module deliberately does not fight:
 * - Lifecycle misuse (an operation before `initialize()`, an operation after
 *   `dispose()`, a double `dispose()`) is a PROGRAMMER error and surfaces as
 *   a TYPED `LifecycleError` thrown by the SDK — the demo catches it and
 *   records its typed fields (`from`, `attempted`) in the report.
 * - Operational failures (an unsupported capability) are runtime realities
 *   and surface as typed `ConnectorResult` errors RETURNED to the caller —
 *   the demo records one (`executeAction` → `unsupported`) as proof that
 *   operational failures never take the throw channel.
 *
 * Purity: the demo builds its own connector instance, performs no I/O, and
 * reads no clock or entropy — running it twice yields identical reports
 * (asserted in tests). It is a demonstration, not a test helper: nothing in
 * the SDK or the reference connector depends on it.
 */

import type { ConnectorContext } from "@wfx/domain";

import { LifecycleError, type LifecycleState } from "../lifecycle";

import { createReferenceConnector, type ReferenceConnector } from "./connector";
import { REFERENCE_CONNECTOR_ID } from "./descriptor";

/** Deterministic context used by the demonstration (fixed, non-secret values). */
const DEMO_CONTEXT: ConnectorContext = { userId: "wfx-lifecycle-demo-user", locale: "en-US" };

/** The typed outcome of one refusal probe. */
interface RefusalOutcome {
  readonly threwLifecycleError: boolean;
  readonly from: LifecycleState | undefined;
  readonly attempted: string | undefined;
}

/** A probe whose expected outcome is a typed `LifecycleError` refusal. */
export interface LifecycleDemoRefusal {
  /** Which refusal was probed. */
  readonly phase:
    | "operation-before-initialize"
    | "operation-after-dispose"
    | "double-dispose";
  /** True when the SDK threw its typed `LifecycleError` for this probe. */
  readonly threwLifecycleError: boolean;
  /** The FSM state the connector was in when the refusal happened. */
  readonly from: LifecycleState | undefined;
  /** The rejected action recorded by the typed error, when available. */
  readonly attempted: string | undefined;
}

/** The outcome of the operation attempted on the disposed connector. */
export interface LifecycleDemoPostDisposeOperation {
  readonly operation: "searchResult";
  readonly threwLifecycleError: boolean;
  readonly from: LifecycleState | undefined;
  readonly attempted: string | undefined;
}

/** The full, data-only report of one demonstration run. */
export interface LifecycleDemoReport {
  readonly connectorId: string;
  /** Every observed FSM state, in observation order. */
  readonly states: readonly LifecycleState[];
  /** True when the walk was exactly registered → initialized → disposed. */
  readonly cleanTransition: boolean;
  /** The operation attempted on the DISPOSED connector and its typed outcome. */
  readonly postDisposeOperation: LifecycleDemoPostDisposeOperation;
  /** All refusal probes (pre-initialize operation, post-dispose operation, double dispose). */
  readonly refusals: readonly LifecycleDemoRefusal[];
  /**
   * True when an operational failure (`executeAction` on the initialized
   * connector) came back as a TYPED RESULT (`ok: false`, `unsupported`)
   * rather than a throw — the error-channel split, proven in one run.
   */
  readonly operationalUnsupportedReturned: boolean;
  /** Ordered human-readable narration of the demonstration. */
  readonly observations: readonly string[];
}

/** Extract the typed fields of a thrown value when it is the SDK's LifecycleError. */
function classify(thrown: unknown): RefusalOutcome {
  if (thrown instanceof LifecycleError) {
    return { threwLifecycleError: true, from: thrown.from, attempted: thrown.attempted };
  }
  return { threwLifecycleError: false, from: undefined, attempted: undefined };
}

/** Run an operation the FSM must refuse; capture the typed refusal outcome. */
async function probe(operation: () => Promise<unknown>): Promise<RefusalOutcome> {
  try {
    await operation();
    return { threwLifecycleError: false, from: undefined, attempted: undefined };
  } catch (thrown) {
    return classify(thrown);
  }
}

/**
 * Run the demonstration:
 * 1. create the connector (registered);
 * 2. attempt an operation → typed `LifecycleError` (programmer-error channel);
 * 3. `initialize()` → initialized; prove it is operational (search: typed ok);
 * 4. prove the operational channel: `executeAction` → typed `unsupported`
 *    result, RETURNED not thrown;
 * 5. `dispose()` → disposed;
 * 6. attempt an operation → typed `LifecycleError` from `disposed`;
 * 7. attempt a double `dispose()` → typed `LifecycleError`.
 *
 * Every step is recorded; nothing is asserted or thrown here.
 */
export async function demonstrateReferenceConnectorLifecycle(): Promise<LifecycleDemoReport> {
  const connector: ReferenceConnector = createReferenceConnector();
  const states: LifecycleState[] = [connector.state()];
  const observations: string[] = [
    `factory-fresh connector '${REFERENCE_CONNECTOR_ID}' is '${connector.state()}' (the packet's "created")`,
  ];

  // 2. operation before initialize → programmer-error channel (typed throw)
  const refusalBefore: LifecycleDemoRefusal = {
    phase: "operation-before-initialize",
    ...(await probe(() => connector.searchResult(DEMO_CONTEXT, "aurora"))),
  };
  observations.push(
    refusalBefore.threwLifecycleError
      ? `search before initialize threw typed LifecycleError (from '${String(refusalBefore.from)}', attempted '${String(refusalBefore.attempted)}')`
      : "search before initialize did NOT throw a LifecycleError — SDK invariant broken",
  );

  // 3. initialize → operational proof
  await connector.initialize();
  states.push(connector.state());
  observations.push(`initialize() transitioned the connector to '${connector.state()}'`);

  const searchOutcome = await connector.searchResult(DEMO_CONTEXT, "aurora");
  const hitCount = searchOutcome.ok ? searchOutcome.value.length : 0;
  observations.push(
    searchOutcome.ok
      ? `search for 'aurora' while initialized: ok with ${hitCount} deterministic hit(s)`
      : `search for 'aurora' while initialized unexpectedly failed (${searchOutcome.error.kind})`,
  );

  // 4. operational channel proof: unsupported is RETURNED, never thrown
  const actionOutcome = await connector.executeActionResult(DEMO_CONTEXT, {
    type: "like",
    connectorId: REFERENCE_CONNECTOR_ID,
    externalRef: "ref:movie-aurora",
  });
  const operationalUnsupportedReturned =
    !actionOutcome.ok && actionOutcome.error.kind === "unsupported";
  observations.push(
    operationalUnsupportedReturned
      ? "executeAction(like) while initialized RETURNED a typed unsupported result (operational channel — no throw)"
      : "executeAction(like) while initialized did not return typed unsupported — read-only invariant broken",
  );

  // 5. dispose
  await connector.dispose();
  states.push(connector.state());
  observations.push(`dispose() transitioned the connector to '${connector.state()}'`);

  // 6. operation after dispose → programmer-error channel (typed throw)
  const postDispose: LifecycleDemoPostDisposeOperation = {
    operation: "searchResult",
    ...(await probe(() => connector.searchResult(DEMO_CONTEXT, "aurora"))),
  };
  const refusalAfter: LifecycleDemoRefusal = {
    phase: "operation-after-dispose",
    threwLifecycleError: postDispose.threwLifecycleError,
    from: postDispose.from,
    attempted: postDispose.attempted,
  };
  observations.push(
    postDispose.threwLifecycleError
      ? `searchResult after dispose threw typed LifecycleError (from '${String(postDispose.from)}', attempted '${String(postDispose.attempted)}')`
      : "searchResult after dispose did NOT throw a LifecycleError — SDK invariant broken",
  );

  // 7. double dispose → programmer-error channel (typed throw)
  const refusalDoubleDispose: LifecycleDemoRefusal = {
    phase: "double-dispose",
    ...(await probe(() => connector.dispose())),
  };
  observations.push(
    refusalDoubleDispose.threwLifecycleError
      ? `double dispose threw typed LifecycleError (from '${String(refusalDoubleDispose.from)}', attempted '${String(refusalDoubleDispose.attempted)}')`
      : "double dispose did NOT throw a LifecycleError — SDK invariant broken",
  );

  const cleanTransition =
    states.length === 3 &&
    states[0] === "registered" &&
    states[1] === "initialized" &&
    states[2] === "disposed" &&
    refusalBefore.threwLifecycleError &&
    postDispose.threwLifecycleError &&
    refusalDoubleDispose.threwLifecycleError &&
    operationalUnsupportedReturned;

  return {
    connectorId: REFERENCE_CONNECTOR_ID,
    states,
    cleanTransition,
    postDisposeOperation: postDispose,
    refusals: [refusalBefore, refusalAfter, refusalDoubleDispose],
    operationalUnsupportedReturned,
    observations,
  };
}
