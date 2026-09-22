// @wfx/domain — frozen shared contracts + lane extension types.
// The frozen half is generated from docs/architecture/contracts.md; never edit it.
export * from "./contracts/frozen";
export * from "./contracts/extensions";
// R26-W1 — the content artwork contract (lane-owned, add-only: the typed
// carrier for real source artwork through the shared content model).
export * from "./contracts/artwork";

// WFX-002 — canonical domain layer built around the frozen contracts.
export * from "./ids";
export * from "./events";
export * from "./device";
export * from "./validation";
export * from "./intent/index";
export * from "./graph/index";
export * from "./feeds/index";
