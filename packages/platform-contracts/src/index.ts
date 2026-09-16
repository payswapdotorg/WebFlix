/**
 * @wfx/platform-contracts — public entry (R01, remediation freeze).
 *
 * The adapter-side capability ports of the frozen remediation layering law.
 * PURE TypeScript: zero package dependencies, no React, no Node/browser
 * APIs. Adapters (Web R07 / Desktop R08 / future Mobile) implement these
 * ports; the shared client runtime (`@wfx/client-runtime`) consumes them.
 *
 * Public surface (import ONLY from "@wfx/platform-contracts" — the lane
 * checker forbids deep paths):
 * - `common.ts`          — `Unsubscribe`
 * - `lifecycle.ts`       — `LifecyclePort` + phases/events/hooks
 * - `storage.ts`         — `StoragePort` + `StorageError` + quota types
 * - `browser-host.ts`    — `BrowserHostPort` (contained surface + security boundary)
 * - `native-media.ts`    — `NativeMediaPort` (INTERFACE ONLY; R10 owns the service)
 * - `notifications.ts`   — `NotificationPort`
 * - `background-work.ts` — `BackgroundWorkPort`
 * - `sharing.ts`         — `SharingPort`
 * - `capabilities.ts`    — `PlatformCapabilities`, `CapabilityDescriptor`,
 *                          `checkCapabilityTruth` (the truth law), helpers
 */

export * from "./common";
export * from "./lifecycle";
export * from "./storage";
export * from "./browser-host";
export * from "./native-media";
export * from "./notifications";
export * from "./background-work";
export * from "./sharing";
export * from "./capabilities";
