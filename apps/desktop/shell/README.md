# The WebFlix Desktop Native Shell (R08)

The Tauri v2 host that makes `apps/desktop` a REAL native adapter: the
window lifecycle, the filesystem storage areas, the contained webview
surfaces, OS notifications, the background task registry, the OS share
sheet seam, and the native-media engine process host — every capability
the frozen remediation architecture assigns to the Desktop adapter,
behind ONE typed IPC seam (`ShellIpc`, defined in
`../src/platform/shell-ipc.ts` and mirrored by `src/ipc.rs` here).

```
Experience Core -> Shared Client Runtime -> Platform Adapter (src/)
                                                       |
                                                 ShellIpc (typed DTOs)
                                                       |
                                              THIS shell (Rust host)
                                                       |
     window events / app-data fs / webview surfaces / OS notifications /
     task registry / share sheet / engine child process (R10's binary)
```

## Layout

```text
shell/
  tauri.conf.json          the Tauri v2 app config (window, CSP, tray, sidecar)
  README.md                this file
  src-tauri/
    Cargo.toml             the Rust crate (tauri 2 + notification plugin + fs2)
    build.rs               tauri-build
    src/
      main.rs              the process entry
      lib.rs               the command registration (wfx_* surface) + tray
      ipc.rs               the typed DTOs (the Rust half of ShellIpc)
      lifecycle.rs         window events -> ready/background/resume/shutdown
                           (the BOUNDED close-requested drain)
      storage.rs           filesystem kv/blob areas (atomic writes, disk-truth quota)
      browser_host.rs      isolated webview surface sessions (cookie isolation)
      notifications.rs     the OS notification channel (permission-gated)
      background.rs        the truthful task registry (full background work)
      sharing.rs           the OS share sheet (macOS picker; honest unsupported elsewhere)
      engine.rs            the engine process host (stdio JSON-lines relay)
      file_import.rs       the BYOF import file picker + read-root law (R20-F)
```

## The IPC surface (command-for-command)

| `ShellIpc` (TS)              | Tauri command              | Rust module        |
|------------------------------|----------------------------|--------------------|
| `info`                       | `wfx_shell_info`           | `lib.rs`           |
| `lifecycleShutdownComplete`  | `wfx_lifecycle_shutdown_done` | `lifecycle.rs`  |
| `kvGet`/`kvSet`/`kvRemove`/`kvKeys` | `wfx_storage_kv_*`  | `storage.rs`       |
| `blobPut`/`blobGet`/`blobRemove`/`storageQuota` | `wfx_storage_blob_*` / `wfx_storage_quota` | `storage.rs` |
| `surfaceOpen`/`surfaceNavigate`/`surfaceClose` | `wfx_surface_*` | `browser_host.rs` |
| `notificationPermission`/`notificationRequestPermission`/`notificationShow` | `wfx_notify_*` | `notifications.rs` |
| `taskSchedule`/`taskCancel`/`taskStatus`/`taskList` | `wfx_task_*` | `background.rs` |
| `taskReport` | `wfx_task_report` | `background.rs` (the executor report seam, R20-F) |
| `filePickAvailable`/`filePickOpen`/`fileRead` | `wfx_file_pick_available`/`wfx_file_pick_open`/`wfx_file_read` | `file_import.rs` (R20-F) |
| `shareCanPresent`/`sharePresent` | `wfx_share_*`          | `sharing.rs`       |
| `engineSpawn`/`engineSend`/`onEngineEvent`/`engineTerminate` | `wfx_engine_*` + `wfx://engine/<id>` events | `engine.rs` |

Event channels: `wfx://lifecycle`, `wfx://surface`, `wfx://task`,
`wfx://engine/<id>`. Every fallible command answers the typed
`ShellError` (`{ name: "ShellIpcError", code, detail }`) that the
adapter's ports re-map onto the frozen platform-contracts taxonomies.

## Build procedure

