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
 * - engine/      — WFX-014 engine module: process boundary / wire contract
 *                  (`process.ts`), SIMULATION engine (`simulation.ts`,
 *                  TEST/DEV only), engine adapter + in-process pipe
 *                  (`adapter.ts`), pure cache policy (`cache.ts`)
 *
 * Domain types (`NativeMediaSession`, `NativeMediaEngine`) come from
 * `@wfx/domain`, the frozen public entry — never deep paths.
 */

export * from "./errors";
export * from "./session";
export * from "./range";
export * from "./service";
export * from "./fixtures";
export * from "./engine/index";
