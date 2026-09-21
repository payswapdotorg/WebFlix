/**
 * @wfx/model-fabric — open-models folder entry (R23-G/H/I/J).
 *
 * - `open-model.ts`         — R23-J: the huggingface-open-model provider
 *                             category — the descriptor (model id,
 *                             revision, REAL license with the
 *                             code/weights distinction, supported
 *                             tasks, execution locations, privacy
 *                             class, cost, latency profile, hardware
 *                             requirements, provenance), validation,
 *                             the executor seam (NO Hugging Face SDK in
 *                             shared product logic), the registry
 *                             adapter, and the model-authority boundary
 *                             (no model may authorize a playback/
 *                             acquisition action).
 * - `catalog.ts`            — R23-J: the researched open-model catalog
 *                             (the plan's candidates with their real
 *                             licenses — the R2T2 code-Apache-2.0 /
 *                             weights-NetEase split recorded exactly).
 * - `live-asr.ts`           — R23-G: the R2T2 live/streaming
 *                             low-latency ASR route — the routing
 *                             contract (R2T2 -> live; MOSS/Whisper ->
 *                             long-form/batch; provider/local model ->
 *                             the alternative policy choice), the
 *                             legal-audio precondition gate, and the
 *                             frozen R2T2 envelope constants.
 * - `discovery-features.ts` — R23-H: the multimodal discovery feature
 *                             contracts — the plan's feature list with
 *                             honest R23-F artifact prerequisites,
 *                             contributing models, and the ownership
 *                             law (models generate signals; the
 *                             Recommendation OS owns user policy and
 *                             authorization).
 * - `local-inference.ts`    — R23-I: the privacy/local inference path
 *                             contract — the Transformers.js/WebGPU
 *                             task vocabulary, the WebGPU-optional
 *                             fallback chain (webgpu -> wasm -> remote
 *                             with typed privacy impact), and the
 *                             private-preprocessing payload law.
 */

export * from "./open-model";
export * from "./catalog";
export * from "./live-asr";
export * from "./discovery-features";
export * from "./local-inference";
