/**
 * @wfx/app-web — cross-platform capability profiles + platform adapters
 * (WFX-040, Lane C — SHARED by apps/web, apps/desktop, apps/mobile).
 *
 * The "Platform Adapters" boundary of the frozen architecture
 * (docs/architecture/webflix-frozen-architecture.md): "Web, desktop, iOS,
 * and Android translate lifecycle/storage/browser/playback/casting
 * capabilities into shared contracts." This module is that translation for
 * the three client shells — the capability PARITY layer every client boots
 * on. The cross-platform strategy is the law here:
 *
 * - Web is broad but browser-constrained (no WebFlix-controlled media path).
 * - Desktop is the REFERENCE full-power native client.
 * - Mobile uses native media/platform facilities and OS-constrained
 *   background behavior.
 * - All share domain semantics and event vocabulary (the parity invariant
 *   lives in `parity.ts`; the runtime façade in `runtime.ts`).
 *
 * Capability honesty (product invariant 10 — "no hidden mocks; claimed
 * capability must be real or explicitly unsupported") shapes every profile:
 * a playback mode a platform cannot realize is NOT declared, a background
 * behavior a platform cannot promise is typed as a policy, and the fixture
 * adapter implementations are explicit TEST FIXTURES (deterministic,
 * in-memory, no I/O) — the real platform bindings are the packaging work
 * (post-MVP, per the dispatch packet).
 *
 * Error-channel law (the repo convention): invalid CALLER INPUT throws the
 * typed `ExperienceError` (imported from `@wfx/experience`, the same misuse
 * channel the Experience Core uses); platform conditions are typed values,
 * never thrown, never faked.
 *
 * Determinism laws: no `Date.now()`, no `Math.random()`, no hidden globals,
 * no shared mutable state — every `create*Platform()` call builds FRESH
 * fixture adapters, so two runtimes never observe each other's storage or
 * lifecycle listeners.
 */

import type { DeviceCapabilities } from "@wfx/domain";
import { PLAYBACK_MODES, isRecord, previewValue } from "@wfx/domain";

import type { BrowserHost } from "@wfx/experience";
import { ExperienceError, createFixtureBrowserHost } from "@wfx/experience";

// ---------------------------------------------------------------------------
// Platform identity
// ---------------------------------------------------------------------------

/** The three client shells sharing this capability layer. */
export type PlatformId = "web" | "desktop" | "mobile";

// ---------------------------------------------------------------------------
// Background policy — the typed OS-constrained background model
// ---------------------------------------------------------------------------

/** Network classes the OS background policy can distinguish. */
export type NetworkClass = "wifi" | "cellular" | "offline";

/**
 * The OS-level constraints of a mobile background-completion policy: which
 * network classes may carry background work, and whether the device must be
 * charging. Both fields are honored by {@link decideBackground}.
 */
export interface MobileBackgroundConstraints {
  /** Network classes that permit background completion (non-empty). */
  readonly allowedNetworks: readonly NetworkClass[];
  /** Whether background completion requires the device to be charging. */
  readonly requireCharging: boolean;
}

/**
 * The OS background inputs injected into a mobile runtime ("cellular /
 * charging inputs honored" — the frozen cross-platform strategy). Read at
 * decision time by {@link decideBackground}; never polled, never guessed.
 */
export interface MobileBackgroundInputs {
  /** The current network class as reported by the OS. */
  readonly networkClass: NetworkClass;
  /** Whether the device is currently charging. */
  readonly charging: boolean;
}

/**
 * The per-platform background policy:
 * - `"never"` — the platform cannot promise background completion (web:
 *   browsers suspend background video playback).
 * - `"always"` — the platform keeps playing while unfocused (desktop: the
 *   reference full-power client, background completion).
 * - `"os-constrained"` — the platform continues ONLY under OS-proven
 *   conditions (mobile: cellular/charging inputs honored).
 */
export type BackgroundPolicy =
  | { readonly kind: "never"; readonly reason: string }
  | { readonly kind: "always"; readonly reason: string }
  | { readonly kind: "os-constrained"; readonly constraints: MobileBackgroundConstraints };

/**
 * The typed background-completion decision. `pause` is a DECISION surfaced
 * to the host (typed, not executed) — the client runtime never fabricates
 * media control it does not own.
 */
export type BackgroundDecision =
  | { readonly action: "continue"; readonly reason: string }
  | { readonly action: "pause"; readonly reason: string };

