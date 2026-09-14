/**
 * @wfx/model-fabric/src/transform — transformation permission enforcement (WFX-033, Lane A).
 *
 * `TransformationPermissions` is the ONLY authority that decides whether a
 * transformation task may run against a media provenance record. The pipeline
 * (`pipeline.ts`) consults it BEFORE any fabric invocation — there is no code
 * path around it — and echoes its verdict on every receipt.
 *
 * HARD LAWS (docs/architecture/product-boundaries.md, encoded + tested):
 * 1. Transformation of UNAUTHORIZED media is ALWAYS denied — no task, no
 *    license flag combination, no options override changes this.
 * 2. DRM-PROTECTED inputs are ALWAYS denied — no circumvention path exists.
 * 3. DUBBING and COMMENTARY require their explicit license flags
 *    (`allowsDubbing` / `allowsCommentary`); transcript-family tasks require
 *    `allowsTranscript`; translation-family tasks (translation, subtitle)
 *    require `allowsTranslation`. Summary and speech carry no specific
 *    license flag (they derive nothing the four flags gate); they are still
 *    bound by laws 1 and 2.
 * 4. EVERY denial carries an ACTIONABLE reason naming the task, the missing
 *    requirement, and the source — never a bare boolean.
 *
 * Check order is deterministic: unauthorized → DRM → license flag, so a
 * fully-licensed unauthorized source still reports the authorization denial.
 *
 * Subtitle-scope decision (lead-visible): SubtitleTask requires only
 * `allowsTranslation`. Its input embeds an ALREADY-DERIVED transcript; the
 * transformation performed is translation of cue texts. Transcript
 * derivation permission was enforced when the transcript was produced.
 *
 * Totality: `check` assumes a structurally valid `MediaProvenanceRecord`
 * (the pipeline always validates `media.*` first, answering typed field-path
 * errors otherwise). Liar records still fail CLOSED: authorization and
 * license flags are granted only on explicit `true`; only an explicit `true`
 * `drmProtected` marks DRM.
 */

import type { MediaProvenanceRecord, TransformationTaskKind } from "./tasks";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The four license flags a media provenance record carries. */
export type LicenseFlagName =
  | "allowsTranscript"
  | "allowsTranslation"
  | "allowsDubbing"
  | "allowsCommentary";

/** The typed permission verdict: `reason` is actionable on EVERY branch. */
export interface PermissionVerdict {
  allowed: boolean;
  reason: string;
}

/** Anything that identifies a transformation task: the kind, or an object carrying one. */
export type TransformationTaskLike =
  | TransformationTaskKind
  | { readonly kind: TransformationTaskKind };

// ---------------------------------------------------------------------------
// Task kind → required license flag (compile-time exhaustive)
// ---------------------------------------------------------------------------

/**
 * The golden task→license-flag mapping. `undefined` means the task needs no
 * flag beyond authorization + non-DRM (summary, speech).
 */
const REQUIRED_LICENSE_FLAG_BY_KIND: Readonly<
  Record<TransformationTaskKind, LicenseFlagName | undefined>
> = {
  transcript: "allowsTranscript",
  transcribe: "allowsTranscript",
  translation: "allowsTranslation",
  subtitle: "allowsTranslation",
  summary: undefined,
  speech: undefined,
  dubbing: "allowsDubbing",
  commentary: "allowsCommentary",
};

function kindOf(task: TransformationTaskLike): TransformationTaskKind {
  return typeof task === "string" ? task : task.kind;
}

// ---------------------------------------------------------------------------
// The permission authority
// ---------------------------------------------------------------------------

/** The surface of the {@link TransformationPermissions} facade. */
export interface TransformationPermissionsApi {
  /**
   * The license flag the task requires, or `undefined` when authorization +
   * non-DRM alone suffice. Golden mapping, tested exhaustively.
   */
  requiredLicenseFlag(task: TransformationTaskLike): LicenseFlagName | undefined;
  /**
   * Judge `task` against a provenance record. Deterministic order:
   * unauthorized → DRM-protected → required license flag → allowed.
   */
  check(provenance: MediaProvenanceRecord, task: TransformationTaskLike): PermissionVerdict;
}

/**
 * The transformation permission authority — a frozen facade over the pure
 * verdict logic (no state, no I/O, no configuration: hard laws are not
 * configurable).
 */
export const TransformationPermissions: TransformationPermissionsApi = Object.freeze({
  requiredLicenseFlag(task: TransformationTaskLike): LicenseFlagName | undefined {
    return REQUIRED_LICENSE_FLAG_BY_KIND[kindOf(task)];
  },

  check(
    provenance: MediaProvenanceRecord,
    task: TransformationTaskLike,
  ): PermissionVerdict {
    const kind = kindOf(task);

    // Hard law 1: unauthorized media — ALWAYS denied, for every task.
    if (provenance.authorizedSource !== true) {
      return {
        allowed: false,
        reason: `transformation of unauthorized media is always denied — source '${provenance.sourceId}' is not an authorized source (user-owned, licensed, public-domain, Creative Commons, or otherwise authorized)`,
      };
    }

    // Hard law 2: DRM-protected inputs — ALWAYS denied, no circumvention.
    if (provenance.drmProtected === true) {
      return {
        allowed: false,
        reason: `transformation of DRM-protected inputs is always denied — source '${provenance.sourceId}' is marked DRM-protected; no circumvention path exists`,
      };
    }

    // Hard law 3: task-specific license flags.
    const required = REQUIRED_LICENSE_FLAG_BY_KIND[kind];
    if (required !== undefined && provenance[required] !== true) {
      return {
        allowed: false,
        reason: `${kind} requires ${required} license flag — source ${provenance.sourceId} marks it false`,
      };
    }

    return {
      allowed: true,
      reason:
        required === undefined
          ? `authorized source '${provenance.sourceId}' with no DRM protection — ${kind} requires no specific license flag`
          : `authorized source '${provenance.sourceId}' with no DRM protection — ${kind} license flag ${required} is granted`,
    };
  },
});
