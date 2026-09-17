/**
 * @wfx/experience — the OFFICIAL-EMBED capability model (R09, Media Surface).
 *
 * The EMBED rung's availability truth: an embed realization is an OFFICIAL
 * embed when the provider exposed it as their own documented, permitted
 * embeddable player. The frozen architecture is verbatim law here
 * (docs/architecture/webflix-remediation-architecture.md, invariant 4):
 *
 * - The embed surface is over the provider's OFFICIAL embed mechanism only
 *   — iframe embeds the provider documents and permit. NO scraping, NO
 *   undocumented endpoints, NO circumvention of provider DRM, access
 *   controls, CAPTCHAs, anti-bot controls, rate limits, or geographic
 *   restrictions.
 * - The marker this module defines is an ATTESTATION a provider/connector
 *   attaches to a realization: `"officialEmbed"` in the realization's
 *   free-form `capabilities` array (the same forward-compatible channel
 *   every other play-contract statement uses). It attests "this URL is our
 *   own embeddable player URL, exposed by us for embedding".
 * - The marker NEVER overrides the frozen precedence and NEVER fabricates
 *   availability (the same law provider hints obey — see `request.ts`).
 *   Its effect is TRUTH-NAMING: the rung's honest answer differentiates
 *   `official` / `unofficial` / `absent`, and the surface renders the
 *   attestation honestly. A realization without the marker is still
 *   resolver-eligible exactly as the frozen resolver treats it; the answer
 *   simply names the attestation level it truthfully carries.
 * - WHERE NO PROVIDER EXPOSES EMBEDS, the rung answers honestly-unavailable
 *   — the frozen resolver already records `"embed: rejected — no embed
 *   realization present"`; a fixture is never silently presented as
 *   production capability (invariant 10): the fixture connector's embeds
 *   are fixture-sourced and loudly named as such by the transport that
 *   carries them.
 *
 * THE EMBED CONTAINMENT LAW (frozen: "contained exactly like the browser
 * rung"): an embed session is contained under the same discipline as the
 * contained BrowserHost rung — `EMBED_SANDBOX_TOKENS` mirror the web
 * adapter's sandbox law verbatim (deliberately WITHOUT `allow-same-origin`
 * and WITHOUT `allow-storage-access-by-user-activation`, so the provider's
 * page runs in an OPAQUE ORIGIN: cookie/storage isolated from the WebFlix
 * origin and from every other surface session). The DESKTOP embed runs in
 * the desktop BrowserHost's contained webview (the same port, the same
 * per-session isolation).
 *
 * PURE DATA + PURE FUNCTIONS ONLY — deterministic, no clock, no entropy.
 */

import type { DeviceCapabilities, PlaybackRealization } from "@wfx/domain";
import { canPlay, isRecord } from "@wfx/domain";

import { SURFACE_DEVICE_PROFILES } from "./matrix";

// ---------------------------------------------------------------------------
// The official-embed marker
// ---------------------------------------------------------------------------

/**
 * The capability entry that attests an embed realization is the provider's
 * OFFICIAL embeddable player: a URL the provider themselves documents and
 * permits for embedding. Providers/connectors attach it to the realization's
 * free-form `capabilities` array.
 */
export const OFFICIAL_EMBED_CAPABILITY = "officialEmbed";

/**
 * Whether one realization carries the official-embed attestation. Defensive
 * against untrusted shapes (a non-record or a missing capabilities array
 * simply carries no marker — never a crash, never a fabricated marker).
 */
export function isOfficialEmbed(realization: PlaybackRealization): boolean {
  if (!isRecord(realization)) return false;
  if (realization.mode !== "embed") return false;
  const capabilities: unknown = realization.capabilities;
  if (!Array.isArray(capabilities)) return false;
  return capabilities.includes(OFFICIAL_EMBED_CAPABILITY);
}

// ---------------------------------------------------------------------------
// The rung's honest truth over a realization set
// ---------------------------------------------------------------------------

/** The official-embed truth of a realization set. */
export type OfficialEmbedTruth = "official" | "unofficial" | "absent";

/** The honest per-request embed truth: the verdict, the counts, the name. */
export interface OfficialEmbedTruthReport {
  /** `"official"` — at least one embed realization carries the marker. */
  readonly truth: OfficialEmbedTruth;
  /** Embed realizations carrying the official marker. */
  readonly officialCount: number;
  /** Embed realizations WITHOUT the marker (present but unattested). */
  readonly unofficialCount: number;
  /** NON-EMPTY honest description (the answer NAMES the truth). */
  readonly description: string;
}

/**
 * The official-embed truth of a candidate set: `official` when any embed
 * realization carries the marker; `unofficial` when embed realizations
 * exist but none is attested; `absent` when there are no embed realizations
 * at all (the rung's honest-unavailable case). Pure; input order does not
 * matter.
 */
export function officialEmbedTruth(
  realizations: readonly PlaybackRealization[],
): OfficialEmbedTruthReport {
  let officialCount = 0;
  let unofficialCount = 0;
  for (const realization of realizations) {
    if (!isRecord(realization) || realization.mode !== "embed") continue;
    if (isOfficialEmbed(realization)) {
      officialCount += 1;
    } else {
      unofficialCount += 1;
    }
  }
  if (officialCount > 0) {
    return {
      truth: "official",
      officialCount,
      unofficialCount,
      description: `the provider exposes an official embed player (${officialCount} attested embed realization${
        officialCount === 1 ? "" : "s"
      }${unofficialCount > 0 ? `; ${unofficialCount} unattested` : ""})`,
    };
  }
  if (unofficialCount > 0) {
    return {
      truth: "unofficial",
      officialCount,
      unofficialCount,
      description:
        "embed realizations are present but none carries the provider's official-embed attestation — the rung is resolver-eligible exactly as the frozen resolver treats it, and the surface names the unattested level honestly",
    };
  }
  return {
    truth: "absent",
    officialCount,
    unofficialCount,
    description:
      "no provider exposes an embed realization for this request — the rung answers honestly-unavailable (the frozen resolver records 'no embed realization present')",
  };
}