/**
 * Decide background completion for one platform under its policy and (for
 * OS-constrained platforms) the injected OS inputs. Pure and deterministic:
 * the same policy + inputs always yield the same decision and reason text.
 *
 * Safe-side law: an OS-constrained policy without injected inputs pauses
 * (continuation conditions are UNPROVEN, never assumed); an unknown policy
 * kind at runtime also pauses (capability honesty — no fabricated continue).
 */
export function decideBackground(
  policy: BackgroundPolicy,
  inputs?: MobileBackgroundInputs,
): BackgroundDecision {
  switch (policy.kind) {
    case "never":
      return { action: "pause", reason: policy.reason };
    case "always":
      return { action: "continue", reason: policy.reason };
    case "os-constrained": {
      if (inputs === undefined) {
        return {
          action: "pause",
          reason:
            "os-constrained background policy without injected OS inputs: continuation conditions unproven — safe-side pause",
        };
      }
      const allowed = policy.constraints.allowedNetworks;
      if (!allowed.includes(inputs.networkClass)) {
        return {
          action: "pause",
          reason: `background completion paused: network class '${inputs.networkClass}' is not in the allowed networks (${allowed.join(" | ")})`,
        };
      }
      if (policy.constraints.requireCharging && !inputs.charging) {
        return {
          action: "pause",
          reason:
            "background completion paused: charging is required by the OS policy but the device reports not charging",
        };
      }
      const chargingPart = policy.constraints.requireCharging
        ? `device charging (${inputs.charging})`
        : "charging not required";
      return {
        action: "continue",
        reason: `os-constrained background policy satisfied: network class '${inputs.networkClass}' allowed, ${chargingPart}`,
      };
    }
    default:
      return {
        action: "pause",
        reason: `unknown background policy kind ${previewValue(policy)} — safe-side pause (capability honesty)`,
      };
  }
}

// ---------------------------------------------------------------------------
// StoragePort — the platform K/V seam
// ---------------------------------------------------------------------------

/** The typed result of a storage write (a quota ceiling can FAIL — typed, never faked). */
export type StorageWriteResult =
  | { readonly ok: true; readonly usedBytes: number }
  | {
      readonly ok: false;
      readonly reason: "quota-exceeded";
      readonly limitBytes: number;
      readonly requiredBytes: number;
    };

/**
 * The platform storage seam: a namespaced key/value port. Real adapters bind
 * localStorage (web), the filesystem (desktop), and OS app storage (mobile);
 * the fixture implementation below is the deterministic in-memory stand-in
 * with a per-platform byte ceiling (the "reduced cache ceilings" of the
 * mobile profile are real, typed, and testable).
 */
export interface StoragePort {
  get(key: string): string | undefined;
  set(key: string, value: string): StorageWriteResult;
  remove(key: string): void;
  keys(): readonly string[];
}

/**
 * The deterministic in-memory `StoragePort` TEST FIXTURE. Byte accounting is
 * UTF-16 code units (`key.length + value.length` summed over live entries)
 * — a documented fixture convention, not a disk-format claim. Namespacing
 * isolates per-platform data inside one storage medium.
 */
export class FixtureStoragePort implements StoragePort {
  private readonly entries = new Map<string, string>();

  constructor(
    private readonly namespace: string,
    private readonly limitBytes: number,
  ) {
    const problems: string[] = [];
    if (typeof namespace !== "string" || namespace.length === 0) {
      problems.push(`namespace: expected a non-empty string, got ${previewValue(namespace)}`);
    }
    if (typeof limitBytes !== "number" || !Number.isFinite(limitBytes) || limitBytes <= 0) {
      problems.push(
        `limitBytes: expected a finite positive number, got ${previewValue(limitBytes)}`,
      );
    }
    if (problems.length > 0) throw new ExperienceError(problems);
  }

  get(key: string): string | undefined {
    this.assertKey(key, "get");
    return this.entries.get(this.scoped(key));
  }

  set(key: string, value: string): StorageWriteResult {
    this.assertKey(key, "set");
    if (typeof value !== "string") {
      throw new ExperienceError(
        `set.value: expected a string, got ${previewValue(value)}`,
      );
    }
    const scoped = this.scoped(key);
    const previous = this.entries.get(scoped);
    const previousBytes = previous === undefined ? 0 : previous.length;
    const requiredBytes = this.usedBytes() - previousBytes + value.length;
    if (requiredBytes > this.limitBytes) {
      return { ok: false, reason: "quota-exceeded", limitBytes: this.limitBytes, requiredBytes };
    }
    this.entries.set(scoped, value);
    return { ok: true, usedBytes: requiredBytes };
  }

