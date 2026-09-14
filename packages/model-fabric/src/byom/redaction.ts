/**
 * WFX-032 — BYOM privacy redaction (Lane A — intelligence), PURE.
 *
 * `redactForPrivacy(ctx, privacyClass)` produces the `ByomInput` a BYOM model
 * of the given class may receive, plus a typed `RedactionReport` listing EVERY
 * transformation applied — auditable, never silent:
 *
 * - `local-only`    ⇒ full context: a faithful deep copy, ZERO transformations.
 * - `trusted-cloud` ⇒ userId pseudonymized everywhere it occurs (the context
 *                     user, every intent's, the policy's, every event's) via a
 *                     deterministic salted SHA-256 — no reversible identifier
 *                     leaves the boundary; session ids kept (spec).
 * - `any-cloud`     ⇒ pseudonymized (as trusted-cloud) PLUS event payloads
 *                     minimized: finite numbers, booleans, and ISO 8601
 *                     timestamp strings are kept ("keep types/timestamps");
 *                     every other value — free-text strings above all, nested
 *                     structures that could hide text — is DROPPED and
 *                     recorded; a payload minimized to empty is omitted
 *                     entirely.
 *
 * Laws:
 * - PURE: no I/O, no clocks, no randomness, no hidden globals. Identical
 *   (ctx, privacyClass, salt) ⇒ byte-identical result AND report (the salt is
 *   the ONLY knob, injectable per deployment — determinism is required so the
 *   same user maps to the same pseudonym across calls, preserving
 *   joinability within a context without disclosing the identifier).
 * - The original ctx is NEVER mutated; the model never receives the caller's
 *   objects (deep copies only).
 * - The report NEVER echoes a redacted value — only field paths, actions, and
 *   reasons. An audit report that leaked the redacted data would defeat
 *   itself.
 * - Precondition: `ctx` is a well-formed `RecommendationContext` (the adapter
 *   validates via the merged OS validator before redacting; the function
 *   trusts its typed input and never re-validates).
 *
 * The pseudonymization hash is a hand-rolled SHA-256 (FIPS 180-4): pure
 * TypeScript, zero dependencies, browser-safe — the same zero-builtin law the
 * rest of the fabric's src follows (the merged WFX-030/033 modules import no
 * node: builtins). Correctness is pinned in tests against the official
 * FIPS test vectors AND cross-checked against node:crypto.
 */

import { isIso8601, type EntertainmentEvent } from "@wfx/domain";
import type { RecommendationContext } from "@wfx/domain";

import type { ByomInput, ByomPrivacyClass } from "./byom";
import { isByomPrivacyClass } from "./byom";

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) — pure, deterministic, dependency-free
// ---------------------------------------------------------------------------

/** The 64 round constants of SHA-256 (FIPS 180-4, section 4.2.2). */
const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Rotate a 32-bit value right by `n` bits (result normalized to unsigned). */
function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** UTF-8 bytes of a string (TextEncoder: standard, deterministic). */
function utf8Bytes(input: string): number[] {
  return Array.from(new TextEncoder().encode(input));
}

