/**
 * Canonical WebFlix ID scheme (WFX-002).
 *
 * IDs are opaque strings at the frozen-contract level; this module defines the
 * canonical production format used across the platform:
 *
 *   <lane-scoped lowercase prefix> + <26-char ULID body>
 *
 * The ULID body encodes a 48-bit millisecond timestamp (10 Crockford Base32
 * chars) followed by 80 bits of randomness (16 Crockford Base32 chars).
 * Timestamp-first encoding makes IDs lexicographically sortable, and an
 * in-process monotonicity rule keeps IDs minted within the same millisecond
 * strictly ordered. No external dependency is used.
 *
 * Verifiability: the `is*Id` guards accept `unknown` and verify prefix, body
 * length, the Crockford alphabet, and the 48-bit timestamp bound, so they can
 * be applied directly to untrusted input. `ulidTimestamp` decodes the embedded
 * timestamp for auditing/sorting.
 */

/** Canonical entertainment-item ID: `wfxitm_` + ULID body. */
export type EntertainmentItemId = string & { readonly __wfxIdKind: "EntertainmentItemId" };
/** Canonical source-realization ID: `wfxsrc_` + ULID body. */
export type SourceRealizationId = string & { readonly __wfxIdKind: "SourceRealizationId" };
/** Canonical event ID: `wfxevt_` + ULID body. */
export type EventId = string & { readonly __wfxIdKind: "EventId" };
/** Canonical playback-session ID: `wfxpses_` + ULID body. */
export type PlaybackSessionId = string & { readonly __wfxIdKind: "PlaybackSessionId" };
/** Canonical intent ID: `wfxint_` + ULID body. */
export type IntentId = string & { readonly __wfxIdKind: "IntentId" };

export const ENTERTAINMENT_ITEM_ID_PREFIX = "wfxitm_";
export const SOURCE_REALIZATION_ID_PREFIX = "wfxsrc_";
export const EVENT_ID_PREFIX = "wfxevt_";
export const PLAYBACK_SESSION_ID_PREFIX = "wfxpses_";
export const INTENT_ID_PREFIX = "wfxint_";

const KNOWN_ID_PREFIXES: readonly string[] = [
  ENTERTAINMENT_ITEM_ID_PREFIX,
  SOURCE_REALIZATION_ID_PREFIX,
  EVENT_ID_PREFIX,
  PLAYBACK_SESSION_ID_PREFIX,
  INTENT_ID_PREFIX,
];

/** 32-symbol Crockford Base32 alphabet (excludes I, L, O, U to avoid ambiguity). */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID time section: 10 chars * 5 bits = 50 bits (top 2 bits unused by the 48-bit timestamp). */
const TIME_LENGTH = 10;
/** ULID random section: 16 chars * 5 bits = 80 bits. */
const RANDOM_LENGTH = 16;
/** ULID timestamps are unsigned 48-bit millisecond counts since the Unix epoch. */
const MAX_TIME_MS = 2 ** 48;

/** 26-char ULID body; the first char is restricted to 0-7 by the 48-bit timestamp bound. */
const ULID_BODY_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// ---------------------------------------------------------------------------
// ULID generator (timestamp + randomness, sortable, dependency-free)
// ---------------------------------------------------------------------------

/** In-process monotonicity state: last minted (time, random) pair. */
let lastTimeMs = -1;
let lastRandom = "";

/**
 * Generate a ULID-style identifier: 10 timestamp chars + 16 random chars
 * (Crockford Base32, uppercase, 26 chars total).
 *
 * - `now` defaults to the current time; it must be a finite number of
 *   milliseconds since the epoch in `[0, 2^48)`, otherwise a `RangeError` is
 *   thrown (explicit failure, no silent clamping).
 * - IDs minted with the same `now` in the same process are strictly
 *   increasing (the random section is incremented within the millisecond).
 * - Passing an out-of-order `now` (older than the last minted time) yields a
 *   fresh random section; ordering relative to previously minted IDs is the
 *   caller's responsibility in that case.
 */
export function generateUlid(now: number = Date.now()): string {
  const time = Math.floor(now);
  if (!Number.isFinite(time) || time < 0 || time >= MAX_TIME_MS) {
    throw new RangeError(
      `generateUlid: time must be a finite number of milliseconds in [0, ${MAX_TIME_MS}), got ${now}`,
    );
  }

  let random: string;
  if (time === lastTimeMs) {
    // Same millisecond: increment the previous random section for
    // intra-millisecond monotonicity. Overflow (all-'Z' random section) is
    // astronomically unlikely; fall back to fresh entropy in that case.
    const incremented = incrementBase32(lastRandom);
    random = incremented ?? randomBase32();
  } else {
    random = randomBase32();
  }
  lastTimeMs = time;
  lastRandom = random;

  return encodeTime(time) + random;
}