  remove(key: string): void {
    this.assertKey(key, "remove");
    this.entries.delete(this.scoped(key));
  }

  keys(): readonly string[] {
    return [...this.entries.keys()].map((scoped) => scoped.slice(this.namespace.length));
  }

  /** Total bytes accounted under the namespace (fixture accounting convention). */
  usedBytes(): number {
    let total = 0;
    for (const [scoped, value] of this.entries) total += scoped.length + value.length;
    return total;
  }

  private scoped(key: string): string {
    return `${this.namespace}${key}`;
  }

  private assertKey(key: string, operation: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new ExperienceError(
        `${operation}.key: expected a non-empty string, got ${previewValue(key)}`,
      );
    }
  }
}

/** Web storage ceiling — the localStorage quota mirror (5 MiB). */
export const WEB_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;

/** Desktop storage ceiling — the filesystem-backed K/V fixture (64 MiB). */
export const DESKTOP_STORAGE_QUOTA_BYTES = 64 * 1024 * 1024;

/** Mobile storage ceiling — the REDUCED cache ceiling (2 MiB). */
export const MOBILE_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// LifecyclePort — the foreground/background event seam
// ---------------------------------------------------------------------------

/** The lifecycle events a platform host reports to the client. */
export type LifecycleEvent = "foreground" | "background";

/**
 * The platform lifecycle seam. Real adapters bind the visibility change
 * (web), window focus (desktop), and app lifecycle (mobile) events; the
 * fixture below is pumped manually by tests.
 */
export interface LifecyclePort {
  on(event: LifecycleEvent, listener: () => void): void;
}

/**
 * The deterministic `LifecyclePort` TEST FIXTURE: listeners fire ONLY when a
 * test pumps `emit`, in registration order; every emitted event is recorded.
 */
export class FixtureLifecyclePort implements LifecyclePort {
  private readonly listeners: Record<LifecycleEvent, (() => void)[]> = {
    foreground: [],
    background: [],
  };
  private readonly seen: LifecycleEvent[] = [];

  on(event: LifecycleEvent, listener: () => void): void {
    if (event !== "foreground" && event !== "background") {
      throw new ExperienceError(
        `on.event: expected 'foreground' or 'background', got ${previewValue(event)}`,
      );
    }
    if (typeof listener !== "function") {
      throw new ExperienceError(`on.listener: expected a function, got ${previewValue(listener)}`);
    }
    this.listeners[event].push(listener);
  }

  /** Pump one lifecycle event to its listeners (in registration order). */
  emit(event: LifecycleEvent): void {
    if (event !== "foreground" && event !== "background") {
      throw new ExperienceError(
        `emit.event: expected 'foreground' or 'background', got ${previewValue(event)}`,
      );
    }
    this.seen.push(event);
    for (const listener of [...this.listeners[event]]) listener();
  }

  /** Every emitted event, in order (fixture state for assertions). */
  recordedEvents(): readonly LifecycleEvent[] {
    return [...this.seen];
  }
}

// ---------------------------------------------------------------------------
// PlatformAdapter — the typed platform seam bundle
// ---------------------------------------------------------------------------

/**
 * The typed platform adapter: the per-platform translation of storage,
 * lifecycle, and browser-host facilities into shared contracts.
 *
 * - `storage` — the K/V port (always present; every platform persists).
 * - `lifecycle` — the foreground/background event port (always present).
 * - `browser` — REUSES the WFX-026 `BrowserHost` port (the contained
 *   in-app browser session seam). Typed-absent (`undefined`) on platforms
 *   without the facility: the WEB client renders provider surfaces in the
 *   host page itself and cannot honor the cookie-isolation contract of a
 *   contained session, so it honestly reports no contained browser host;
 *   desktop and mobile provide one (fixture instances here; real Tauri
 *   WebView / WKWebView / Android WebView adapters are post-MVP packaging).
 */
export interface PlatformAdapter {
  readonly storage: StoragePort;
  readonly lifecycle: LifecyclePort;
  readonly browser: BrowserHost | undefined;
}

/** The web adapter fixture: localStorage-quota storage, no contained browser host. */
export function createWebAdapter(): PlatformAdapter {
  return {
    storage: new FixtureStoragePort("wfx:web:", WEB_STORAGE_QUOTA_BYTES),
    lifecycle: new FixtureLifecyclePort(),
    browser: undefined,
  };
}