/**
 * The SHA-256 digest of `input`, as 64 lowercase hex chars. Pure and
 * deterministic; pinned against the official FIPS test vectors in tests.
 */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;

  // Padding: 0x80, zeros to 56 mod 64, then the 64-bit big-endian bit length.
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLength / 2 ** 32);
  const lo = bitLength >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      const b0 = bytes[j]!;
      const b1 = bytes[j + 1]!;
      const b2 = bytes[j + 2]!;
      const b3 = bytes[j + 3]!;
      w[i] = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x15 = w[i - 15]!;
      const x2 = w[i - 2]!;
      const s0 = (rotr32(x15, 7) ^ rotr32(x15, 18) ^ (x15 >>> 3)) >>> 0;
      const s1 = (rotr32(x2, 17) ^ rotr32(x2, 19) ^ (x2 >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let i = 0; i < 64; i += 1) {
      const bigS1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + bigS1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const bigS0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (bigS0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------------------
// Pseudonymization
// ---------------------------------------------------------------------------

/** Prefix of BYOM pseudonyms: visually distinct from real identifiers. */
export const BYOM_PSEUDONYM_PREFIX = "wfxanon_";

/** Pseudonym body length: 32 hex chars = 128 bits of SHA-256 output. */
export const BYOM_PSEUDONYM_BODY_LENGTH = 32;

/**
 * The default pseudonymization salt. A documented deployment CONSTANT (not
 * entropy — determinism is required so the same user maps to the same
 * pseudonym across calls). Deployments with stronger unlinkability needs
 * inject their own salt through the adapter options.
 */
export const BYOM_DEFAULT_PSEUDONYM_SALT = "wfx-byom-redaction-v1";

/**
 * Pseudonymize a userId: `wfxanon_` + the first 32 hex chars of
 * SHA-256(salt + "\\u0000" + userId).
 *
 * Deterministic (same user + salt ⇒ same pseudonym — joinability within a
 * context is preserved), salted (the raw id is not directly recoverable from
 * the digest), and non-reversible in the pseudonymization sense: the original
 * identifier never leaves the boundary. Honestly NOT anonymization: an actor
 * who knows the salt and a candidate id list can test membership — the packet
 * asks for pseudonymization, and this is pseudonymization.
 */
export function pseudonymizeUserId(userId: string, salt: string): string {
  const digest = sha256Hex(`${salt}\u0000${userId}`);
  return `${BYOM_PSEUDONYM_PREFIX}${digest.slice(0, BYOM_PSEUDONYM_BODY_LENGTH)}`;
}

// ---------------------------------------------------------------------------
// Redaction report (auditable, never silent, never leaking values)
// ---------------------------------------------------------------------------

/** The closed set of transformations redaction can apply. */
export type RedactionAction = "pseudonymized" | "dropped";

/** One applied transformation. NEVER carries the original value. */
export interface RedactionTransformation {
  /** Dotted path of the transformed field (e.g. `recentEvents[2].payload.query`). */
  field: string;
  /** What was done to it. */
  action: RedactionAction;
  /** Why (stable, human-readable; the privacy law that mandated it). */
  reason: string;
}

/** The auditable report of one redaction: every transformation, in order. */
export interface RedactionReport {
  /** The privacy class that drove the redaction. */
  privacyClass: ByomPrivacyClass;
  /** Every transformation applied, in deterministic (field, document) order. */
  transformations: readonly RedactionTransformation[];
}

/** The output of {@link redactForPrivacy}: the redacted input + its report. */
export interface RedactionResult {
  /** The serialized, redacted context (a deep copy — the model's to hold). */
  input: ByomInput;
  /** Every transformation that was applied to produce it. */
  report: RedactionReport;
}

/** Options for {@link redactForPrivacy}. */
export interface RedactionOptions {
  /** Pseudonymization salt (default: {@link BYOM_DEFAULT_PSEUDONYM_SALT}). */
  salt?: string;
}

/** Stable reason strings (golden-report tests pin these verbatim). */
const REASON_PSEUDONYMIZED =
  "userId replaced with a deterministic salted-hash pseudonym (no reversible identifier)";
const REASON_PAYLOAD_ENTRY =
  "any-cloud payload minimization: entry dropped (free-text/unstructured value)";
const REASON_PAYLOAD_OMITTED =
  "any-cloud payload minimization: payload empty after minimization — field omitted";

// ---------------------------------------------------------------------------
// Deep copy (the serialization)
// ---------------------------------------------------------------------------

/**
 * Copy a JSON-shaped value deeply. Primitives (and non-object non-array
 * values) pass by reference — immutable or verbatim. `undefined` record
 * entries are omitted (they carry no data). Cycles throw a clear Error (a
 * corrupted input, fail fast — never a silent truncation).
 */
function copyJsonShape(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) {
    throw new Error(
      "redactForPrivacy: circular structure in the context — the frozen contracts are JSON shapes; a cycle is corrupted input",
    );
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const entry of value) out.push(copyJsonShape(entry, seen));
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    out[key] = copyJsonShape(entry, seen);
  }
  return out;
}

/** Deep-copy a JSON-shaped value (fresh `seen` map per top-level copy). */
function deepCopyValue<T>(value: T): T {
  return copyJsonShape(value, new WeakMap()) as T;
}

// ---------------------------------------------------------------------------
// any-cloud payload minimization
// ---------------------------------------------------------------------------

/** Runtime kind classifier for drop reasons (null and arrays are distinct). */
function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * May this payload entry survive `any-cloud` minimization? Kept: finite
 * numbers, booleans, ISO 8601 timestamp strings ("keep types/timestamps" — a
 * parseable timestamp is structured data, not free text). Dropped: everything
 * else — free-text strings above all, plus nested structures that could hide
 * text. Fail-safe: when in doubt, drop and record.
 */
function isMinimizablePayloadValue(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isIso8601(value);
  return false;
}

/**
 * Minimize one event payload for `any-cloud`. Returns the kept entries, or
 * `undefined` when nothing survived (the field is then omitted entirely).
 * Every drop — and the whole-field omission — is recorded.
 */
function minimizePayload(
  payload: Record<string, unknown>,
  path: string,
  transformations: RedactionTransformation[],
): Record<string, unknown> | undefined {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isMinimizablePayloadValue(value)) {
      kept[key] = value;
    } else {
      transformations.push({
        field: `${path}.${key}`,
        action: "dropped",
        reason: `${REASON_PAYLOAD_ENTRY} (value kind: ${valueKind(value)})`,
      });
    }
  }
  if (Object.keys(kept).length === 0) {
    transformations.push({ field: path, action: "dropped", reason: REASON_PAYLOAD_OMITTED });
    return undefined;
  }
  return kept;
}