/** Encode a validated timestamp as 10 Crockford Base32 chars (zero-padded, big-endian). */
function encodeTime(time: number): string {
  let remaining = time;
  let encoded = "";
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    encoded = CROCKFORD_ALPHABET.charAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

/** Produce `RANDOM_LENGTH` Crockford Base32 chars from 80 bits of platform entropy. */
function randomBase32(): string {
  const bytes = new Uint8Array((RANDOM_LENGTH * 5) / 8); // 16 chars * 5 bits = 80 bits = 10 bytes
  globalThis.crypto.getRandomValues(bytes);

  let encoded = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += CROCKFORD_ALPHABET.charAt((accumulator >>> bits) & 31);
    }
  }
  return encoded.slice(0, RANDOM_LENGTH); // 80 bits divide evenly: no leftover bits
}

/** Increment a Crockford Base32 string by one; returns null on carry overflow. */
function incrementBase32(value: string): string | null {
  const chars = value.split("");
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const charIndex = CROCKFORD_ALPHABET.indexOf(chars[index] ?? "");
    if (charIndex === -1) return null; // defensive: not a valid Base32 string
    if (charIndex === CROCKFORD_ALPHABET.length - 1) {
      chars[index] = CROCKFORD_ALPHABET.charAt(0); // carry to the next position
      continue;
    }
    chars[index] = CROCKFORD_ALPHABET.charAt(charIndex + 1);
    return chars.join("");
  }
  return null; // every position overflowed
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Prefix a freshly generated ULID and brand it as the given canonical ID kind. */
function prefixUlid(prefix: string): string {
  return `${prefix}${generateUlid()}`;
}

export function newEntertainmentItemId(): EntertainmentItemId {
  return prefixUlid(ENTERTAINMENT_ITEM_ID_PREFIX) as EntertainmentItemId;
}

export function newSourceRealizationId(): SourceRealizationId {
  return prefixUlid(SOURCE_REALIZATION_ID_PREFIX) as SourceRealizationId;
}

export function newEventId(): EventId {
  return prefixUlid(EVENT_ID_PREFIX) as EventId;
}

export function newPlaybackSessionId(): PlaybackSessionId {
  return prefixUlid(PLAYBACK_SESSION_ID_PREFIX) as PlaybackSessionId;
}

export function newIntentId(): IntentId {
  return prefixUlid(INTENT_ID_PREFIX) as IntentId;
}

// ---------------------------------------------------------------------------
// Guards (verifiable against untrusted input)
// ---------------------------------------------------------------------------

/** Structural check: `<prefix>` followed by a valid 26-char ULID body. */
function isWfxId(value: unknown, prefix: string): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith(prefix)) return false;
  return ULID_BODY_RE.test(value.slice(prefix.length));
}

export function isEntertainmentItemId(value: unknown): value is EntertainmentItemId {
  return isWfxId(value, ENTERTAINMENT_ITEM_ID_PREFIX);
}

export function isSourceRealizationId(value: unknown): value is SourceRealizationId {
  return isWfxId(value, SOURCE_REALIZATION_ID_PREFIX);
}

export function isEventId(value: unknown): value is EventId {
  return isWfxId(value, EVENT_ID_PREFIX);
}

export function isPlaybackSessionId(value: unknown): value is PlaybackSessionId {
  return isWfxId(value, PLAYBACK_SESSION_ID_PREFIX);
}

export function isIntentId(value: unknown): value is IntentId {
  return isWfxId(value, INTENT_ID_PREFIX);
}

// ---------------------------------------------------------------------------
// Timestamp decoding
// ---------------------------------------------------------------------------

/**
 * Decode the millisecond timestamp embedded in a canonical ID (any known
 * prefix) or a bare ULID. Returns null when the input is not a well-formed
 * 26-char ULID body.
 */
export function ulidTimestamp(id: string): number | null {
  let body = id;
  for (const prefix of KNOWN_ID_PREFIXES) {
    if (id.startsWith(prefix)) {
      body = id.slice(prefix.length);
      break;
    }
  }
  if (!ULID_BODY_RE.test(body)) return null;

  let time = 0;
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    time = time * 32 + CROCKFORD_ALPHABET.indexOf(body.charAt(index));
  }
  return time;
}