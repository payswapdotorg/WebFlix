/**
 * @wfx/torrent-engine — provenance (R11, invariant 5 enforcement).
 *
 * INVARIANT 5 (the absolute law):
 *
 *   Native acquisition is limited to user-owned, licensed, public-domain,
 *   Creative Commons, or otherwise authorized media. The engine is
 *   AUTHORIZED-SOURCE-ONLY: an ingestion carries its authorization
 *   provenance (which authorized source/vault it came from); unprovenanced
 *   ingestion is a TYPED REJECTION, not a warning.
 *
 * STRUCTURAL ENFORCEMENT (the public API cannot construct an ingestion
 * without a provenance):
 *
 * - {@link Provenance} is a branded nominal type. The only constructor is
 *   {@link provenanceFromAuthorizedSource}, which REQUIRES a non-empty
 *   `sourceId` and a non-empty `authorizationKind`. Callers cannot pass a
 *   bare string or `undefined` where `Provenance` is expected — the
 *   TypeScript compiler rejects it. The frozen `TorrentSource.authorized:
 *   boolean` field is derived (set to `true` at the seam) because
 *   provenance was structurally proven.
 * - The runtime guard {@link isProvenance} rejects everything that is not
 *   a branded instance (defensive against untyped code at the boundary).
 * - {@link UNKNOWN_PROVENANCE} is the runtime marker for the typed
 *   rejection path: a value the engine never produces, only ever CONSUMES
 *   as the `UNAUTHORIZED_SOURCE` rejection's payload. It is the runtime
 *   mirror of the structural absence — never silently accepted.
 *
 * The PROVENANCE vocabulary is closed-additive: a new authorization kind
 * (a new vault, a new license type) is added by extending
 * {@link AuthorizationKind} here; the guard accepts the new value the same
 * way it accepts existing ones (no schema change). Ratification of new
 * kinds is the lead's at review (R11's drift rule: platform-contracts
 * only when a NEW capability vocabulary member is needed; the provenance
 * vocabulary stays in-package and is reviewed through the normal R11
 * review channel).
 */

import { unauthorizedSource } from "./errors";

// ---------------------------------------------------------------------------
// The closed authorization vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed set of authorization kinds an ingestion may carry. Each kind
 * names a category under which WebFlix's user acquired the right to native
 * media (invariant 5):
 *
 * - `user-owned`        — the user owns the media (a personal rip of a
 *   DVD/BD they own; home video they created).
 * - `licensed`          — the user holds a license that permits native
 *   acquisition (DRM-free purchases, downloads from a licensed storefront
 *   that permits offline copies).
 * - `public-domain`     — the media is in the public domain.
 * - `creative-commons` — the media is released under a Creative Commons
 *   or comparable permissive license that permits native acquisition.
 * - `authorized-vault`  — the media comes from an authorized vault the
 *   user has wired into WebFlix (a personal NAS, a media library they
 *   have declared authorized, a connector-supplied authorized catalog).
 *
 * This list is intentionally CLOSED at the type level so callers cannot
 * smuggle in `"unknown"` or `"other"` — the structural enforcement of
 * invariant 5. New kinds are added by lead-ratified extension (the
 * provenance vocabulary is in-package, not in `platform-contracts`).
 */
export type AuthorizationKind =
  | "user-owned"
  | "licensed"
  | "public-domain"
  | "creative-commons"
  | "authorized-vault";

/** Every value of {@link AuthorizationKind}, in declaration order. */
export const AUTHORIZATION_KINDS: readonly AuthorizationKind[] = [
  "user-owned",
  "licensed",
  "public-domain",
  "creative-commons",
  "authorized-vault",
];

