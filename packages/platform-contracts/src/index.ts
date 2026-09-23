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
 * - `capability-availability.ts` — `ServedCapabilityKind`,
 *                          `CapabilityServingTruth`,
 *                          `CapabilityAvailabilityReport` (R26-W1: the live
 *                          transport's served/not-served truth per capability
 *                          — the production capability-truth law)
 * - `parity-tokens.ts`     — R27-W1: THE parity token contract — the corpus
 *                          sheet (docs/parity-lab/reference/) as the ONE
 *                          canonical machine-readable shared encoding:
 *                          `PARITY_TOKENS` (colors, dark + light), the
 *                          `PARITY_TYPE_SCALE` Roboto ladder, `PARITY_GEOMETRY`,
 *                          `PARITY_MOTION`, the player-chrome control +
 *                          keyboard grammar, the `--wfx-*` css-name mapping
 *                          (`parityTokenMappingTable`), resolvers, and the
 *                          JSON serialization (`paritySheetJson`)
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
export * from "./capability-availability";
export * from "./parity-tokens";
