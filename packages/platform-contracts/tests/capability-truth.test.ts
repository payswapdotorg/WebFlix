/**
 * @wfx/platform-contracts — the capability truth law tests (R01).
 *
 * The truth law: declared capability levels and provided ports must agree.
 * These tests build coherent and deliberately-incoherent bundles and prove
 * `checkCapabilityTruth` reports exactly the right issues (the runtime
 * rejects incoherent bundles at construction — never boots on a lying
 * adapter).
 */

import { describe, expect, it } from "bun:test";

import {
  BROWSER_HOST_KINDS,
  BACKGROUND_WORK_KINDS,
  BROWSER_SURFACE_ERROR_CODES,
  CAPABILITY_AREAS,
  LIFECYCLE_EVENT_KINDS,
  LIFECYCLE_PHASES,
  NATIVE_MEDIA_ERROR_CODES,
  NATIVE_MEDIA_INTEGRITIES,
  NATIVE_MEDIA_KINDS,
  NATIVE_MEDIA_SESSION_STATES,
  PLATFORM_KINDS,
  STORAGE_ERROR_CODES,
  STORAGE_KINDS,
  BACKGROUND_TASK_KINDS,
  BACKGROUND_TASK_STATES,
  checkCapabilityTruth,
  supportsBrowserHost,
  supportsNativeMedia,
  supportsTorrentAcquisition,
  type LifecyclePort,
  type PlatformCapabilities,
  type PlatformCapabilityPorts,
  type StoragePort,
} from "../src/index";

/** A minimal coherent lifecycle double. */
const lifecycle: LifecyclePort = {
  phase: () => "active",
  subscribe: () => () => undefined,
  hook: () => () => undefined,
};

/** A minimal storage double. */
const storage: StoragePort = {
  get: async () => null,
  set: async () => undefined,
  remove: async () => undefined,
  keys: async () => [],
  putBlob: async () => undefined,
  getBlob: async () => null,
  removeBlob: async () => undefined,
  quota: async () => ({ usageBytes: 0, quotaBytes: 1024 }),
};

/** Build a coherent bundle with per-area overrides (levels + ports together). */
function makeBundle(overrides: {
  browserHost?: "none" | "contained";
  nativeMedia?: "none" | "local" | "native-service";
  backgroundWork?: "none" | "limited" | "full";
  sharing?: boolean;
  notifications?: boolean;
} = {}): PlatformCapabilities & { ports: PlatformCapabilityPorts } {
  const browserHost = overrides.browserHost ?? "none";
  const nativeMedia = overrides.nativeMedia ?? "none";
  const backgroundWork = overrides.backgroundWork ?? "none";
  const sharing = overrides.sharing ?? false;
  const notifications = overrides.notifications ?? false;
  const ports: PlatformCapabilityPorts = {
    lifecycle,
    storage,
    browserHost:
      browserHost === "contained"
        ? ({
            open: async () => {
              throw new Error("unused");
            },
          } as never)
        : null,
    nativeMedia:
      nativeMedia !== "none"
        ? ({
            open: async () => {
              throw new Error("unused");
            },
          } as never)
        : null,
    notifications: notifications
      ? ({
          permission: async () => ({ granted: false, canRequest: false }),
          requestPermission: async () => ({ granted: false, canRequest: false }),
          notify: async () => ({ delivered: false, reason: "unavailable", detail: "unused" }),
        } as never)
      : null,
    backgroundWork:
      backgroundWork !== "none"
        ? ({
            schedule: async () => ({ accepted: false, reason: "invalid-task", detail: "unused" }),
            cancel: async () => false,
            status: async () => null,
            list: async () => [],
            subscribe: () => () => undefined,
          } as never)
        : null,
    sharing: sharing
      ? ({
          canShare: async () => false,
          share: async () => ({ outcome: "failed", detail: "unused" }),
        } as never)
      : null,
  };
  return {
    platform: "web",
    storage: "browser",
    browserHost,
    nativeMedia,
    backgroundWork,
    sharing,
    notifications,
    descriptor: { platform: "web", adapterId: "test-adapter", adapterVersion: "0.0.0" },
    ports,
  };
}