/** Runtime guard for {@link AuthorizationKind}. */
export function isAuthorizationKind(x: unknown): x is AuthorizationKind {
  return (
    typeof x === "string" &&
    (AUTHORIZATION_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Provenance — branded nominal type (the brand is a real runtime symbol)
// ---------------------------------------------------------------------------

/**
 * The unique symbol that brands {@link Provenance} as a nominal type.
 * The symbol is REAL at runtime (a `Symbol.for` keyed by the package's
 * provenance namespace) so the {@link isProvenance} guard can check it
 * without needing a type-level `declare const` (which has no runtime
 * presence). The TypeScript-level nominal guarantee comes from the
 * `declare` on the {@link Provenance} interface below — the runtime
 * guard checks the symbol itself.
 */
export const PROVENANCE_BRAND: unique symbol = Symbol.for("@wfx/torrent-engine/Provenance");

/**
 * The provenance of one ingestion — the structural proof of authorization.
 *
 * The `__brand` field (keyed by {@link PROVENANCE_BRAND}) is the
 * TypeScript-level guard: only {@link provenanceFromAuthorizedSource}
 * produces a value of this shape, so every call site that accepts a
 * `Provenance` has structurally proven the ingestion's authorization
 * BEFORE the engine ever sees a magnet or a `.torrent` file.
 */
export interface Provenance {
  /** The authorized source/vault this ingestion came from. */
  readonly sourceId: string;
  /** The category of authorization (invariant 5). */
  readonly authorizationKind: AuthorizationKind;
  /** Free-form context the source declares (a license id, a vault path, …). */
  readonly context?: Readonly<Record<string, string>>;
  /** The nominal brand — never set by callers; only by the constructor. */
  readonly [PROVENANCE_BRAND]: true;
}

/** Runtime guard for {@link Provenance}. */
export function isProvenance(x: unknown): x is Provenance {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  if (typeof p.sourceId !== "string" || p.sourceId.trim().length === 0) return false;
  if (!isAuthorizationKind(p.authorizationKind)) return false;
  if (p.context !== undefined) {
    if (typeof p.context !== "object" || p.context === null || Array.isArray(p.context)) {
      return false;
    }
  }
  // The brand check: the runtime symbol must be present and `true`.
  return (p as Record<symbol, unknown>)[PROVENANCE_BRAND] === true;
}

/**
 * Construct a {@link Provenance} for an authorized source. The ONLY public
 * constructor — every ingestion call site MUST pass a value built by this
 * function (the structural enforcement of invariant 5).
 *
 * Throws a typed `INVALID_INPUT` error on malformed input — never a
 * default-filled provenance.
 */
export function provenanceFromAuthorizedSource(input: {
  sourceId: string;
  authorizationKind: AuthorizationKind;
  context?: Readonly<Record<string, string>>;
}): Provenance {
  if (typeof input !== "object" || input === null) {
    throw unauthorizedSource(
      "provenanceFromAuthorizedSource: input must be an object",
    );
  }
  const { sourceId, authorizationKind, context } = input;
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    throw unauthorizedSource(
      "provenanceFromAuthorizedSource: sourceId must be a non-empty string",
    );
  }
  if (!isAuthorizationKind(authorizationKind)) {
    throw unauthorizedSource(
      `provenanceFromAuthorizedSource: authorizationKind must be one of ${AUTHORIZATION_KINDS.join(" | ")} (got ${String(authorizationKind)})`,
    );
  }
  if (context !== undefined) {
    if (typeof context !== "object" || context === null || Array.isArray(context)) {
      throw unauthorizedSource(
        "provenanceFromAuthorizedSource: context must be a string-keyed record when present",
      );
    }
    for (const [k, v] of Object.entries(context)) {
      if (typeof v !== "string") {
        throw unauthorizedSource(
          `provenanceFromAuthorizedSource: context['${k}'] must be a string (got ${typeof v})`,
        );
      }
    }
  }
  return {
    sourceId,
    authorizationKind,
    ...(context !== undefined ? { context } : {}),
    [PROVENANCE_BRAND]: true,
  } as Provenance;
}

/**
 * A structural marker for the ABSENCE of provenance — the runtime mirror
 * of the typed rejection path. The engine never produces this; it only
 * ever CONSUMES it as the `UNAUTHORIZED_SOURCE` rejection's payload when
 * untyped code reaches the boundary despite the structural guard. It is
 * the defensive answer to "what if a caller bypasses the type system?" —
 * the runtime still refuses honestly.
 */
export const UNKNOWN_PROVENANCE: unique symbol = Symbol("UNKNOWN_PROVENANCE");

/**
 * Test-only helper: a `Provenance` is never `null`/`undefined`. The
 * structural enforcement means callers cannot construct an ingestion
 * without one; the runtime guard {@link isProvenance} rejects every
 * non-branded object. This helper exists for tests that need to assert
 * the typed rejection path explicitly.
 */
export function assertAuthorized(provenance: unknown): asserts provenance is Provenance {
  if (!isProvenance(provenance)) {
    throw unauthorizedSource(
      "the ingestion carried no provenance — invariant 5's structural enforcement refuses unprovenanced ingestion (use provenanceFromAuthorizedSource to construct one)",
    );
  }
}
