/**
 * @wfx/torrent-engine — authorization provenance (invariant 5, THE LAW).
 *
 * THE FREEZE (docs/architecture/webflix-remediation-architecture.md,
 * invariant 5): "Native acquisition is limited to user-owned, licensed,
 * public-domain, Creative Commons, or otherwise authorized media."
 *
 * STRUCTURAL ENFORCEMENT — the public ingestion API cannot even be CALLED
 * without an `AuthorizedProvenance`:
 *
 * 1. TYPE-LEVEL: `AuthorizedProvenance` is a branded nominal type. Its
 *    brand (`AUTHORIZED_PROVENANCE`) is a `unique symbol` declared in this
 *    module — the ONLY way to produce a value of this type in the entire
 *    package is {@link authorizeProvenance}, which consults the
 *    authorized-source registry. A caller cannot assemble one from a plain
 *    object literal; TypeScript rejects it structurally.
 * 2. RUNTIME MINT GATE: `authorizeProvenance(registry, sourceId)` mints the
 *    brand ONLY for sources present in the registry. A missing/unknown
 *    source is a TYPED `PROVENANCE_REJECTED` rejection — never a warning,
 *    never a fallback.
 * 3. INGEST RE-VALIDATION: `ingestMagnet`/`ingestTorrentFile` re-validate
 *    the provenance against the registry at ingest time
 *    ({@link revalidateProvenance}) so a forged brand smuggled through
 *    `as any` from untyped code is still rejected. Defense in depth.
 *
 * The registry is INJECTED: the desktop composition root registers the
 * authorized sources/vaults (derived from the product's source-management
 * state — R03); tests register fixture sources. The engine never invents
 * authorization.
 */

import { TorrentEngineError, torrentError, type TorrentResult } from "./errors";

// ---------------------------------------------------------------------------
// The authorized bases (invariant 5's closed vocabulary)
// ---------------------------------------------------------------------------

/**
 * The closed set of authorization bases named by invariant 5. "Other
 * authorized" covers contracts the freeze's enumeration did not name, but
 * the BURDEN stays on the registering source: the label must say why it is
 * authorized.
 */
export const AUTHORIZED_PROVENANCE_BASES = [
  "user-owned",
  "licensed",
  "public-domain",
  "creative-commons",
  "other-authorized",
] as const;

export type AuthorizedProvenanceBasis =
  (typeof AUTHORIZED_PROVENANCE_BASES)[number];

