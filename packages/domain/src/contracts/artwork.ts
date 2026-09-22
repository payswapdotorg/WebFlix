/**
 * @wfx/domain — the content ARTWORK contract (R26-W1, the real-artwork law).
 *
 * THE LAW THIS MODULE BINDS (the R26 corrective takeover's explicit ask):
 *
 *   The shared content model carries REAL SOURCE ARTWORK — the
 *   provider/connector's own thumbnail/poster URL where the source
 *   authorizes it — with honest provenance, honest aspect ratio, honest
 *   fallback, and honest cache truth. GENERATED artwork is permitted
 *   ONLY as an EXPLICIT FALLBACK for content genuinely lacking artwork;
 *   it must NEVER replace an available source thumbnail.
 *
 * WHERE THE REAL ARTWORK ALREADY FLOWS: connectors project their
 * source-authorized artwork URL into the content model's `metadata`
 * bag under the well-known `thumbnailUrl` key (e.g. the YouTube
 * connector's projection of `snippet.thumbnails` — the LIVE catalog
 * carries real thumbnails at the source). Until now that key stayed an
 * untyped bag entry the discovery surfaces dropped on the floor; this
 * contract is the typed carrier the experience/host lanes bind, so the
 * web lane can render real artwork (`<img>`), and the Desktop lane
 * renders from the SAME contract (one canonical content model — never
 * duplicated per-platform semantics).
 *
 * SOURCE AUTHORIZATION (frozen law, invariant 4/10): only URLs the
 * CONNECTOR itself reported for the item enter the contract — the
 * connector lane is the authorization boundary (it may only project
 * what the source's own API answers). This module never fabricates,
 * never rewrites, and never proxies a URL; `contentArtworkOf` VALIDATES
 * shape (absolute http/https) and carries the connector's truth
 * verbatim. A data: URL, a relative path, or a non-http scheme is
 * rejected to the honest fallback — never smuggled into an <img>.
 *
 * DETERMINISM: pure types + pure projection. No fetching, no clock, no
 * environment — cache/fetch behavior is the consuming surface's
 * concern; this contract only carries the TRUTH about what to load and
 * what to fall back to.
 */

// ---------------------------------------------------------------------------
// The contract types
// ---------------------------------------------------------------------------

/** Which artwork variant the source serves at a URL. */
export type ContentArtworkVariant = "thumbnail" | "poster";

/** The fallback kind when a URL fails to load or no artwork exists. */
export type ContentArtworkFallbackKind =
  | "placeholder-monogram"
  | "generated-fallback";

/**
 * Where the artwork came from — the honest provenance. `kind` is
 * `"source-artwork"` for a connector-projected URL: `connectorId` names
 * the reporting connector (the authorization boundary) and `sourceRef`
 * the source's own artwork identifier when the connector reported one.
 * There is deliberately NO "webflix-artwork" provenance: WebFlix never
 * rehosts or regenerates source artwork — a generated fallback is
 * fallback truth, not artwork provenance.
 */
export interface ContentArtworkProvenance {
  readonly kind: "source-artwork";
  /** The connector that reported the artwork (the authorization boundary). */
  readonly connectorId: string;
  /** The source's own artwork identifier when the connector reported one. */
  readonly sourceRef?: string;
}

/**
 * The explicit fallback behavior when the artwork cannot render. The
 * kinds, in honesty order:
 *
 * - `"placeholder-monogram"` — the text-initial gradient placeholder
 *   (deterministic, local, never claims to be artwork);
 * - `"generated-fallback"`   — GENERATED artwork (AI or procedural) for
 *   content GENUINELY LACKING artwork — explicit fallback ONLY, never a
 *   replacement for an available source thumbnail (the law above).
 */
export interface ContentArtworkFallback {
  readonly kind: ContentArtworkFallbackKind;
  /** The one-sentence truth of what the fallback renders. */
  readonly detail: string;
}

/**
 * The source's artwork capability truth for one item, as the connector
 * reported it: `artworkServed` is true exactly when the connector
 * carried a source-authorized artwork URL for the item. Per-item truth
 * (NOT a per-connector capability claim — a connector may serve
 * artwork for most items and honestly lack it for some).
 */
export interface ContentArtworkSourceTruth {
  readonly artworkServed: boolean;
  /** The connector that reported (or honestly did not report) artwork. */
  readonly connectorId: string;
}

/**
 * The cache truth: the URL is the SOURCE'S OWN — served at the source's
 * availability and cache policy. WebFlix does not rehost, proxy, or
 * extend the source's cache semantics; the surface caches per the
 * source's headers only. `origin: "source"` is the only value today —
 * the type stays open for a future WebFlix-cached variant a lead-
 * ratified contract change would add (add-only law).
 */