// ---------------------------------------------------------------------------
// redactForPrivacy
// ---------------------------------------------------------------------------

/**
 * Redact a (well-formed) `RecommendationContext` for a BYOM model of the
 * given privacy class. Pure: identical (ctx, class, salt) ⇒ identical input
 * AND identical report. The original ctx is never mutated; the returned input
 * is a deep copy the model owns.
 *
 * Transformation order (deterministic, golden-pinned): `userId`, then
 * `intents[i].userId` in order, then `policy.userId`, then per event in order
 * `recentEvents[i].userId` followed by that event's payload drops.
 *
 * @throws Error on a circular structure inside the ctx (corrupted input —
 *         the frozen contracts are JSON shapes).
 */
export function redactForPrivacy(
  ctx: RecommendationContext,
  privacyClass: ByomPrivacyClass,
  options: RedactionOptions = {},
): RedactionResult {
  if (!isByomPrivacyClass(privacyClass)) {
    // The typed signature makes this unreachable for typed callers; direct
    // untrusted callers get a loud failure, never a silent wrong redaction.
    throw new Error(
      `redactForPrivacy: privacyClass must be one of local-only | trusted-cloud | any-cloud, got ${String(privacyClass)}`,
    );
  }
  const salt = options.salt ?? BYOM_DEFAULT_PSEUDONYM_SALT;

  // --- local-only: full context, zero transformations -----------------------
  if (privacyClass === "local-only") {
    return {
      input: deepCopyValue<ByomInput>(ctx),
      report: { privacyClass, transformations: [] },
    };
  }

  // --- trusted-cloud / any-cloud: pseudonymize every userId occurrence ------
  const transformations: RedactionTransformation[] = [];
  const pseudonymize = (original: string, field: string): string => {
    transformations.push({ field, action: "pseudonymized", reason: REASON_PSEUDONYMIZED });
    return pseudonymizeUserId(original, salt);
  };
  const minimizePayloads = privacyClass === "any-cloud";

  // ctx.userId leads the transformation order (golden-pinned): pseudonymize
  // it BEFORE the per-document fields below push theirs.
  const contextUserId = pseudonymize(ctx.userId, "userId");

  const intents = ctx.intents.map((intent, index) => ({
    ...deepCopyValue(intent),
    userId: pseudonymize(intent.userId, `intents[${index}].userId`),
  }));

  const policy = {
    ...deepCopyValue(ctx.policy),
    userId: pseudonymize(ctx.policy.userId, "policy.userId"),
  };

  const recentEvents: EntertainmentEvent[] = ctx.recentEvents.map((event, index) => {
    const copied = deepCopyValue(event);
    const redacted: EntertainmentEvent = {
      ...copied,
      userId: pseudonymize(event.userId, `recentEvents[${index}].userId`),
    };
    if (minimizePayloads && event.payload !== undefined) {
      const minimized = minimizePayload(
        event.payload,
        `recentEvents[${index}].payload`,
        transformations,
      );
      if (minimized === undefined) {
        delete redacted.payload; // nothing survived — the field is omitted
      } else {
        redacted.payload = minimized;
      }
    }
    return redacted;
  });

  const input: ByomInput = {
    userId: contextUserId,
    sessionId: ctx.sessionId, // kept under every class (the spec keeps session ids)
    surface: ctx.surface,
    intents,
    policy,
    recentEvents,
    candidatePool: ctx.candidatePool.map((candidate) => deepCopyValue(candidate)),
  };

  return {
    input,
    report: { privacyClass, transformations: Object.freeze(transformations) },
  };
}
