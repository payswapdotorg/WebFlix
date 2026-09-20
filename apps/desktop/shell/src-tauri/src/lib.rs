//! The WebFlix Desktop native shell (R08) — the lib entry that registers
//! the full `ShellIpc` command surface the adapter consumes.
//!
//! Command naming law: `wfx_<area>_<operation>` — the exact surface
//! `apps/desktop/src/platform/tauri-shell-ipc.ts` invokes; event channels
//! are `wfx://lifecycle`, `wfx://surface`, `wfx://task`, and
//! `wfx://engine/<id>`. EVERY fallible command returns the typed
//! `ShellError` payload the adapter's `ShellIpcError` normalizes.
//!
//! Lifecycle triggers (documented, honest):
//! - `ready` — the main webview finished loading (on_page_load).
//! - `shutdown` — the main window's close was requested: prevented,
//!   emitted, and the bounded adapter drain begins.
//! - `background` / `resume` — the main window hidden / shown through
//!   the tray toggle (the process stays alive — the full background-work
//!   truth). OS-minimize EVENT detection is platform-specific in Tauri
//!   and is an R19 verification item; focus loss alone is deliberately
//!   NOT background (the frozen vocabulary reserves it for hidden/
//!   minimized surfaces).

use std::sync::Arc;

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

mod background;
mod browser_host;
mod engine;
mod file_import;
mod ipc;
mod lifecycle;
mod notifications;
mod sharing;
mod storage;

use background::Tasks;
use browser_host::Surfaces;
use engine::Engines;
use file_import::FileImports;
use ipc::*;
use lifecycle::Lifecycle;
use storage::Storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let app_data_dir = handle
                .path()
                .app_data_dir()
                .expect("the OS app-data dir could not be resolved");

            app.manage(Storage::new(&app_data_dir).expect("the storage areas could not be created"));
            app.manage(Surfaces::new(app_data_dir.clone()));
            app.manage(Tasks::new());
            app.manage(FileImports::new());
            app.manage(Arc::new(Engines::new()));
            app.manage(Lifecycle::new());

            // The tray: keeps the process alive while the window is hidden
            // (the Desktop full-background-work truth). Clicking it toggles
            // the window and emits background/resume honestly.
            let tray_handle = handle.clone();
            let tray = tauri::tray::TrayIconBuilder::with_id("wfx-tray")
                .tooltip("WebFlix")
                .icon(app.default_window_icon().cloned().expect("the app icon is missing"))
                .on_tray_icon_event(move |tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle().clone();
                        let shown = toggle_main_window(&app);
                        if shown {
                            Lifecycle::emit_resume(&app);
                        } else {
                            Lifecycle::emit_background(&app);
                        }
                        let _ = tray_handle;
                    }
                })
                .build(app)?;
            let _ = tray;

            Ok(())
        })
        .on_page_load(|app, payload| {
            // The frontend (the adapter bundle) finished loading: ready.
            if payload.url().contains("index.html") {
                Lifecycle::emit_ready(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            wfx_shell_info,
            wfx_lifecycle_shutdown_done,
            wfx_storage_kv_get,
            wfx_storage_kv_set,
            wfx_storage_kv_remove,
            wfx_storage_kv_keys,
            wfx_storage_blob_put,
            wfx_storage_blob_get,
            wfx_storage_blob_remove,
            wfx_storage_quota,
            wfx_surface_open,
            wfx_surface_navigate,
            wfx_surface_close,
            wfx_notify_permission,
            wfx_notify_request_permission,
            wfx_notify_show,
            wfx_task_schedule,
            wfx_task_cancel,
            wfx_task_status,
            wfx_task_list,
            wfx_task_report,
            wfx_file_pick_available,
            wfx_file_pick_open,
            wfx_file_read,
            wfx_share_can_present,
            wfx_share_present,
            wfx_engine_spawn,
            wfx_engine_send,
            wfx_engine_terminate,
        ])
        .build(tauri::generate_context!())
        .expect("the WebFlix desktop shell failed to build")
        .run(|app, event| {
            if let RunEvent::WindowEvent { label, event, .. } = event {
                if label == "wfx-main" {
                    Lifecycle::on_window_event(app, &event);
                } else if label.starts_with("wfx-surface-") {
                    if let WindowEvent::Destroyed = event {
                        browser_host::Surfaces::on_surface_window_destroyed(app, label);
                    }
                }
            }
        });
}

/// Toggle the main window's visibility; answers whether it is now shown.
fn toggle_main_window(app: &AppHandle) -> bool {
    match app.get_webview_window("wfx-main") {
        Some(window) => match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
                false
            }
            _ => {
                let _ = window.show();
                let _ = window.set_focus();
                true
            }
        },
        None => false,
    }
}

// — shell + lifecycle ————————————————————————————————————————————————————

#[tauri::command]
fn wfx_shell_info(app: AppHandle) -> CommandResult<ShellInfo> {
    let lifecycle = app.state::<Lifecycle>();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(ShellInfo {
        shell_id: "wfx-desktop-shell",
        shell_version: env!("CARGO_PKG_VERSION"),
        shutdown_timeout_ms: lifecycle.shutdown_timeout_ms(),
        app_data_dir,
    })
}

#[tauri::command]
fn wfx_lifecycle_shutdown_done(app: AppHandle) -> CommandResult<()> {
    app.state::<Lifecycle>().release(&app);
    Ok(())
}

