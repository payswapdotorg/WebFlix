//! Native file import (R20-F): the BYOF import file picker.
//!
//! The `wfx_file_pick_available` / `wfx_file_pick_open` / `wfx_file_read`
//! commands — the Rust half of the `ShellIpc` file-import area
//! (`apps/desktop/src/platform/shell-ipc.ts`). The dialog is the platform's
//! REAL open-file dialog (`rfd`, the Rust native-dialog crate); the bytes
//! are the file's REAL bytes (read by `wfx_file_read`).
//!
//! Truth laws kept here:
//! - A dismissed dialog answers the typed `dismissed` outcome — a normal
//!   user non-event, never an error.
//! - A platform that cannot show a dialog answers the typed `unsupported`
//!   verdict with the honest reason — never a silent no-op, never a fake
//!   pick. The capability query `wfx_file_pick_available` carries the same
//!   truth cheaply, without opening anything.
//! - A file that cannot be read rejects with the typed `io` failure —
//!   never fabricated bytes.
//! - READ ROOTING (the security law): the webview can invoke every
//!   `wfx_*` command, so `wfx_file_read` ONLY serves paths this shell's
//!   own dialog produced in this session (the pick/read pairing is the
//!   shell's). Any other path answers the typed `io` refusal — the
//!   command is not a general-purpose filesystem reader.

use std::collections::HashSet;
use std::sync::Mutex;

use rfd::FileDialog;

use tauri::{AppHandle, Manager};

use crate::background::Tasks;
use crate::ipc::{
    CommandResult, ShellError, ShellFilePickOutcome, ShellFilePickRequest, ShellFilePickSupport,
    ShellPickedFile, ShellTaskReport,
};

/// The session's picked-path registry: the read roots `wfx_file_read`
/// honors (populated ONLY by this shell's own dialog).
#[derive(Default)]
pub struct FileImports {
    picked: Mutex<HashSet<String>>,
}

impl FileImports {
    pub fn new() -> Self {
        Self::default()
    }

    fn remember(&self, path: &str) {
        if let Ok(mut picked) = self.picked.lock() {
            picked.insert(path.to_string());
        }
    }

    fn is_picked(&self, path: &str) -> bool {
        self.picked.lock().map(|picked| picked.contains(path)).unwrap_or(false)
    }
}

/// The honest file-dialog capability answer for this platform.
///
/// macOS and Windows always have a dialog service. Linux desktops have
/// one when a display server is reachable (X11 or Wayland) AND a GTK
/// toolkit can initialize — the environment check is the cheap proxy;
/// the dialog attempt itself remains the full truth (`wfx_file_pick_open`
/// answers `unsupported` when the toolkit fails to come up).
fn dialog_available() -> Result<(), String> {
    if cfg!(target_os = "macos") || cfg!(target_os = "windows") {
        return Ok(());
    }
    // Linux (and the unix-likes rfd serves through GTK): a display must
    // be reachable. This is a proxy — the dialog attempt is the truth.
    let has_display =
        std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some();
    if has_display {
        Ok(())
    } else {
        Err("this platform has no reachable display server for a native file dialog".into())
    }
}

/// `wfx_file_pick_available` — the cheap capability query (never opens a dialog).
pub fn pick_available() -> ShellFilePickSupport {
    match dialog_available() {
        Ok(()) => ShellFilePickSupport { available: true, detail: None },
        Err(detail) => ShellFilePickSupport { available: false, detail: Some(detail) },
    }
}

/// `wfx_file_pick_open` — show the REAL native open-file dialog.
///
/// rfd dialogs are main-thread-only on macOS, so the dialog runs through
/// Tauri's `run_on_main_thread` and the command awaits the answer.
pub async fn pick_open(app: AppHandle, request: ShellFilePickRequest) -> ShellFilePickOutcome {
    // The capability truth is answered by the attempt itself: a dialog
    // that cannot be shown is the honest `unsupported` outcome.
    if let Err(detail) = dialog_available() {
        return ShellFilePickOutcome::NotPicked { reason: "unsupported", detail };
    }

    let (sender, receiver) = std::sync::mpsc::channel::<Option<std::path::PathBuf>>();
    let dialog_request = request.clone();
    let dispatch = app.run_on_main_thread(move || {
        let mut dialog = FileDialog::new();
        if let Some(title) = &dialog_request.title {
            dialog = dialog.set_title(title);
        }
        if let Some(filters) = &dialog_request.filters {
            for filter in filters {
                dialog = dialog.add_filter(&filter.name, &filter.extensions);
            }
        }
        let _ = sender.send(dialog.pick_file());
    });
    if let Err(err) = dispatch {
        return ShellFilePickOutcome::NotPicked {
            reason: "unsupported",
            detail: format!("the dialog could not be dispatched to the main thread: {err}"),
        };
    }

    match receiver.recv() {
        Ok(Some(path)) => {
            let path_str = path.to_string_lossy().to_string();
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());
            let size_bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
            app.state::<FileImports>().remember(&path_str);
            ShellFilePickOutcome::Picked {
                file: ShellPickedFile { path: path_str, file_name, size_bytes },
            }
        }
        Ok(None) => ShellFilePickOutcome::NotPicked {
            reason: "dismissed",
            detail: "the user closed the file dialog without choosing a file".into(),
        },
        Err(err) => ShellFilePickOutcome::NotPicked {
            reason: "unsupported",
            detail: format!("the dialog answer never arrived: {err}"),
        },
    }
}

/// `wfx_file_read` — read one PICKED file's real bytes (the read-root law).
pub fn read_file(app: &AppHandle, path: &str) -> CommandResult<Vec<u8>> {
    if path.is_empty() {
        return Err(ShellError::new(
            "io",
            "wfx_file_read: the path is empty",
        ));
    }
    if !app.state::<FileImports>().is_picked(path) {
        return Err(ShellError::new(
            "io",
            format!(
                "wfx_file_read('{path}'): the path was not produced by this session's file dialog — \
                 the read root law refuses it (never a general-purpose file reader)"
            ),
        ));
    }
    std::fs::read(path).map_err(|err| {
        ShellError::new("io", format!("wfx_file_read('{path}'): the file could not be read: {err}"))
    })
}

/// `wfx_task_report` — one truthful executor-reported transition (R20-F):
/// the seam a TypeScript-side executor (the BYOF feed-sync driver) drives
/// the registry through, exactly the way engine sessions drive
/// acquisition-task state.
pub fn task_report(app: &AppHandle, report: ShellTaskReport) -> bool {
    app.state::<Tasks>().report(app, &report)
}