export interface ContentArtworkCacheTruth {
  readonly origin: "source";
  /** The one-sentence truth of how this URL is served. */
  readonly detail: string;
}

/**
 * ONE item's real source artwork — the typed carrier the discovery and
 * detail surfaces bind. Every field is honest by construction:
 * `contentArtworkOf` builds this ONLY from a connector-reported,
 * http(s)-absolute URL; everything else answers the
 * {@link ContentArtworkResolution} fallback arm.
 */
export interface ContentArtwork {
  /** The source-authorized artwork URL (absolute http/https, verbatim). */
  readonly url: string;
  /** Which variant the source serves at this URL. */
  readonly variant: ContentArtworkVariant;
  /** Where the artwork came from (the honest provenance). */
  readonly provenance: ContentArtworkProvenance;
  /**
   * The aspect ratio (width / height) when the source carries a
   * dimension signal; HONESTLY ABSENT when it does not. Derived from the
   * item's orientation signal when the connector reported no explicit
   * dimensions (`horizontal` → 16/9, `vertical` → 9/16, `square` → 1) —
   * the same public signal the connector projects; never a guess beyond
   * it.
   */
  readonly aspectRatio?: number;
  /** What renders if this URL fails to load (never a dead box). */
  readonly fallback: ContentArtworkFallback;
  /** The source's per-item artwork truth. */
  readonly source: ContentArtworkSourceTruth;
  /** The cache truth (the source's own URL, the source's own policy). */
  readonly cache: ContentArtworkCacheTruth;
}

/**
 * The artwork RESOLUTION for one item — the two honest outcomes:
 *
 * - `"source-artwork"` — the connector carried a real, authorized URL;
 *   the surface renders it (an `<img>`), falling back per
 *   `artwork.fallback` only if the load fails.
 * - `"fallback-only"` — the content genuinely lacks artwork (or the
 *   connector's entry was malformed and was rejected — never
 *   smuggled). The surface renders the EXPLICIT fallback; generated
 *   artwork is permitted here and here ONLY.
 */
export type ContentArtworkResolution =
  | { readonly kind: "source-artwork"; readonly artwork: ContentArtwork }
  | {
      readonly kind: "fallback-only";
      readonly fallback: ContentArtworkFallback;
      /** The honest reason artwork is absent (rendered as the title's truth). */
      readonly reason: string;
      /** The connector whose item lacked artwork (the per-item truth). */
      readonly connectorId: string;
    };

// ---------------------------------------------------------------------------
// The extraction (the metadata bag → the typed contract)
// ---------------------------------------------------------------------------

/**
 * The well-known metadata key connectors project their source-authorized
 * artwork URL under (the YouTube connector's projection of
 * `snippet.thumbnails` — the LIVE catalog's real thumbnails). ONE key,
 * ONE spelling: the typed carrier reads exactly this key.
 */
export const CONTENT_ARTWORK_METADATA_KEY = "thumbnailUrl" as const;

/** The default fallback (the placeholder monogram — deterministic, local). */
export const CONTENT_ARTWORK_PLACEHOLDER_FALLBACK: ContentArtworkFallback = {
  kind: "placeholder-monogram",
  detail:
    "A text-initial placeholder renders where the source serves no artwork.",
} as const;

/** The cache-truth sentence every source-origin artwork carries. */
export const CONTENT_ARTWORK_SOURCE_CACHE_DETAIL =
  "Served by the source at its own availability — WebFlix does not rehost or proxy source artwork." as const;

/** Is the value an absolute http(s) URL (the only URL that may enter an <img>)? */
function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The honest aspect ratio from an orientation signal (or none). */
function aspectRatioFromOrientation(
  orientation: string | undefined,
): number | undefined {
  switch (orientation) {
    case "horizontal":
      return 16 / 9;
    case "vertical":
      return 9 / 16;
    case "square":
      return 1;
    default:
      return undefined;
  }
}

/**
 * The shape this extractor projects over — structurally satisfied by
 * both frozen-carried content shapes (`SearchResult`, `SourceItem`):
 * they all carry connectorId/externalRef/title and the optional
 * orientation + metadata bag. Structural (not imported-by-name) so the
 * extractor stays usable over both shapes without a union juggling.
 */
export interface ContentArtworkCarrier {
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title?: string;
  readonly orientation?: "horizontal" | "vertical" | "square" | "unknown";
  readonly metadata?: Record<string, unknown>;
}