/** The desktop adapter fixture: fs-quota storage + a contained browser host. */
export function createDesktopAdapter(): PlatformAdapter {
  return {
    storage: new FixtureStoragePort("wfx:desktop:", DESKTOP_STORAGE_QUOTA_BYTES),
    lifecycle: new FixtureLifecyclePort(),
    browser: createFixtureBrowserHost(),
  };
}

/** The mobile adapter fixture: reduced-ceiling storage + a contained browser host. */
export function createMobileAdapter(): PlatformAdapter {
  return {
    storage: new FixtureStoragePort("wfx:mobile:", MOBILE_STORAGE_QUOTA_BYTES),
    lifecycle: new FixtureLifecyclePort(),
    browser: createFixtureBrowserHost(),
  };
}

// ---------------------------------------------------------------------------
// Platform capability profiles (frozen, pure data — safe to share)
// ---------------------------------------------------------------------------

/**
 * A platform's capability declaration: its identity, the
 * `DeviceCapabilities` it produces for the domain `canPlay` contract, and
 * its typed background policy. Pure data — the adapter is bound separately
 * ({@link PlatformProfile}) so every runtime gets FRESH fixture ports.
 */
export interface PlatformCapabilities<P extends PlatformId = PlatformId> {
  readonly platform: P;
  readonly device: Readonly<DeviceCapabilities>;
  readonly background: BackgroundPolicy;
}

/**
 * The WEB capability profile — browser-constrained (the frozen
 * cross-platform strategy): NO native media (the web client has no
 * WebFlix-controlled media path, so `native` is NOT declared — `canPlay`
 * answers false for it, honestly); embed/browser/external modes; the
 * storage seam is localStorage-backed (the device-level `storageBytes`
 * mirrors the WFX-002 MODERN_WEB estimate; the storage PORT ceiling mirrors
 * the localStorage quota).
 */
const webDevice: DeviceCapabilities = {
  playbackModes: ["embed", "browser", "external"],
  codecs: ["h264", "hevc", "vp9", "av1", "aac", "opus", "flac"],
  browser: true,
  backgroundPlayback: false,
  storageBytes: 2 * 1024 * 1024 * 1024,
  casting: true,
};

const webBackground: BackgroundPolicy = {
  kind: "never",
  reason:
    "browsers suspend background video playback — the web client never claims background completion",
};

export const WebCapabilities: Readonly<PlatformCapabilities<"web">> = Object.freeze({
  platform: "web",
  device: Object.freeze(webDevice),
  background: Object.freeze(webBackground),
});

/**
 * The DESKTOP capability profile — the REFERENCE full-power native client:
 * native mode available (the WebFlix-controlled media path, backed by the
 * native media engine port bound at runtime), all four playback modes,
 * background completion while unfocused, filesystem-backed storage, and a
 * contained in-app browser surface.
 *
 * Deliberate deviation, lead-visible: `casting: true` SUPERSEDES the WFX-002
 * `DESKTOP_NATIVE` fixture (`casting: false`) per this dispatch packet's
 * "casting-ready" requirement for the reference client — the desktop shell
 * class is modeled as able to hand playback to an external screen (the
 * adapter surface exposes the typed cast seam; a real implementation is
 * post-MVP packaging).
 */
const desktopDevice: DeviceCapabilities = {
  playbackModes: ["native", "embed", "browser", "external"],
  codecs: ["h264", "hevc", "vp9", "av1", "aac", "opus", "flac"],
  browser: true,
  backgroundPlayback: true,
  storageBytes: 100 * 1024 * 1024 * 1024,
  casting: true,
};

const desktopBackground: BackgroundPolicy = {
  kind: "always",
  reason:
    "the reference full-power desktop client keeps playing while unfocused (background completion)",
};

export const DesktopCapabilities: Readonly<PlatformCapabilities<"desktop">> = Object.freeze({
  platform: "desktop",
  device: Object.freeze(desktopDevice),
  background: Object.freeze(desktopBackground),
});

/**
 * The MOBILE capability profile — native media via OS platform facilities
 * (native mode declared; the OS player — not the desktop engine port —
 * backs it), OS-constrained background behavior (the static
 * `backgroundPlayback: false` is the CONSERVATIVE declaration; the typed
 * `os-constrained` policy — honoring cellular/charging inputs — is the
 * authoritative adaptive layer), and REDUCED cache ceilings (16 GiB device
 * storage, 2 MiB storage-port quota).
 *
 * Codec list mirrors the WFX-025 `mobile-restricted` fixture: no
 * HEVC/AV1/FLAC decode — native playback is declaration-possible yet
 * codec-gated per asset (the resolver's native gate).
 */