/** Runtime guard for the closed basis union. */
export function isAuthorizedProvenanceBasis(
  x: unknown,
): x is AuthorizedProvenanceBasis {
  return (
    typeof x === "string" &&
    (AUTHORIZED_PROVENANCE_BASES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The authorized-source registry
// ---------------------------------------------------------------------------

/** One authorized source/vault an ingestion may carry provenance from. */
export interface AuthorizedSource {
  /** Stable identifier (e.g. "vault:family-media", "source:connector-42"). */
  readonly sourceId: string;
  /** Why media from this source is authorized (invariant 5 basis). */
  readonly basis: AuthorizedProvenanceBasis;
  /** Human-readable label naming the source (required for "other-authorized"). */
  readonly label?: string;
  /** Wall-clock epoch ms when the authorization was recorded, when known. */
  readonly authorizedAt?: number;
}

/** The registry of authorized sources (injected; the engine never invents). */
export interface AuthorizedSourceRegistry {
  /** Whether `sourceId` names a registered authorized source. */
  has(sourceId: string): boolean;
  /** The registered source, or `undefined` when unknown. */
  get(sourceId: string): AuthorizedSource | undefined;
  /** Every registered source (inspection; ordered by registration). */
  list(): readonly AuthorizedSource[];
}

/** Options for {@link createAuthorizedSourceRegistry}. */
export interface CreateAuthorizedSourceRegistryOptions {
  /** Sources to register eagerly, when any. */
  readonly sources?: readonly AuthorizedSource[];
}

/**
 * Create an in-memory authorized-source registry. Registers the (validated)
 * `options.sources` eagerly; returns a registry with a `register` method so
 * the composition root can add sources over time (registration is
 * append-only — a source can be re-registered idempotently but never
 * silently RE-BASISed).
 */
export function createAuthorizedSourceRegistry(
  options: CreateAuthorizedSourceRegistryOptions = {},
): AuthorizedSourceRegistry & {
  register(source: AuthorizedSource): TorrentResult<AuthorizedSource>;
} {
  if (typeof options !== "object" || options === null) {
    throw new TorrentEngineError("INVALID_INPUT", {
      detail: "createAuthorizedSourceRegistry: options must be an object",
    });
  }
  const byId = new Map<string, AuthorizedSource>();
  const order: string[] = [];

  const validate = (source: AuthorizedSource): TorrentResult<AuthorizedSource> => {
    if (typeof source !== "object" || source === null) {
      return torrentError("INVALID_INPUT", {
        detail: "register: source must be an AuthorizedSource object",
      });
    }
    const { sourceId, basis, label, authorizedAt } = source;
    if (
      typeof sourceId !== "string" ||
      sourceId.trim().length === 0 ||
      sourceId.length > 256
    ) {
      return torrentError("INVALID_INPUT", {
        detail:
          "register: sourceId must be a non-empty string of at most 256 characters",
      });
    }
    if (!isAuthorizedProvenanceBasis(basis)) {
      return torrentError("INVALID_INPUT", {
        detail: `register: basis must be one of ${AUTHORIZED_PROVENANCE_BASES.join(" | ")} (got ${String(basis)})`,
      });
    }
    if (label !== undefined && typeof label !== "string") {
      return torrentError("INVALID_INPUT", {
        detail: "register: label must be a string when present",
      });
    }
    if (authorizedAt !== undefined && typeof authorizedAt !== "number") {
      return torrentError("INVALID_INPUT", {
        detail: "register: authorizedAt must be a number when present",
      });
    }
    if (basis === "other-authorized" && (label === undefined || label.trim().length === 0)) {
      return torrentError("INVALID_INPUT", {
        detail:
          "register: basis 'other-authorized' REQUIRES a label naming why the source is authorized (invariant 5 burden)",
      });
    }
    return { ok: true, value: source };
  };

  for (const source of options.sources ?? []) {
    const checked = validate(source);
    if (!checked.ok) throw checked.error;
    registerUnchecked(checked.value);
  }

  function registerUnchecked(source: AuthorizedSource): void {
    const existing = byId.get(source.sourceId);
    if (existing === undefined) {
      order.push(source.sourceId);
      byId.set(source.sourceId, source);
      return;
    }
    if (existing.basis !== source.basis) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail:
          `register: source '${source.sourceId}' is already registered with basis '${existing.basis}'; re-basing an authorized source is not a silent operation (remove and re-register explicitly)`,
      });
    }
  }

  return {
    has: (sourceId) => byId.has(sourceId),
    get: (sourceId) => byId.get(sourceId),
    list: () => order.map((id) => byId.get(id)!).slice(),
    register(source: AuthorizedSource): TorrentResult<AuthorizedSource> {
      const checked = validate(source);
      if (!checked.ok) return checked;
      registerUnchecked(checked.value);
      return { ok: true, value: checked.value };
    },
  };
}

// ---------------------------------------------------------------------------
// AuthorizedProvenance — the branded nominal type
// ---------------------------------------------------------------------------

/**
 * The brand symbol: a module-private runtime token. `const ... = Symbol()`
 * gives it the `unique symbol` TYPE, so the computed key below is a
 * compile-time nominal brand; because the VALUE never leaves this module,
 * no code outside can construct the brand at runtime — the one public mint
 * is {@link authorizeProvenance} (which consults the registry).
 */
const AUTHORIZED_PROVENANCE = Symbol("wfx-authorized-provenance");