/**
 * Resolve one item's artwork truth from the shared content model.
 *
 * The honest projection: read the connector's `thumbnailUrl` metadata
 * entry; if it is an absolute http(s) URL, carry it verbatim as
 * source-authorized artwork (provenance names the connector); anything
 * else — absent, empty, or malformed — answers `fallback-only` with the
 * honest reason. NEVER a fabricated URL, NEVER a generated image in
 * place of an available source thumbnail.
 */
export function contentArtworkOf(
  carrier: ContentArtworkCarrier,
): ContentArtworkResolution {
  const raw = carrier.metadata?.[CONTENT_ARTWORK_METADATA_KEY];
  if (raw === undefined || raw === null) {
    return {
      kind: "fallback-only",
      fallback: CONTENT_ARTWORK_PLACEHOLDER_FALLBACK,
      reason:
        "The source carries no artwork for this item — the placeholder renders instead.",
      connectorId: carrier.connectorId,
    };
  }
  if (!isAbsoluteHttpUrl(raw)) {
    return {
      kind: "fallback-only",
      fallback: CONTENT_ARTWORK_PLACEHOLDER_FALLBACK,
      reason:
        "The source's artwork entry was malformed and was rejected — never rendered unvalidated.",
      connectorId: carrier.connectorId,
    };
  }
  const aspectRatio = aspectRatioFromOrientation(carrier.orientation);
  const artwork: ContentArtwork = {
    url: raw,
    variant: "thumbnail",
    provenance: {
      kind: "source-artwork",
      connectorId: carrier.connectorId,
      ...(carrier.externalRef.length > 0
        ? { sourceRef: carrier.externalRef }
        : {}),
    },
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    fallback: CONTENT_ARTWORK_PLACEHOLDER_FALLBACK,
    source: { artworkServed: true, connectorId: carrier.connectorId },
    cache: { origin: "source", detail: CONTENT_ARTWORK_SOURCE_CACHE_DETAIL },
  };
  return { kind: "source-artwork", artwork };
}

/**
 * THE RENDER LAW as a pure derivation: whether the resolution carries a
 * real source URL the surface should render as an image. `true` ONLY
 * for the `source-artwork` arm — a fallback-only resolution never
 * renders as though artwork existed.
 */
export function resolutionCarriesSourceArtwork(
  resolution: ContentArtworkResolution,
): boolean {
  return resolution.kind === "source-artwork";
}

/** Structural guard for a claimed content-artwork contract value. */
export function isContentArtwork(x: unknown): x is ContentArtwork {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (!isAbsoluteHttpUrl(record.url)) return false;
  if (record.variant !== "thumbnail" && record.variant !== "poster") {
    return false;
  }
  const provenance = record.provenance;
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    (provenance as Record<string, unknown>).kind !== "source-artwork" ||
    typeof (provenance as Record<string, unknown>).connectorId !== "string"
  ) {
    return false;
  }
  const fallback = record.fallback;
  if (
    typeof fallback !== "object" ||
    fallback === null ||
    typeof (fallback as Record<string, unknown>).kind !== "string" ||
    typeof (fallback as Record<string, unknown>).detail !== "string"
  ) {
    return false;
  }
  const source = record.source;
  if (
    typeof source !== "object" ||
    source === null ||
    (source as Record<string, unknown>).artworkServed !== true ||
    typeof (source as Record<string, unknown>).connectorId !== "string"
  ) {
    return false;
  }
  if (
    record.aspectRatio !== undefined &&
    (typeof record.aspectRatio !== "number" ||
      !Number.isFinite(record.aspectRatio) ||
      record.aspectRatio <= 0)
  ) {
    return false;
  }
  const cache = record.cache;
  if (
    typeof cache !== "object" ||
    cache === null ||
    (cache as Record<string, unknown>).origin !== "source" ||
    typeof (cache as Record<string, unknown>).detail !== "string"
  ) {
    return false;
  }
  return true;
}

/** Structural guard for a claimed artwork resolution. */
export function isContentArtworkResolution(
  x: unknown,
): x is ContentArtworkResolution {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (record.kind === "source-artwork") {
    return isContentArtwork(record.artwork);
  }
  if (record.kind === "fallback-only") {
    const fallback = record.fallback;
    return (
      typeof fallback === "object" &&
      fallback !== null &&
      typeof (fallback as Record<string, unknown>).kind === "string" &&
      typeof (fallback as Record<string, unknown>).detail === "string" &&
      typeof record.reason === "string" &&
      typeof record.connectorId === "string"
    );
  }
  return false;
}