Prerequisites: Rust 1.77+ (`rustup`), the platform webview dependencies
(Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev`;
macOS: Xcode CLT; Windows: WebView2 + MSVC), Node/Bun for the frontend
bundle, and the `tauri-cli`:

```bash
# 1. Build the frontend bundle the shell loads (the adapter + UI).
#    The webview entry loads window.__TAURI__ (withGlobalTauri: true) and
#    boots the adapter through createTauriShellIpc() — no npm dependency.
cd apps/desktop && bun install && bun run bundle   # produces ../dist

# 2. Provide the native-media engine binary (R10's deliverable) as the
#    sidecar; for development, point WFX_ENGINE_PATH at any build:
export WFX_ENGINE_PATH=/path/to/wfx-native-media-engine

# 3. Build/run the shell (dev mode, with the engine sidecar unresolved
#    it fails honestly at spawn time — the typed INTERNAL error):
cd apps/desktop/shell
cargo install tauri-cli --version '^2'
cargo tauri dev

# 4. Release bundle (dmg / msi / deb / appimage per platform):
cargo tauri build
```

Environment knobs the shell honors:

| Variable                   | Meaning                                     | Default     |
|----------------------------|---------------------------------------------|-------------|
| `WFX_API_BASE`             | the Experience API base URL (the adapter's ServerPort) | required in production |
| `WFX_ENGINE_PATH`          | the engine binary override (dev)            | the bundled sidecar |
| `WFX_ENGINE_TIMEOUT_MS`    | the engine wire-command deadline            | 30 000      |
| `WFX_SHUTDOWN_TIMEOUT_MS`  | the bounded shutdown-drain budget           | 5 000       |

## Honest build status (this delivery)

**This sandbox has NO Rust toolchain** (`cargo`/`rustc` are absent), so
the native shell was **source-delivered, not compile-verified** — the
same honest scoping the R08 spec anticipates ("If Tauri itself cannot
build in your sandbox, deliver the FULL shell source + config + a build
procedure, and prove the TypeScript side against a shell-simulator
double in tests"). What IS proven, deterministically, in this repo's
gates:

- The **TypeScript side of the adapter** — every port, the engine
  binding (the R10 seam), the boot truth-check, and the runtime
  integration — is tested against the in-process shell simulator
  (`apps/desktop/tests/shell-simulator.ts`), which implements the exact
  `ShellIpc` contract, DTO-for-DTO, with the engine side speaking the
  frozen WFX-014 wire protocol through JSON round-trips and the runtime
  guards.
- The **command/event naming law** is fixed on both sides
  (`tauri-shell-ipc.ts` ⇔ `lib.rs`) and documented in the table above.

What the lead verifies with the real toolchain at **R19 acceptance**:

1. `cargo tauri build` compiles the shell on each target platform;
2. the window lifecycle bridge behaves per the frozen vocabulary
   (ready/background/resume/shutdown with the bounded drain — note
   OS-minimize EVENT detection is platform-specific in Tauri and is an
   R19 item; the R08 triggers are page-load, tray hide/show, and close);
3. the webview surface isolation holds per-session (the
   `data_directory` per surface session — cookie/storage separation);
4. the engine sidecar spawn/stdio relay runs the R10 service binary;
5. the macOS share sheet presents (and the Windows/Linux honest
   `unsupported` answers render through `canShare` as designed).

## The engine process host (the R10 seam's native side)

`engine.rs` spawns the engine binary with the spawn config's cache dir
and byte budget, relays newline-delimited JSON `EngineCommand`s in and
`EngineEvent`s out (stdout), enforces the wire deadline
(`ENGINE_TIMEOUT` on silence), and pushes every spontaneous event to
`wfx://engine/<id>`. It adds NO protocol logic: the adapter's binding
(`../src/platform/native-media-binding.ts`) owns the port semantics —
session mapping, the integrity law, the crash law — on top of the frozen
DTOs. R10 plugs the real service binary into this host; R12 binds the
byte→piece deadline mapper; R10's range gateway binds the
`rangeAccess` channel (both documented in the adapter README).