// ---------------------------------------------------------------------------
// The embed containment law (shared by both adapters' embed surfaces)
// ---------------------------------------------------------------------------

/**
 * The sandbox tokens of the contained EMBED surface — the SAME discipline as
 * the contained browser rung (frozen: "contained exactly like the browser
 * rung"). Deliberately WITHOUT `allow-same-origin` (opaque origin — the
 * cookie/storage isolation) and WITHOUT
 * `allow-storage-access-by-user-activation` (no provider storage grant).
 * `allow-scripts` lets the provider's own embeddable player run — it is
 * their player, running isolated.
 */
export const EMBED_SANDBOX_TOKENS: readonly string[] = [
  "allow-scripts",
  "allow-forms",
  "allow-popups",
  "allow-presentation",
];

/** The containment-law lines every embed surface renders/keeps (verbatim law). */
export const EMBED_CONTAINMENT_LAW: readonly string[] = [
  "the embed runs over the provider's OFFICIAL embed mechanism only — no scraping, no undocumented endpoints, no circumvention",
  "the embed session is contained exactly like the browser rung: sandboxed, cookie/storage-isolated, opaque-origin",
  "the provider-owned page stays opaque: no script injection, no credential capture, no content inspection",
];

/**
 * Whether a sandbox token list satisfies the embed containment law: every
 * token of {@link EMBED_SANDBOX_TOKENS} present, and NEITHER forbidden token
 * (`allow-same-origin` / `allow-storage-access-by-user-activation`) present.
 * Pure — adapters and tests assert their mounts against it.
 */
export function satisfiesEmbedContainment(tokens: readonly string[]): boolean {
  if (!Array.isArray(tokens)) return false;
  for (const required of EMBED_SANDBOX_TOKENS) {
    if (!tokens.includes(required)) return false;
  }
  if (tokens.includes("allow-same-origin")) return false;
  if (tokens.includes("allow-storage-access-by-user-activation")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The matrix extension — the matrix consumes the marker
// ---------------------------------------------------------------------------

/** The embed rung's decision for one (device-profile × embed-truth) cell. */
export type EmbedMatrixDecision =
  /** The rung is device-capable and officially attested — the honest best case. */
  | "chosen-official"
  /** The rung is device-capable; realizations are present but unattested — named honestly. */
  | "chosen-unofficial"
  /** No embed realizations at all — the rung answers honestly-unavailable. */
  | "absent"
  /** The profile declares no embed capability (canPlay false) — named, never attempted. */
  | "rejected-device";

/** One row of the embed capability matrix. */
export interface EmbedMatrixRow {
  /** The device profile (row group; the frozen matrix profiles verbatim). */
  readonly profile: string;
  /** The official-embed truth of the probe set. */
  readonly truth: OfficialEmbedTruth;
  /** Whether the profile's device declares the embed mode (WFX-002 canPlay). */
  readonly deviceSupportsEmbed: boolean;
  /** The rung's decision for this cell. */
  readonly decision: EmbedMatrixDecision;
  /** NON-EMPTY honest reason (the answer NAMES the truth). */
  readonly reason: string;
}

/**
 * The embed capability matrix — THE MATRIX CONSUMES THE MARKER: for every
 * frozen device profile × every official-embed truth, the row states the
 * embed rung's decision and its named reason. Pure data, deterministic
 * (profile order × truth order), networkless — the deterministic test
 * layer for "the embed marker consumed when present".
 */
export function embedCapabilityMatrix(): readonly EmbedMatrixRow[] {
  const rows: EmbedMatrixRow[] = [];
  for (const profile of SURFACE_DEVICE_PROFILES) {
    for (const truth of ["official", "unofficial", "absent"] as const) {
      const deviceSupportsEmbed = canPlayEmbed(profile.device);
      let decision: EmbedMatrixDecision;
      if (!deviceSupportsEmbed) {
        decision = "rejected-device";
      } else if (truth === "official") {
        decision = "chosen-official";
      } else if (truth === "unofficial") {
        decision = "chosen-unofficial";
      } else {
        decision = "absent";
      }
      rows.push({
        profile: profile.id,
        truth,
        deviceSupportsEmbed,
        decision,
        reason: embedMatrixReason(profile.id, decision),
      });
    }
  }
  return rows;
}

/** Whether a device declares the embed mode (WFX-002 `canPlay`). */
function canPlayEmbed(device: Readonly<DeviceCapabilities>): boolean {
  return canPlay(device, "embed");
}

/** The named reason for one embed-matrix cell (deterministic formats). */
function embedMatrixReason(
  profile: string,
  decision: EmbedMatrixDecision,
): string {
  switch (decision) {
    case "chosen-official":
      return `embed: chosen on '${profile}' — the provider's official embed player is exposed and the device declares the embed mode`;
    case "chosen-unofficial":
      return `embed: chosen on '${profile}' — embed realizations are present but unattested; the answer names the unofficial level honestly`;
    case "absent":
      return `embed: honestly-unavailable on '${profile}' — no provider exposes an embed realization for this request`;
    case "rejected-device":
      return `embed: rejected on '${profile}' — the device cannot realize embed playback (canPlay=false; embed requires the browser surface)`;
  }
}
