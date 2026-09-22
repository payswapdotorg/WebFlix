/**
 * @wfx/model-fabric — media-intelligence folder entry (R23-F).
 *
 * - `artifacts.ts` — the typed media-intelligence artifact contracts:
 *                   the frozen stage chain, the honest provenance block
 *                   every artifact carries, the per-artifact shapes
 *                   (transcript segments / speech events / chapters-
 *                   scenes / visual concepts / video+text embeddings /
 *                   searchable moments / the canonical semantic index),
 *                   the closed minimum derived-artifact union, set
 *                   validation, and the coverage audit.
 * - `read-transport.ts` — R26-W1: the intelligence READ TRANSPORT
 *                   contract — the canonical served/not-served seam the
 *                   hosts bind (fixture double, Experience-API HTTP
 *                   binding, future native binding) + the wire
 *                   vocabulary of the service-side
 *                   `/experience/intelligence` route (the missing
 *                   production dependency named honestly until the API
 *                   lane lands it).
 */

export * from "./artifacts";
export * from "./read-transport";