const mobileDevice: DeviceCapabilities = {
  playbackModes: ["native", "embed", "browser", "external"],
  codecs: ["h264", "vp9", "aac", "opus"],
  browser: true,
  backgroundPlayback: false,
  storageBytes: 16 * 1024 * 1024 * 1024,
  casting: true,
};

const mobileBackground: BackgroundPolicy = {
  kind: "os-constrained",
  constraints: {
    allowedNetworks: ["wifi"],
    requireCharging: true,
  },
};

export const MobileCapabilities: Readonly<PlatformCapabilities<"mobile">> = Object.freeze({
  platform: "mobile",
  device: Object.freeze(mobileDevice),
  background: Object.freeze(mobileBackground),
});

// ---------------------------------------------------------------------------
// Compile-time assertions (the ports.ts pattern — proof, not runtime checks)
// ---------------------------------------------------------------------------

/**
 * Compile-time proof that a profile's `device` satisfies the domain
 * `canPlay` parameter contract (`Readonly<DeviceCapabilities>`,
 * packages/domain/src/device.ts). If a profile ever drifts to a shape the
 * domain contract rejects, compiling this module fails.
 */
type AssertCanPlayCompatibleDevice<T extends Readonly<DeviceCapabilities>> = T;
type _WebCapabilitiesDeviceIsCanPlayCompatible =
  AssertCanPlayCompatibleDevice<(typeof WebCapabilities)["device"]>;
type _DesktopCapabilitiesDeviceIsCanPlayCompatible =
  AssertCanPlayCompatibleDevice<(typeof DesktopCapabilities)["device"]>;
type _MobileCapabilitiesDeviceIsCanPlayCompatible =
  AssertCanPlayCompatibleDevice<(typeof MobileCapabilities)["device"]>;

// ---------------------------------------------------------------------------
// PlatformProfile — capabilities bound to a fresh adapter
// ---------------------------------------------------------------------------

/** A platform's capabilities bound to its adapter: what `createClientRuntime` consumes. */
export interface PlatformProfile<P extends PlatformId = PlatformId>
  extends PlatformCapabilities<P> {
  readonly adapter: PlatformAdapter;
}

/** Bind the web capabilities to a FRESH web adapter (per-runtime isolation). */
export function createWebPlatform(): PlatformProfile<"web"> {
  return { ...WebCapabilities, adapter: createWebAdapter() };
}

/** Bind the desktop capabilities to a FRESH desktop adapter (per-runtime isolation). */
export function createDesktopPlatform(): PlatformProfile<"desktop"> {
  return { ...DesktopCapabilities, adapter: createDesktopAdapter() };
}

/** Bind the mobile capabilities to a FRESH mobile adapter (per-runtime isolation). */
export function createMobilePlatform(): PlatformProfile<"mobile"> {
  return { ...MobileCapabilities, adapter: createMobileAdapter() };
}

// ---------------------------------------------------------------------------
// Profile validation (caller misuse — typed throw, never a silent pass)
// ---------------------------------------------------------------------------

const PLATFORM_IDS: readonly string[] = ["web", "desktop", "mobile"];
const NETWORK_CLASSES: readonly string[] = ["wifi", "cellular", "offline"];
const BACKGROUND_KINDS: readonly string[] = ["never", "always", "os-constrained"];

function deviceProblems(device: unknown): string[] {
  if (!isRecord(device)) {
    return [`platform.device: expected a DeviceCapabilities object, got ${previewValue(device)}`];
  }
  const problems: string[] = [];
  if (
    !Array.isArray(device.playbackModes) ||
    !device.playbackModes.every(
      (mode) => typeof mode === "string" && (PLAYBACK_MODES as readonly string[]).includes(mode),
    )
  ) {
    problems.push(
      `platform.device.playbackModes: expected an array of PlaybackMode values (${PLAYBACK_MODES.join(" | ")}), got ${previewValue(device.playbackModes)}`,
    );
  }
  if (
    !Array.isArray(device.codecs) ||
    !device.codecs.every((codec) => typeof codec === "string" && codec.length > 0)
  ) {
    problems.push(
      `platform.device.codecs: expected an array of non-empty codec strings, got ${previewValue(device.codecs)}`,
    );
  }
  for (const flag of ["browser", "backgroundPlayback", "casting"] as const) {
    if (typeof device[flag] !== "boolean") {
      problems.push(
        `platform.device.${flag}: expected a boolean, got ${previewValue(device[flag])}`,
      );
    }
  }
  if (
    device.storageBytes !== undefined &&
    (typeof device.storageBytes !== "number" ||
      !Number.isFinite(device.storageBytes) ||
      device.storageBytes < 0)
  ) {
    problems.push(
      `platform.device.storageBytes: expected a finite non-negative number when present, got ${previewValue(device.storageBytes)}`,
    );
  }
  return problems;
}

