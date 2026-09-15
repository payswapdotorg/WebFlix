// @wfx/app-web — Lane C client surface.
//
// WFX-040: this entry is the PUBLIC surface of the shared cross-platform
// client layer. The web app owns `src/shared/` (capabilities, runtime,
// parity); apps/desktop and apps/mobile consume it through this workspace
// package entry (`import { createClientRuntime, ... } from "@wfx/app-web"`)
// — the lane rules forbid deep imports and relative escapes between apps.
//
// The web-specific shell lives in `src/main.ts` (not re-exported here: it is
// web wiring, not shared surface).

export * from "./shared/capabilities";
export * from "./shared/runtime";
export * from "./shared/parity";
