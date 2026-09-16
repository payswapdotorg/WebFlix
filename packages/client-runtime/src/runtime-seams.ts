/**
 * @wfx/client-runtime — the environment seams (R01).
 *
 * The runtime stays DETERMINISTIC: no wall clock, no randomness, no
 * globals. Time and identity are INJECTED seams (the same discipline as
 * `@wfx/experience`'s `Clock`/`IdGen` and the web host's
 * `SystemClock`/`CryptoUlidGen` — adapters supply real implementations,
 * tests inject fixed ones). The interfaces are re-declared here
 * (structurally identical) so this package depends only on
 * `@wfx/domain` + `@wfx/platform-contracts`.
 */

/** Time source. `now()` returns epoch milliseconds. */
export interface RuntimeClock {
  now(): number;
}

/**
 * Identifier source. `next()` returns a FRESH, UNIQUE, 26-character
 * Crockford Base32 ULID body (the canonical body format of `@wfx/domain`'s
 * `ids.ts` — first char in `[0-7]`). The runtime composes canonical IDs by
 * prefixing bodies with the domain's canonical prefixes (`wfxitm_`,
 * `wfxpses_`, `wfxact_` — the last is this package's action prefix).
 */
export interface RuntimeIdGen {
  next(): string;
}

export type { RuntimeContext } from "./server-port";
