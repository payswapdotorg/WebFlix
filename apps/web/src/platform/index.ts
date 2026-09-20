/**
 * @wfx/app-web — the Web PLATFORM ADAPTER surface (R07).
 *
 * The platform bundle this app constructs and hands to the shared client
 * runtime (`@wfx/client-runtime` `createRuntime`): the truthful Web
 * capability bundle and its ports, plus the ServerPort implementation over
 * the frozen `WFX_API_BASE` transport. The adapter contains NO product
 * business logic — it constructs the platform bundle and (in the app
 * layer) renders runtime state.
 *
 * Layering law (frozen):
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> Web
 *
 * Public surface (import from the app's `@/platform` alias — the lane
 * checker forbids cross-PACKAGE deep imports; within this app the alias is
 * the one blessed path):
 * - `environment.ts`     — the browser-facility seam (injectable, honest)
 * - `capabilities.ts`    — `createWebPlatformCapabilities` (the bundle)
 * - `lifecycle.ts`       — the Web LifecyclePort
 * - `storage.ts`         — the Web StoragePort (quota-honest)
 * - `browser-host.ts`    — the contained browser surface (sandboxed)
 * - `notifications.ts`   — the permission-gated notification port
 * - `background-work.ts` — the honest backgroundWork: "none" law
 * - `sharing.ts`         — the Web Share API port
 * - `server-port.ts`     — the R01 ServerPort over the frozen transport
 */

export * from "./environment";
export * from "./capabilities";
export * from "./lifecycle";
export * from "./storage";
export * from "./browser-host";
export * from "./notifications";
export * from "./background-work";
export * from "./sharing";
export * from "./server-port";
export * from "./browser-torrent";
