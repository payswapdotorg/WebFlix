// @wfx/app-desktop — the Desktop platform adapter (R08, remediation freeze).
//
// A REAL native adapter over the R01 shared client runtime: the Tauri-style
// shell (apps/desktop/shell), the truthful Desktop capability bundle, and
// the native-media service binding seam (R10). Production paths contain no
// fixtures and no stubEngine() — the engine process is spawned/attached
// through the native shell.
//
// Public surface (import ONLY from "@wfx/app-desktop"):
// - `main.ts`                    — `createDesktopApp` (the composition root)
//                                  + the boot options/types
// - `platform/shell-ipc.ts`      — `ShellIpc` (the native seam contract),
//                                  `ShellIpcError`, shell DTOs
// - `platform/tauri-shell-ipc.ts`— `createTauriShellIpc` (production seam)
// - `platform/capabilities.ts`   — the truthful Desktop bundle + descriptors
// - `platform/lifecycle.ts`      — `LifecyclePort` over native window events
// - `platform/storage.ts`        — `StoragePort` over the app-data filesystem
// - `platform/browser-host.ts`   — `BrowserHostPort` over isolated webviews
//                                  (R09: + the session registry + the honest
//                                  capability truth; the embed rung's mount)
// - `platform/notifications.ts`  — `NotificationPort` over OS notifications
// - `platform/background-work.ts`— `BackgroundWorkPort` over the task registry
// - `platform/sharing.ts`        — `SharingPort` over the OS share sheet
// - `platform/server-port.ts`    — `ServerPort` over the frozen WFX_API_BASE
//                                  HTTP transport (typed failures)
// - `platform/native-media-binding.ts` — THE R10 SEAM: `NativeMediaPort`
//                                  over the spawned engine process
// - `platform/shell-engine-process.ts` — the shell-backed engine transport
// - `platform/media-surface.ts`  — R09: `createDesktopSurfaceResolver` —
//                                  the frozen resolver wired to the truthful
//                                  Desktop device derivation (the seam the
//                                  runtime's playback resolution consumes)
// - `platform/feed-import.ts`    — R20-F: the BYOF native file-import
//                                  binding (dialog → read → shared FeedPort)
// - `platform/feed-sync.ts`      — R20-F: the BYOF background feed-sync
//                                  executor over the task registry
// - `platform/feed-cache.ts`     — R20-G: the BYOF feed presentation cache
//                                  over the filesystem KV area
// - `surface/desktop-surface.ts` — the thin runtime-state UI projection
// - `surface/feed-surface.ts`    — R20-G: the Desktop BYOF feed surface
//                                  (mode truth, freshness, provenance)

export * from "./main";
export * from "./platform/shell-ipc";
export * from "./platform/tauri-shell-ipc";
export * from "./platform/capabilities";
export * from "./platform/lifecycle";
export * from "./platform/storage";
export * from "./platform/browser-host";
export * from "./platform/notifications";
export * from "./platform/background-work";
export * from "./platform/sharing";
export * from "./platform/server-port";
export * from "./platform/native-media-binding";
export * from "./platform/shell-engine-process";
export * from "./platform/media-surface";
export * from "./platform/feed-import";
export * from "./platform/feed-sync";
export * from "./platform/feed-cache";
export * from "./surface/desktop-surface";
export * from "./surface/feed-surface";
export * from "./surface/first-run-surface";
export * from "./platform/auth-transport";
export * from "./platform/auth-session-store";
export * from "./platform/source-connect-flow";
export * from "./surface/model-management-surface";export * from "./surface/r27-parity-tokens";
export * from "./surface/r27-parity-css";
export * from "./surface/r27-card-grammar";
export * from "./surface/r27-surface-grammar";
export * from "./surface/r27-chrome-surface";
