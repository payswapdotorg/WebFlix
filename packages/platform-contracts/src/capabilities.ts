/**
 * @wfx/platform-contracts — PlatformCapabilities + CapabilityDescriptor (R01).
 *
 * The aggregate port bundle a platform adapter constructs, and the truthful
 * capability declaration that travels with it. This is the adapter-side
 * half of the frozen remediation layering law
 * (docs/architecture/webflix-remediation-architecture.md):
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)
 *
 * The first seven fields are VERBATIM the frozen `PlatformCapabilities`
 * sketch of docs/architecture/contracts.md ("Shared client runtime"
 * section) — the type-level source of truth — so any value of this type
 * structurally satisfies the frozen sketch. R01 ADDS the descriptor and the
 * port bundle around them (the remediation spec's aggregate port bundle).
 *
 * CAPABILITY TRUTH (the law this module enforces):
 *
 * - Every adapter TRUTHFULLY declares what it supports. Web declares
 *   `nativeMedia: "none"` (no native torrent/media on the browser — honest
 *   unsupported states, never fake capability); Desktop declares the full
 *   reference capability set; Mobile declares its OS-constrained set.
 * - Declared capability levels and PROVIDED PORTS must agree:
 *   `browserHost: "contained"` ⇔ a BrowserHostPort is provided, etc. The
 *   pure `checkCapabilityTruth` function below verifies every rule and is
 *   called by the shared client runtime at construction — an incoherent
 *   bundle is rejected, never trusted.
 * - The runtime uses the declaration (never a probe) to produce honest
 *   `unsupported-capability` states. A fixture is never silently presented
 *   as production capability (frozen invariant 10).
 */

import type { BackgroundWorkPort } from "./background-work";
import type { BrowserHostPort } from "./browser-host";
import type { LifecyclePort } from "./lifecycle";
import type { NativeMediaPort } from "./native-media";
import type { NotificationPort } from "./notifications";
import type { SharingPort } from "./sharing";
import type { StoragePort } from "./storage";

// ---------------------------------------------------------------------------
// The frozen capability vocabulary (contracts.md "Shared client runtime")
// ---------------------------------------------------------------------------

/** The platform kinds of the frozen sketch. */
export type PlatformKind = "web" | "desktop" | "mobile";

/** Every value of `PlatformKind`, in union order. */
export const PLATFORM_KINDS: readonly PlatformKind[] = ["web", "desktop", "mobile"];

/** The storage capability kinds of the frozen sketch. */
export type StorageKind = "browser" | "filesystem" | "os-managed";

/** Every value of `StorageKind`, in union order. */
export const STORAGE_KINDS: readonly StorageKind[] = ["browser", "filesystem", "os-managed"];

/** The contained browser surface kinds of the frozen sketch. */
export type BrowserHostKind = "none" | "contained";

/** Every value of `BrowserHostKind`, in union order. */
export const BROWSER_HOST_KINDS: readonly BrowserHostKind[] = ["none", "contained"];

/** The native media capability kinds of the frozen sketch. */
export type NativeMediaKind = "none" | "local" | "native-service";

/** Every value of `NativeMediaKind`, in union order. */
export const NATIVE_MEDIA_KINDS: readonly NativeMediaKind[] = ["none", "local", "native-service"];

/** The background work capability kinds of the frozen sketch. */
export type BackgroundWorkKind = "none" | "limited" | "full";

/** Every value of `BackgroundWorkKind`, in union order. */
export const BACKGROUND_WORK_KINDS: readonly BackgroundWorkKind[] = [
  "none",
  "limited",
  "full",
];

// ---------------------------------------------------------------------------
// CapabilityDescriptor — the truthful declaration
// ---------------------------------------------------------------------------

/** The capability areas a declaration can name limitations for. */
export type CapabilityArea =
  | "storage"
  | "browserHost"
  | "nativeMedia"
  | "backgroundWork"
  | "notifications"
  | "sharing";

/** Every value of `CapabilityArea`, in union order. */
export const CAPABILITY_AREAS: readonly CapabilityArea[] = [
  "storage",
  "browserHost",
  "nativeMedia",
  "backgroundWork",
  "notifications",
  "sharing",
];

/**
 * The adapter's truthful identity + limitation declaration. `limitations`
 * carries the honest, user-facing reason for every capability absence —
 * the runtime surfaces these in `unsupported-capability` states instead of
 * a bare "not supported" (the frozen "honest unsupported states" law).
 */
