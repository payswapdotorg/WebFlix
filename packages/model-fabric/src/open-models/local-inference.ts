/**
 * @wfx/model-fabric — the privacy/local inference path contract (R23-I).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-I):
 * Hugging Face Transformers.js with WebGPU is used SELECTIVELY for
 * private local work — query embeddings, lightweight classification,
 * local-media transcript helpers where a browser model is small
 * enough, local search over user-owned media, and private
 * preprocessing that sends only necessary DERIVED text/features on to
 * remote models.
 *
 * THE WEBGPU-OPTIONAL LAW: WebGPU is OPTIONAL. The fallback chain is
 * frozen and typed — WebGPU when available, WASM in-browser inference
 * next, remote inference last — and every hop names its honest privacy
 * impact: the local hops keep input on-device
 * (`"local-only"`); the remote hop means INPUT LEAVES THE DEVICE
 * (`"input-leaves-device"`), which a local-only privacy policy REFUSES
 * (the typed `local-unavailable` state — the task stays local or stays
 * off, never silently leaving the device).
 *
 * WHAT THIS MODULE IS: PURE typed contracts + the fallback-chain
 * derivation. No Transformers.js import, no WebGPU probe, no model
 * loading — the browser runtime belongs to the platform adapter
 * (Worker 2's WebGPU feature probes bind THIS contract; a capability
 * claim without a real adapter path is drift). Shared product logic
 * sees only the task vocabulary, the environment truth, and the typed
 * route.
 */

// ---------------------------------------------------------------------------
// The local-inference task vocabulary (the plan's R23-I list)
// ---------------------------------------------------------------------------

/**
 * One private/local inference task — exactly the plan's R23-I list:
 *
 * - `query-embeddings` — embed search queries locally so the query
 *   text stays on-device while semantic search runs;
 * - `lightweight-classification` — small classification tasks a
 *   browser-sized model can carry honestly;
 * - `local-media-helpers` — transcript helpers over user-owned local
 *   media where a browser model is small enough;
 * - `local-search-own-media` — local semantic search over the user's
 *   own media (nothing leaves the device);
 * - `private-preprocessing` — preprocess locally, then send ONLY the
 *   necessary derived text/features to a remote model (never the raw
 *   input).
 */
export type LocalInferenceTaskKind =
  | "query-embeddings"
  | "lightweight-classification"
  | "local-media-helpers"
  | "local-search-own-media"
  | "private-preprocessing";

/** Every value of {@link LocalInferenceTaskKind}, in plan order. */
export const LOCAL_INFERENCE_TASK_KINDS: readonly LocalInferenceTaskKind[] = [
  "query-embeddings",
  "lightweight-classification",
  "local-media-helpers",
  "local-search-own-media",
  "private-preprocessing",
] as const;