// — storage ——————————————————————————————————————————————————————————————

#[tauri::command]
fn wfx_storage_kv_get(app: AppHandle, key: String) -> CommandResult<Option<String>> {
    app.state::<Storage>().kv_get(&key)
}

#[tauri::command]
fn wfx_storage_kv_set(app: AppHandle, key: String, value: String) -> CommandResult<()> {
    app.state::<Storage>().kv_set(&key, &value)
}

#[tauri::command]
fn wfx_storage_kv_remove(app: AppHandle, key: String) -> CommandResult<()> {
    app.state::<Storage>().kv_remove(&key)
}

#[tauri::command]
fn wfx_storage_kv_keys(app: AppHandle, prefix: Option<String>) -> CommandResult<Vec<String>> {
    app.state::<Storage>().kv_keys(prefix)
}

#[tauri::command]
fn wfx_storage_blob_put(app: AppHandle, key: String, bytes: Vec<u8>) -> CommandResult<()> {
    app.state::<Storage>().blob_put(&key, &bytes)
}

#[tauri::command]
fn wfx_storage_blob_get(app: AppHandle, key: String) -> CommandResult<Option<Vec<u8>>> {
    app.state::<Storage>().blob_get(&key)
}

#[tauri::command]
fn wfx_storage_blob_remove(app: AppHandle, key: String) -> CommandResult<()> {
    app.state::<Storage>().blob_remove(&key)
}

#[tauri::command]
fn wfx_storage_quota(app: AppHandle) -> CommandResult<ShellStorageQuota> {
    app.state::<Storage>().quota()
}

// — browser host ——————————————————————————————————————————————————————————

#[tauri::command]
fn wfx_surface_open(app: AppHandle, request: ShellSurfaceOpenRequest) -> CommandResult<ShellSurfaceHandle> {
    app.state::<Surfaces>().open(&app, request)
}

#[tauri::command]
fn wfx_surface_navigate(app: AppHandle, session_id: String, url: String) -> CommandResult<()> {
    app.state::<Surfaces>().navigate(&app, &session_id, &url)
}

#[tauri::command]
fn wfx_surface_close(app: AppHandle, session_id: String) -> CommandResult<()> {
    app.state::<Surfaces>().close(&app, &session_id)
}

// — notifications ————————————————————————————————————————————————————————

#[tauri::command]
fn wfx_notify_permission(app: AppHandle) -> CommandResult<ShellPermissionState> {
    notifications::Notifications::permission(&app)
}

#[tauri::command]
async fn wfx_notify_request_permission(app: AppHandle) -> CommandResult<ShellPermissionState> {
    notifications::Notifications::request_permission(app).await
}

#[tauri::command]
fn wfx_notify_show(app: AppHandle, notification: ShellNotification) -> CommandResult<ShellNotifyOutcome> {
    notifications::Notifications::show(&app, notification)
}

// — background work ———————————————————————————————————————————————————————

#[tauri::command]
fn wfx_task_schedule(app: AppHandle, task: ShellTaskSpec) -> CommandResult<ShellTaskOutcome> {
    app.state::<Tasks>().schedule(&app, task)
}

#[tauri::command]
fn wfx_task_cancel(app: AppHandle, task_id: String) -> bool {
    app.state::<Tasks>().cancel(&app, &task_id)
}

#[tauri::command]
fn wfx_task_status(app: AppHandle, task_id: String) -> Option<ShellTaskStatus> {
    app.state::<Tasks>().status(&task_id)
}

#[tauri::command]
fn wfx_task_list(app: AppHandle) -> Vec<ShellTaskStatus> {
    app.state::<Tasks>().list()
}

#[tauri::command]
fn wfx_task_report(app: AppHandle, report: ShellTaskReport) -> bool {
    file_import::task_report(&app, report)
}

// — native file import (R20-F: the BYOF import file picker) —

#[tauri::command]
fn wfx_file_pick_available() -> ShellFilePickSupport {
    file_import::pick_available()
}

#[tauri::command]
async fn wfx_file_pick_open(app: AppHandle, request: ShellFilePickRequest) -> ShellFilePickOutcome {
    file_import::pick_open(app, request).await
}

#[tauri::command]
fn wfx_file_read(app: AppHandle, path: String) -> CommandResult<Vec<u8>> {
    file_import::read_file(&app, &path)
}

// — sharing ———————————————————————————————————————————————————————————————

#[tauri::command]
fn wfx_share_can_present(request: ShellShareRequest) -> bool {
    sharing::Sharing::can_present(&request)
}

#[tauri::command]
fn wfx_share_present(request: ShellShareRequest) -> CommandResult<ShellShareOutcome> {
    sharing::Sharing::present(request)
}

// — engine process —————————————————————————————————————————————————————————

#[tauri::command]
fn wfx_engine_spawn(app: AppHandle, config: ShellEngineConfig) -> CommandResult<ShellEngineHandleId> {
    app.state::<Arc<Engines>>().spawn(&app, config)
}

#[tauri::command]
fn wfx_engine_send(app: AppHandle, engine_id: String, command: serde_json::Value) -> CommandResult<serde_json::Value> {
    app.state::<Arc<Engines>>().send(&engine_id, &command)
}

#[tauri::command]
fn wfx_engine_terminate(app: AppHandle, engine_id: String) -> CommandResult<()> {
    app.state::<Arc<Engines>>().terminate(&engine_id);
    Ok(())
}