export interface CapabilityDescriptor {
  /** Which platform kind this adapter binds. Must equal `platform`. */
  readonly platform: PlatformKind;
  /** Stable adapter identity (e.g. `"wfx-web-adapter"`). */
  readonly adapterId: string;
  /** The adapter's version (semver-ish string). */
  readonly adapterVersion: string;
  /** Honest per-area limitation reasons, keyed by capability area. */
  readonly limitations?: Readonly<Partial<Record<CapabilityArea, string>>>;
}

// ---------------------------------------------------------------------------
// The port bundle
// ---------------------------------------------------------------------------

/**
 * The adapter's provided ports. Lifecycle and storage are UNCONDITIONAL
 * (every platform in the frozen sketch has a lifecycle and a storage kind);
 * every other port is present exactly when the declared capability level
 * says it exists — `checkCapabilityTruth` enforces the equivalence.
 */
export interface PlatformCapabilityPorts {
  /** OS lifecycle events + hooks (always present). */
  readonly lifecycle: LifecyclePort;
  /** Persistent key-value + blob storage (always present). */
  readonly storage: StoragePort;
  /** Contained browser surface; present iff `browserHost === "contained"`. */
  readonly browserHost: BrowserHostPort | null;
  /** Native media service binding; present iff `nativeMedia !== "none"`. */
  readonly nativeMedia: NativeMediaPort | null;
  /** Notifications; present iff `notifications === true`. */
  readonly notifications: NotificationPort | null;
  /** Background work; present iff `backgroundWork !== "none"`. */
  readonly backgroundWork: BackgroundWorkPort | null;
  /** Sharing; present iff `sharing === true`. */
  readonly sharing: SharingPort | null;
}

// ---------------------------------------------------------------------------
// PlatformCapabilities — the aggregate bundle
// ---------------------------------------------------------------------------

/**
 * The aggregate port bundle an adapter constructs and hands to
 * `createRuntime`. The first seven fields are the frozen sketch verbatim;
 * `descriptor` + `ports` are the R01 aggregate additions.
 */
export interface PlatformCapabilities {
  // — frozen sketch (docs/architecture/contracts.md, "Shared client runtime") —
  readonly platform: PlatformKind;
  readonly storage: StorageKind;
  readonly browserHost: BrowserHostKind;
  readonly nativeMedia: NativeMediaKind;
  readonly backgroundWork: BackgroundWorkKind;
  readonly sharing: boolean;
  readonly notifications: boolean;

  // — R01 aggregate bundle (remediation spec) —
  /** The truthful declaration (identity + limitation reasons). */
  readonly descriptor: CapabilityDescriptor;
  /** The provided ports (presence must agree with the levels above). */
  readonly ports: PlatformCapabilityPorts;
}

// ---------------------------------------------------------------------------
// The truth law
// ---------------------------------------------------------------------------

/** One incoherence between declared capability levels and provided ports. */
export interface CapabilityTruthIssue {
  /** The area whose declaration and port bundle disagree. */
  readonly area: CapabilityArea;
  /** Human-readable description of the disagreement (non-empty). */
  readonly detail: string;
}

/**
 * Verify the capability truth law: declared levels and provided ports must
 * agree, and the descriptor must match the platform kind. Returns every
 * issue found (an empty array means the bundle is coherent). PURE and
 * deterministic — the shared client runtime calls this at construction and
 * rejects incoherent bundles; adapters and tests call it to self-check.
 *
 * Rules:
 * 1. `descriptor.platform === platform` (the declaration names its platform).
 * 2. `browserHost: "contained"` ⇔ `ports.browserHost !== null`.
 * 3. `nativeMedia !== "none"` ⇔ `ports.nativeMedia !== null`.
 * 4. `backgroundWork !== "none"` ⇔ `ports.backgroundWork !== null`.
 * 5. `sharing === true` ⇔ `ports.sharing !== null`.
 * 6. `notifications === true` ⇔ `ports.notifications !== null`.
 * 7. `ports.lifecycle` and `ports.storage` are always required (non-null by
 *    type; a runtime `null`/`undefined` smuggled in from untyped code is
 *    still reported).
 */
