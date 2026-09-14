/**
 * @wfx/native-media — engine module barrel (WFX-014, Lane B).
 *
 * Surface (import from "@wfx/native-media"):
 * - process.ts    — the engine process boundary / wire contract:
 *                   `PROTOCOL_VERSION`, `EngineConfig`, `EngineCommand`,
 *                   `EngineEvent`, JSON codecs (`serializeCommand`/
 *                   `parseCommand`/`serializeEvent`/`parseEvent`), structural
 *                   guards, base64 wire helpers, `NativeEngineProcess` /
 *                   `EngineHandle`
 * - simulation.ts  — SIMULATION ENGINE (TEST/DEV, never production):
 *                   `createSimulationEngine`, fake-asset registry
 *                   (`FakeAsset`), deterministic `tick`/`simulationMediaByte`,
 *                   optional `StatusAccessEngine` extension
 * - adapter.ts     — `createEngineAdapter` (any `NativeEngineProcess` → the
 *                   frozen engine interface + range/status extensions) and
 *                   `createInProcessEngineProcess` (simulation-backed
 *                   in-process pipe, no subprocess)
 * - cache.ts       — pure local cache policy: `CachePolicy`, `CacheTracker`,
 *                   `shouldAdmit`, `evictList` (no I/O — decisions only)
 */

export * from "./process";
export * from "./simulation";
export * from "./adapter";
export * from "./cache";
