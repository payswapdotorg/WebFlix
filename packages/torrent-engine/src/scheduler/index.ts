/**
 * @wfx/torrent-engine — the playback-aware scheduler module barrel (R12).
 *
 * The layering law (the freeze's runtime diagram): the scheduler sits
 * INSIDE the torrent engine, ON TOP of R11's session/piece machinery,
 * and feeds the native-media range gateway. Everything here is
 * engine-internal vocabulary; the PUBLIC surface is re-exported through
 * the package entry (`src/index.ts`) — consumers import from
 * `@wfx/torrent-engine` only (the lane law).
 *
 * - config.ts          — the three-knob config surface + validation
 * - geometry.ts        — the byte↔piece map of one playable file (the map
 *                        R10's scheduler had to defer to R12)
 * - windows.ts         — the pure deadline mapping (startup / runway /
 *                        seek burst / range requests / completion fallback)
 * - state-machine.ts   — idle → startup → steady → seeking →
 *                        background-completion, honest transitions
 * - truth.ts           — the truthful buffering surface (runway, at-risk
 *                        deadlines, stall kinds, availability horizon)
 * - reads.ts           — ordered integrity-gated byte reads
 * - session-scheduler.ts — the per-session controller the engine drives
 */

export * from "./config";
export * from "./geometry";
export * from "./windows";
export * from "./state-machine";
export * from "./truth";
export * from "./reads";
export * from "./session-scheduler";