export function checkCapabilityTruth(capabilities: PlatformCapabilities): readonly CapabilityTruthIssue[] {
  const issues: CapabilityTruthIssue[] = [];

  const platform = capabilities?.platform;
  if (!(PLATFORM_KINDS as readonly string[]).includes(platform)) {
    return [
      {
        area: "storage",
        detail: `platform: expected one of ${PLATFORM_KINDS.join(" | ")}, got ${String(platform)}`,
      },
    ];
  }

  const descriptor = capabilities.descriptor;
  if (descriptor === null || typeof descriptor !== "object") {
    issues.push({ area: "storage", detail: "descriptor: expected a CapabilityDescriptor object" });
  } else if (descriptor.platform !== platform) {
    issues.push({
      area: "storage",
      detail: `descriptor.platform: expected '${platform}' to match the bundle's platform, got '${String(descriptor.platform)}'`,
    });
  }

  const ports = capabilities.ports;
  if (ports === null || typeof ports !== "object") {
    issues.push({ area: "storage", detail: "ports: expected a PlatformCapabilityPorts object" });
    return issues;
  }

  if (ports.lifecycle === null || ports.lifecycle === undefined) {
    issues.push({ area: "storage", detail: "ports.lifecycle: required on every platform (got null/undefined)" });
  }
  if (ports.storage === null || ports.storage === undefined) {
    issues.push({ area: "storage", detail: "ports.storage: required on every platform (got null/undefined)" });
  }

  const browserHostPortPresent = ports.browserHost !== null && ports.browserHost !== undefined;
  if (capabilities.browserHost === "contained" && !browserHostPortPresent) {
    issues.push({
      area: "browserHost",
      detail: 'browserHost: declared "contained" but no BrowserHostPort is provided',
    });
  } else if (capabilities.browserHost === "none" && browserHostPortPresent) {
    issues.push({
      area: "browserHost",
      detail: 'browserHost: declared "none" but a BrowserHostPort is provided (over-claiming is fine, under-providing is not — declare "contained")',
    });
  }

  const nativeMediaPortPresent = ports.nativeMedia !== null && ports.nativeMedia !== undefined;
  if (capabilities.nativeMedia !== "none" && !nativeMediaPortPresent) {
    issues.push({
      area: "nativeMedia",
      detail: `nativeMedia: declared "${capabilities.nativeMedia}" but no NativeMediaPort is provided`,
    });
  } else if (capabilities.nativeMedia === "none" && nativeMediaPortPresent) {
    issues.push({
      area: "nativeMedia",
      detail: 'nativeMedia: declared "none" but a NativeMediaPort is provided (declare "local"/"native-service" or remove the port)',
    });
  }

  const backgroundWorkPortPresent =
    ports.backgroundWork !== null && ports.backgroundWork !== undefined;
  if (capabilities.backgroundWork !== "none" && !backgroundWorkPortPresent) {
    issues.push({
      area: "backgroundWork",
      detail: `backgroundWork: declared "${capabilities.backgroundWork}" but no BackgroundWorkPort is provided`,
    });
  } else if (capabilities.backgroundWork === "none" && backgroundWorkPortPresent) {
    issues.push({
      area: "backgroundWork",
      detail: 'backgroundWork: declared "none" but a BackgroundWorkPort is provided (declare "limited"/"full" or remove the port)',
    });
  }

  const sharingPortPresent = ports.sharing !== null && ports.sharing !== undefined;
  if (capabilities.sharing === true && !sharingPortPresent) {
    issues.push({
      area: "sharing",
      detail: "sharing: declared true but no SharingPort is provided",
    });
  } else if (capabilities.sharing === false && sharingPortPresent) {
    issues.push({
      area: "sharing",
      detail: "sharing: declared false but a SharingPort is provided (declare true or remove the port)",
    });
  }

  const notificationPortPresent = ports.notifications !== null && ports.notifications !== undefined;
  if (capabilities.notifications === true && !notificationPortPresent) {
    issues.push({
      area: "notifications",
      detail: "notifications: declared true but no NotificationPort is provided",
    });
  } else if (capabilities.notifications === false && notificationPortPresent) {
    issues.push({
      area: "notifications",
      detail: "notifications: declared false but a NotificationPort is provided (declare true or remove the port)",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Truth helpers (pure; no domain imports — this package is standalone)
// ---------------------------------------------------------------------------

/**
 * Whether the platform can truthfully host TORRENT-BACKED acquisition: a
 * native media service AND background work (the frozen Desktop reference
 * capability; Web is honestly `false` — `nativeMedia: "none"`).
 */
export function supportsTorrentAcquisition(capabilities: PlatformCapabilities): boolean {
  return capabilities.nativeMedia === "native-service" && capabilities.backgroundWork !== "none";
}

/** Whether the platform provides a contained browser surface. */
export function supportsBrowserHost(capabilities: PlatformCapabilities): boolean {
  return capabilities.browserHost === "contained" && capabilities.ports.browserHost !== null;
}

/** Whether the platform provides any native media binding (local or service). */
export function supportsNativeMedia(capabilities: PlatformCapabilities): boolean {
  return capabilities.nativeMedia !== "none" && capabilities.ports.nativeMedia !== null;
}