describe("capability truth law (checkCapabilityTruth)", () => {
  it("accepts a coherent minimal web bundle (everything optional absent)", () => {
    expect(checkCapabilityTruth(makeBundle())).toEqual([]);
  });

  it("accepts the coherent full-desktop bundle (every capability present)", () => {
    const bundle = makeBundle({
      browserHost: "contained",
      nativeMedia: "native-service",
      backgroundWork: "full",
      sharing: true,
      notifications: true,
    });
    expect(checkCapabilityTruth(bundle)).toEqual([]);
  });

  it("reports a declared-contained browserHost with no port", () => {
    const bundle = makeBundle({ browserHost: "contained" });
    // Sabotage: declare contained but remove the port.
    const lying = { ...bundle, ports: { ...bundle.ports, browserHost: null } };
    const issues = checkCapabilityTruth(lying as PlatformCapabilities);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.area).toBe("browserHost");
    expect(issues[0]?.detail).toContain('declared "contained" but no BrowserHostPort');
  });

  it("reports a provided browserHostPort with a 'none' declaration", () => {
    const bundle = makeBundle({ browserHost: "contained" });
    const underDeclarer = {
      ...bundle,
      browserHost: "none" as const,
    };
    const issues = checkCapabilityTruth(underDeclarer);
    expect(issues.some((issue) => issue.area === "browserHost" && issue.detail.includes("a BrowserHostPort is provided"))).toBe(true);
  });

  it("reports nativeMedia declared non-none with no port", () => {
    const bundle = makeBundle({ nativeMedia: "native-service" });
    const lying = { ...bundle, ports: { ...bundle.ports, nativeMedia: null } };
    const issues = checkCapabilityTruth(lying as PlatformCapabilities);
    expect(issues.some((issue) => issue.area === "nativeMedia" && issue.detail.includes("no NativeMediaPort is provided"))).toBe(true);
  });

  it("reports backgroundWork/sharing/notifications mismatches together (every rule)", () => {
    const bundle = makeBundle({
      backgroundWork: "full",
      sharing: true,
      notifications: true,
    });
    const lying = {
      ...bundle,
      ports: { ...bundle.ports, backgroundWork: null, sharing: null, notifications: null },
    };
    const issues = checkCapabilityTruth(lying as PlatformCapabilities);
    const areas = issues.map((issue) => issue.area);
    expect(areas).toContain("backgroundWork");
    expect(areas).toContain("sharing");
    expect(areas).toContain("notifications");
  });

  it("reports a descriptor platform mismatch", () => {
    const bundle = makeBundle();
    const mismatched = {
      ...bundle,
      descriptor: { ...bundle.descriptor, platform: "desktop" as const },
    };
    const issues = checkCapabilityTruth(mismatched);
    expect(issues.some((issue) => issue.detail.includes("descriptor.platform"))).toBe(true);
  });

  it("reports a missing lifecycle/storage port (unconditional requirements)", () => {
    const bundle = makeBundle();
    const noLifecycle = { ...bundle, ports: { ...bundle.ports, lifecycle: null as never } };
    expect(
      checkCapabilityTruth(noLifecycle as unknown as PlatformCapabilities).some((issue) =>
        issue.detail.includes("ports.lifecycle"),
      ),
    ).toBe(true);
    const noStorage = { ...bundle, ports: { ...bundle.ports, storage: null as never } };
    expect(
      checkCapabilityTruth(noStorage as unknown as PlatformCapabilities).some((issue) =>
        issue.detail.includes("ports.storage"),
      ),
    ).toBe(true);
  });

  it("rejects an unknown platform kind wholesale", () => {
    const issues = checkCapabilityTruth({ platform: "toaster" } as unknown as PlatformCapabilities);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toContain("platform: expected one of");
  });
});

describe("capability helpers (the platform truth table)", () => {
  it("web truthfully cannot torrent-acquire; desktop can", () => {
    const web = makeBundle(); // nativeMedia none, backgroundWork none
    expect(supportsTorrentAcquisition(web)).toBe(false);
    const desktop = makeBundle({ nativeMedia: "native-service", backgroundWork: "full" });
    expect(supportsTorrentAcquisition(desktop)).toBe(true);
    // local-only native media without a service cannot torrent-acquire
    const localOnly = makeBundle({ nativeMedia: "local", backgroundWork: "full" });
    expect(supportsTorrentAcquisition(localOnly)).toBe(false);
  });

  it("supportsBrowserHost/supportsNativeMedia require BOTH declaration and port", () => {
    const bundle = makeBundle({ browserHost: "contained", nativeMedia: "local" });
    expect(supportsBrowserHost(bundle)).toBe(true);
    expect(supportsNativeMedia(bundle)).toBe(true);
    const noPorts = { ...bundle, ports: { ...bundle.ports, browserHost: null, nativeMedia: null } };
    expect(supportsBrowserHost(noPorts)).toBe(false);
    expect(supportsNativeMedia(noPorts)).toBe(false);
  });
});

describe("closed vocabularies (frozen contract mirrors)", () => {
  it("exports the frozen vocabulary sets verbatim", () => {
    expect(PLATFORM_KINDS).toEqual(["web", "desktop", "mobile"]);
    expect(STORAGE_KINDS).toEqual(["browser", "filesystem", "os-managed"]);
    expect(BROWSER_HOST_KINDS).toEqual(["none", "contained"]);
    expect(NATIVE_MEDIA_KINDS).toEqual(["none", "local", "native-service"]);
    expect(BACKGROUND_WORK_KINDS).toEqual(["none", "limited", "full"]);
    expect(LIFECYCLE_PHASES).toEqual(["initializing", "active", "background", "shutdown"]);
    expect(LIFECYCLE_EVENT_KINDS).toEqual(["ready", "background", "resume", "shutdown"]);
    expect(NATIVE_MEDIA_SESSION_STATES).toEqual([
      "resolving",
      "buffering",
      "playing",
      "background",
      "complete",
      "failed",
    ]);
    expect(NATIVE_MEDIA_INTEGRITIES).toEqual(["unknown", "verified", "failed"]);
    expect(NATIVE_MEDIA_ERROR_CODES).toEqual([
      "unavailable",
      "invalid-input",
      "corrupt",
      "deadline-missed",
      "unknown-session",
    ]);
    expect(STORAGE_ERROR_CODES).toEqual(["unavailable", "quota-exceeded", "invalid-key", "io", "corrupt"]);
    expect(BROWSER_SURFACE_ERROR_CODES).toEqual(["unavailable", "invalid-url", "blocked", "invalid-session"]);
    expect(BACKGROUND_TASK_KINDS).toEqual(["acquisition", "sync", "maintenance"]);
    expect(BACKGROUND_TASK_STATES).toEqual([
      "scheduled",
      "running",
      "suspended",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(CAPABILITY_AREAS).toEqual([
      "storage",
      "browserHost",
      "nativeMedia",
      "backgroundWork",
      "notifications",
      "sharing",
    ]);
  });
});
