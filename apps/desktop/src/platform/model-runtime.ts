/**
 * @wfx/app-desktop — the local model runtime packaging (R23-W3, the R23-J
 * `local-desktop` execution truth).
 *
 * THE LAW THIS MODULE FREEZES (the lane's model-runtime-packaging clause):
 * model runtime packaging MUST NOT FAKE AVAILABILITY. The Desktop app may
 * package a local model runtime (the open-model executor's local-desktop
 * hop — the `OpenModelExecutorPort` seam of `@wfx/model-fabric`), and the
 * runtime's availability is a PROBED TRUTH, never an assumption:
 *
 * - AVAILABLE: the packaged runtime answers the probe (its own version
 *   truth) — local open-model execution is honestly offered;
 * - UNAVAILABLE: the typed unavailable state with its honest reason AND
 *   a recovery hint (an actionable next step — never stale "arrives
 *   later" language, never a fake-ready runtime).
 *
 * WHAT THIS MODULE IS NOT: a model runtime (no inference happens here),
 * an SDK client (NO Hugging Face/OpenAI/provider SDK lives in product
 * logic — the executor seam is the only invocation path), or a
 * capability claim without a real adapter path (an unprobed runtime is
 * unavailable, full stop).
 */

// ---------------------------------------------------------------------------
// The descriptor (what the Desktop packages)
// ---------------------------------------------------------------------------

/**
 * The local model runtime the Desktop app packages: the execution host
 * for open models whose descriptors declare the `local-desktop`
 * execution location (the R23-J provider category's local hop). The
 * descriptor is packaging TRUTH — what ships — never an availability
 * claim (availability is the probe's answer below).
 */
export interface DesktopModelRuntimeDescriptor {
  /** The runtime's stable id. */
  readonly runtimeId: string;
  /** The user-facing label. */
  readonly label: string;
  /** The execution location this runtime serves (the R23-J vocabulary). */
  readonly servesExecutionLocation: "local-desktop";
  /** What the runtime executes (one honest sentence). */
  readonly detail: string;
}

/** The packaged runtime's descriptor (the composition's own truth). */
export const DESKTOP_MODEL_RUNTIME: DesktopModelRuntimeDescriptor = {
  runtimeId: "wfx-desktop-model-runtime",
  label: "WebFlix local model runtime",
  servesExecutionLocation: "local-desktop",
  detail:
    "Runs open models that declare local-desktop execution — the model's weights and the inference both stay on this device.",
};

// ---------------------------------------------------------------------------
// The probe (the availability truth — never faked)
// ---------------------------------------------------------------------------

/** The typed availability truth of the packaged local model runtime. */
export type DesktopModelRuntimeStatus =
  | {
      /** The runtime answers — local open-model execution is honestly available. */
      kind: "available";
      /** The runtime's own version truth (its probe answer). */
      readonly version: string;
      /** One honest sentence about what is now possible. */
      readonly detail: string;
    }
  | {
      /** The typed unavailable state — NEVER a fake-ready runtime. */
      kind: "unavailable";
      /** The honest reason (what the probe observed). */
      readonly reason: string;
      /** The actionable recovery hint (a real next step, never "arrives later"). */
      readonly recoveryHint: string;
    };

/** The probe seam: how the composition asks the packaged runtime. */
export type DesktopModelRuntimeProbe = () => Promise<DesktopModelRuntimeStatus>;

/**
 * The honestly-unavailable probe: the composition binds this when no
 * local model runtime is packaged in this build. The typed unavailable
 * state carries the honest build truth + the actionable recovery hint —
 * never a fake `available`, never stale completion copy.
 */
export function createUnavailableModelRuntimeProbe(input?: {
  /** The honest reason override (default: not packaged in this build). */
  readonly reason?: string;
  /** The recovery-hint override (default: the Model & AI management path). */
  readonly recoveryHint?: string;
}): DesktopModelRuntimeProbe {
  const reason =
    input?.reason ??
    "the local model runtime is not packaged in this build";
  const recoveryHint =
    input?.recoveryHint ??
    "Install the WebFlix build that packages the local model runtime (Settings, under Model & AI, shows this same truth), or run these models through a self-hosted endpoint instead";
  return async () => ({
    kind: "unavailable",
    reason,
    recoveryHint,
  });
}

/**
 * The scripted-available probe — TESTS ONLY (the deterministic runtime
 * double's answer). Production compositions bind a probe over the REAL
 * packaged runtime (its own health/version surface); nothing in src/
 * constructs an available status without a real probe behind it.
 */
export function createScriptedModelRuntimeProbe(status: DesktopModelRuntimeStatus): DesktopModelRuntimeProbe {
  return async () => status;
}