function backgroundProblems(background: unknown): string[] {
  if (!isRecord(background)) {
    return [`platform.background: expected a BackgroundPolicy object, got ${previewValue(background)}`];
  }
  const problems: string[] = [];
  if (
    typeof background.kind !== "string" ||
    !BACKGROUND_KINDS.includes(background.kind)
  ) {
    problems.push(
      `platform.background.kind: expected one of ${BACKGROUND_KINDS.join(" | ")}, got ${previewValue(background.kind)}`,
    );
    return problems;
  }
  if (background.kind === "os-constrained") {
    const constraints = background.constraints;
    if (!isRecord(constraints)) {
      problems.push(
        `platform.background.constraints: expected a MobileBackgroundConstraints object, got ${previewValue(constraints)}`,
      );
    } else {
      if (
        !Array.isArray(constraints.allowedNetworks) ||
        constraints.allowedNetworks.length === 0 ||
        !constraints.allowedNetworks.every(
          (entry) => typeof entry === "string" && NETWORK_CLASSES.includes(entry),
        )
      ) {
        problems.push(
          `platform.background.constraints.allowedNetworks: expected a non-empty array of NetworkClass values (${NETWORK_CLASSES.join(" | ")}), got ${previewValue(constraints.allowedNetworks)}`,
        );
      }
      if (typeof constraints.requireCharging !== "boolean") {
        problems.push(
          `platform.background.constraints.requireCharging: expected a boolean, got ${previewValue(constraints.requireCharging)}`,
        );
      }
    }
  } else if (typeof background.reason !== "string" || background.reason.length === 0) {
    problems.push(
      `platform.background.reason: expected a non-empty string for '${String(background.kind)}' policies, got ${previewValue(background.reason)}`,
    );
  }
  return problems;
}

function adapterProblems(adapter: unknown): string[] {
  if (!isRecord(adapter)) {
    return [`platform.adapter: expected a PlatformAdapter object, got ${previewValue(adapter)}`];
  }
  const problems: string[] = [];
  const storage = adapter.storage;
  if (
    !isRecord(storage) ||
    typeof storage.get !== "function" ||
    typeof storage.set !== "function" ||
    typeof storage.remove !== "function" ||
    typeof storage.keys !== "function"
  ) {
    problems.push(`platform.adapter.storage: expected a StoragePort object`);
  }
  const lifecycle = adapter.lifecycle;
  if (!isRecord(lifecycle) || typeof lifecycle.on !== "function") {
    problems.push(`platform.adapter.lifecycle: expected a LifecyclePort object`);
  }
  const browser = adapter.browser;
  if (
    browser !== undefined &&
    (!isRecord(browser) ||
      typeof browser.open !== "function" ||
      typeof browser.close !== "function" ||
      typeof browser.onNavigation !== "function")
  ) {
    problems.push(`platform.adapter.browser: expected a BrowserHost object or undefined`);
  }
  return problems;
}

/**
 * Validate a caller-supplied platform profile (the misuse channel). Throws
 * the typed `ExperienceError` with EVERY collected problem when malformed.
 */
export function assertValidPlatformProfile(platform: PlatformProfile): void {
  if (!isRecord(platform)) {
    throw new ExperienceError("platform: expected a PlatformProfile object");
  }
  const problems: string[] = [];
  if (typeof platform.platform !== "string" || !PLATFORM_IDS.includes(platform.platform)) {
    problems.push(
      `platform.platform: expected one of ${PLATFORM_IDS.join(" | ")}, got ${previewValue(platform.platform)}`,
    );
  }
  problems.push(...deviceProblems(platform.device));
  problems.push(...backgroundProblems(platform.background));
  problems.push(...adapterProblems(platform.adapter));
  if (problems.length > 0) throw new ExperienceError(problems);
}