/** Runtime membership check against the task union. */
export function isLocalInferenceTaskKind(
  x: unknown,
): x is LocalInferenceTaskKind {
  return (
    typeof x === "string" &&
    (LOCAL_INFERENCE_TASK_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The backend vocabulary + environment truth
// ---------------------------------------------------------------------------

/**
 * The local-inference backend, in fallback-chain order:
 * - `"webgpu"` — WebGPU-accelerated in-browser inference (fastest
 *   local hop; OPTIONAL — never assumed);
 * - `"wasm"` — WASM in-browser inference (the WebGPU-free local
 *   fallback);
 * - `"remote-fallback"` — remote inference through Model Fabric (the
 *   last hop; input leaves the device — the honest consequence).
 */
export type LocalInferenceBackend =
  | "webgpu"
  | "wasm"
  | "remote-fallback";

/** Every value of {@link LocalInferenceBackend}, in fallback-chain order. */
export const LOCAL_INFERENCE_BACKENDS: readonly LocalInferenceBackend[] = [
  "webgpu",
  "wasm",
  "remote-fallback",
] as const;

/** Runtime membership check against the backend union. */
export function isLocalInferenceBackend(
  x: unknown,
): x is LocalInferenceBackend {
  return (
    typeof x === "string" &&
    (LOCAL_INFERENCE_BACKENDS as readonly string[]).includes(x)
  );
}

/**
 * The privacy impact of one route hop — the honest consequence, typed:
 * - `"local-only"` — input never leaves the device (webgpu, wasm);
 * - `"input-leaves-device"` — input is sent to a remote service
 *   (remote-fallback; a local-only privacy policy refuses this hop).
 */
export type LocalInferencePrivacyImpact =
  | "local-only"
  | "input-leaves-device";

/** Every value of {@link LocalInferencePrivacyImpact}. */
export const LOCAL_INFERENCE_PRIVACY_IMPACTS: readonly LocalInferencePrivacyImpact[] =
  ["local-only", "input-leaves-device"] as const;

/** Runtime membership check against the privacy-impact union. */
export function isLocalInferencePrivacyImpact(
  x: unknown,
): x is LocalInferencePrivacyImpact {
  return (
    typeof x === "string" &&
    (LOCAL_INFERENCE_PRIVACY_IMPACTS as readonly string[]).includes(x)
  );
}

/**
 * The environment truth the adapter OBSERVES (never guesses): whether
 * WebGPU is available in this browser, and whether in-browser WASM
 * inference is available. Both are OPTIONAL truths — the chain degrades
 * honestly when either is absent.
 */
export interface LocalInferenceEnvironment {
  /** Whether WebGPU is available (the optional fast local hop). */
  readonly webgpuAvailable: boolean;
  /** Whether in-browser WASM inference is available (the local fallback). */
  readonly wasmAvailable: boolean;
}

// ---------------------------------------------------------------------------
// The fallback-chain route (the WebGPU-optional law, typed)
// ---------------------------------------------------------------------------

/** The privacy policy governing the route (the frozen ModelPolicy vocabulary). */
export type LocalInferencePrivacyPolicy =
  | "local-only"
  | "trusted-cloud"
  | "any-cloud";

/** Every value of {@link LocalInferencePrivacyPolicy}. */
export const LOCAL_INFERENCE_PRIVACY_POLICIES: readonly LocalInferencePrivacyPolicy[] =
  ["local-only", "trusted-cloud", "any-cloud"] as const;

/** Runtime membership check against the policy union. */
export function isLocalInferencePrivacyPolicy(
  x: unknown,
): x is LocalInferencePrivacyPolicy {
  return (
    typeof x === "string" &&
    (LOCAL_INFERENCE_PRIVACY_POLICIES as readonly string[]).includes(x)
  );
}

/** The route outcome of one local-inference task. */
export type LocalInferenceRoute =
  | {
      /** WebGPU in-browser inference (the fast local hop). */
      kind: "webgpu";
      readonly privacyImpact: "local-only";
      readonly detail: string;
    }
  | {
      /** WASM in-browser inference (the WebGPU-free local fallback). */
      kind: "wasm";
      readonly privacyImpact: "local-only";
      readonly detail: string;
    }
  | {
      /** Remote inference (the last hop — input leaves the device). */
      kind: "remote-fallback";
      readonly privacyImpact: "input-leaves-device";
      readonly detail: string;
    }
  | {
      /**
       * No local hop is available AND the policy is local-only — the
       * honest refusal (the task stays local or stays off, never
       * silently leaving the device).
       */
      kind: "local-unavailable";
      readonly detail: string;
      readonly recovery: string;
    };

/**
 * THE FALLBACK CHAIN (pure; the single derivation every local-inference
 * consumer consults):
 *
 * 1. WebGPU available -> `"webgpu"` (local-only impact);
 * 2. else WASM available -> `"wasm"` (local-only impact);
 * 3. else, when the privacy policy permits cloud (trusted-cloud /
 *    any-cloud) -> `"remote-fallback"` with the honest
 *    `"input-leaves-device"` impact;
 * 4. else -> `"local-unavailable"` (local-only policy, no local hop) —
 *    the typed refusal with a recovery hint, never a silent hop to a
 *    remote model.
 */
export function localInferenceRoute(
  task: LocalInferenceTaskKind,
  environment: LocalInferenceEnvironment,
  privacyPolicy: LocalInferencePrivacyPolicy,
): LocalInferenceRoute {
  if (environment.webgpuAvailable) {
    return {
      kind: "webgpu",
      privacyImpact: "local-only",
      detail: `This ${taskLabelOf(task)} runs privately in your browser with WebGPU — nothing leaves this device.`,
    };
  }
  if (environment.wasmAvailable) {
    return {
      kind: "wasm",
      privacyImpact: "local-only",
      detail: `This ${taskLabelOf(task)} runs privately in your browser (WebGPU is off, so it uses the slower in-browser fallback) — nothing leaves this device.`,
    };
  }
  if (privacyPolicy === "trusted-cloud" || privacyPolicy === "any-cloud") {
    return {
      kind: "remote-fallback",
      privacyImpact: "input-leaves-device",
      detail: `Your browser cannot run this ${taskLabelOf(task)} locally, so it runs remotely under your ${privacyPolicy} policy — the input leaves this device.`,
    };
  }
  return {
    kind: "local-unavailable",
    detail: `Your browser cannot run this ${taskLabelOf(task)} locally and your local-only privacy policy keeps it from leaving the device — it stays off, honestly.`,
    recovery:
      "Enable WebGPU or in-browser inference where your browser supports it, or relax the model privacy policy for this task.",
  };
}

/** The task's user label (the one derivation source). */
const TASK_LABELS: Readonly<Record<LocalInferenceTaskKind, string>> = {
  "query-embeddings": "search understanding",
  "lightweight-classification": "lightweight classification",
  "local-media-helpers": "local-media helper",
  "local-search-own-media": "own-media search",
  "private-preprocessing": "private preprocessing",
};

function taskLabelOf(task: LocalInferenceTaskKind): string {
  return TASK_LABELS[task];
}

// ---------------------------------------------------------------------------
// The local-hop law (machine-checkable)
// ---------------------------------------------------------------------------

/**
 * Is `backend` a LOCAL hop (input stays on-device)? WebGPU and WASM
 * are; the remote fallback is not (the privacy-impact derivation keys
 * on exactly this).
 */
export function isLocalInferenceBackendHop(
  backend: LocalInferenceBackend,
): boolean {
  return backend === "webgpu" || backend === "wasm";
}

/** The privacy impact of one backend hop (pure; total). */
export function privacyImpactOfLocalInferenceBackend(
  backend: LocalInferenceBackend,
): LocalInferencePrivacyImpact {
  return isLocalInferenceBackendHop(backend) ? "local-only" : "input-leaves-device";
}

/**
 * THE PRIVATE-PREPROCESSING CONTRACT, typed: when a task must go remote
 * (the remote fallback hop), what may be sent is ONLY the locally
 * derived text/features — never the raw input. This derivation answers
 * the lawful payload class for the remote hop of a
 * `private-preprocessing` task; adapters enforce it at their transport
 * boundary.
 */
export type PrivatePreprocessingPayloadClass =
  | "derived-text-only"
  | "derived-features-only";

/** The lawful payload class for the remote hop of private preprocessing. */
export function privatePreprocessingPayloadClass(): PrivatePreprocessingPayloadClass {
  return "derived-features-only";
}
