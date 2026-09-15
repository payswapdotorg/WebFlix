/**
 * @wfx/native-media — public entry (WFX-004, Lane B).
 *
 * Surface (all re-exported here; import ONLY from "@wfx/native-media"):
 * - errors.ts    — `NativeMediaErrorCode` taxonomy, `NativeMediaError`,
 *                  retryability table (`isRetryable`), type guards
 *                  (`isNativeMediaError`), `InvalidTransitionError`
 * - session.ts   — `SESSION_STATES`, `ALLOWED_TRANSITIONS`,
 *                  `canTransition`, pure `transition`, `makeSession` factory
 * - range.ts     — local HTTP range contract: `RangeRequest`/`RangeResponse`,
 *                  `parseRangeHeader`, `satisfiable`, `resolveRange`,
 *                  `makeRangeResponse`, `contentRangeHeaderValue`
 * - service.ts   — `ServiceResponse` envelope, `NativeMediaService`
 *                  boundary, `PlayCommand`/`OpenSessionRequest`,
 *                  `createNativeMediaService` pure adapter,
 *                  `mapEngineError`, optional `RangeAccessEngine` extension
 * - fixtures.ts  — TEST FIXTURES (`stubEngine`, `sampleSessions`,
 *                  `sampleErrors`, `sampleRangeRequests`) — never wired
 *                  as production
 * - engine/process.ts     — WFX-014 engine process boundary: versioned
 *                  wire DTOs (`EngineCommand`/`EngineEvent`,
 *                  `PROTOCOL_VERSION`), `NativeEngineProcess`/
 *                  `EngineHandle`, runtime guards, DTO mappers
 * - engine/simulation.ts  — WFX-014 SIMULATION engine (TEST/DEV only):
 *                  frozen interface + range extension over a fake asset
 *                  registry with deterministic timer-driven buffering
 * - engine/adapter.ts     — WFX-014 engine adapter: any
 *                  `NativeEngineProcess` → frozen `NativeMediaEngine`
 *                  (marshalling, event→state mapping, timeouts, crash
 *                  detection) + the in-process simulation pipe
 * - engine/cache.ts       — WFX-014 pure cache policy accounting
 *                  (`CachePolicy`, `CacheTracker`, `shouldAdmit`,
 *                  `evictList`) — no I/O, the real engine owns the bytes
 * - scheduler/*           — WFX-023 deadline-aware playback scheduler:
 *                  model (demand/priority/config), pure `planPriorities`,
 *                  `createScheduler` driver (injected clock, idempotent
 *                  foreground-first ticks), `shouldStallProtect` signal
 *
 * Domain types (`NativeMediaSession`, `NativeMediaEngine`) come from
 * `@wfx/domain`, the frozen public entry — never deep paths.
 */

export * from "./errors";
export * from "./session";
export * from "./range";
export * from "./service";
export * from "./fixtures";
export * from "./engine/process";
export * from "./engine/simulation";
export * from "./engine/adapter";
export * from "./engine/cache";
export * from "./gateway/bytes";
export * from "./gateway/request";
export * from "./gateway/response";
export * from "./gateway/server";
export * from "./gateway/test-server";
export * from "./scheduler/model";
export * from "./scheduler/plan";
export * from "./scheduler/drive";
export * from "./scheduler/stall-guard";