/**
 * The authorization provenance an ingestion MUST carry (invariant 5).
 *
 * Nominal via the `AUTHORIZED_PROVENANCE` brand: a plain object with the
 * same fields is NOT assignable to this type — the ingestion API
 * (`ingestMagnet(uri, provenance)`, `ingestTorrentFile(bytes, provenance)`)
 * therefore cannot be called with unprovenanced data, by construction.
 */
export interface AuthorizedProvenance {
  /** Which authorized source/vault the ingestion comes from. */
  readonly sourceId: string;
  /** Why media from that source is authorized (invariant 5 basis). */
  readonly basis: AuthorizedProvenanceBasis;
  /** The source's human label, when it registered one. */
  readonly label?: string;
  readonly [AUTHORIZED_PROVENANCE]: "authorized";
}

// ---------------------------------------------------------------------------
// The mint (the ONLY way to construct an AuthorizedProvenance)
// ---------------------------------------------------------------------------

/**
 * Mint an {@link AuthorizedProvenance} for a REGISTERED authorized source.
 *
 * This is the single construction path. An unknown/missing sourceId is a
 * typed `PROVENANCE_REJECTED` rejection carrying the honest detail — the
 * invariant-5 law: unprovenanced ingestion is a rejection, never a warning.
 */
export function authorizeProvenance(
  registry: AuthorizedSourceRegistry,
  sourceId: string,
): TorrentResult<AuthorizedProvenance> {
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    return torrentError("PROVENANCE_REJECTED", {
      detail:
        "authorizeProvenance: a sourceId must name the authorized source/vault (invariant 5: authorized media only — an empty provenance is not a provenance)",
    });
  }
  const source = registry.get(sourceId);
  if (source === undefined) {
    return torrentError("PROVENANCE_REJECTED", {
      detail:
        `authorizeProvenance: source '${sourceId}' is not in the authorized-source registry — ingestion is refused (invariant 5: authorized media only; register the source first)`,
    });
  }
  const provenance: AuthorizedProvenance = {
    sourceId: source.sourceId,
    basis: source.basis,
    ...(source.label !== undefined ? { label: source.label } : {}),
    [AUTHORIZED_PROVENANCE]: "authorized",
  };
  return { ok: true, value: provenance };
}

// ---------------------------------------------------------------------------
// Ingest-time re-validation (defense in depth against forged brands)
// ---------------------------------------------------------------------------

/**
 * Re-validate an `AuthorizedProvenance` against the registry at ingest
 * time. A value smuggled past the type system (e.g. `as any` from untyped
 * code) with an unknown source is still a typed rejection — the law holds
 * at runtime, not just at compile time.
 */
export function revalidateProvenance(
  registry: AuthorizedSourceRegistry,
  provenance: AuthorizedProvenance,
): TorrentResult<AuthorizedProvenance> {
  if (typeof provenance !== "object" || provenance === null) {
    return torrentError("PROVENANCE_REJECTED", {
      detail:
        "revalidateProvenance: the provenance value is absent or malformed (invariant 5: authorized media only)",
    });
  }
  const branded = provenance as Partial<AuthorizedProvenance>;
  if (branded[AUTHORIZED_PROVENANCE] !== "authorized") {
    return torrentError("PROVENANCE_REJECTED", {
      detail:
        "revalidateProvenance: the provenance value does not carry the authorized brand (it was not minted by authorizeProvenance — invariant 5)",
    });
  }
  const source = registry.get(provenance.sourceId);
  if (source === undefined) {
    return torrentError("PROVENANCE_REJECTED", {
      detail:
        `revalidateProvenance: provenance names source '${provenance.sourceId}' which is not in the authorized-source registry — ingestion is refused (invariant 5: authorized media only)`,
    });
  }
  if (source.basis !== provenance.basis) {
    return torrentError("PROVENANCE_REJECTED", {
      detail:
        `revalidateProvenance: provenance for '${provenance.sourceId}' carries basis '${provenance.basis}' but the registry says '${source.basis}' — the authorization drifted; ingestion is refused`,
    });
  }
  return { ok: true, value: provenance };
}
