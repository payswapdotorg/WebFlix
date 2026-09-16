//! Browser host: the contained webview surface sessions (R08).
//!
//! SECURITY BOUNDARY (frozen remediation architecture, "Media Surface" —
//! the same law the port contract states):
//!
//! - Each `open` creates a CHILD WEBVIEW WINDOW with its OWN isolated
//!   data directory (`{appData}/wfx-desktop/surfaces/<session-id>/`):
//!   the provider's cookies/storage are isolated from the WebFlix app
//!   window AND from every other surface session (the mandatory
//!   `restrictCookies: "isolate"` law — requests carrying any other mode
//!   are refused before a window exists).
//! - Navigation is OBSERVED, never blocked, never steered: URL changes
//!   and window closes emit events to the frontend channel; provider
//!   pages stay provider-owned (no script injection, no credential
//!   capture, no content inspection — by design).
//! - Only http(s) URLs open; anything else rejects with the typed
//!   `invalid-url` failure.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder};

use crate::ipc::{now_ms, CommandResult, ShellError, ShellSurfaceEvent, ShellSurfaceHandle, ShellSurfaceOpenRequest};

/// The tracked surface sessions.
pub struct Surfaces {
    app_data_dir: PathBuf,
    sessions: Mutex<HashMap<String, bool>>, // session id -> open
    counter: std::sync::atomic::AtomicU64,
}

impl Surfaces {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir,
            sessions: Mutex::new(HashMap::new()),
            counter: std::sync::atomic::AtomicU64::new(0),
        }
    }

    fn event(app: &AppHandle, kind: &'static str, session_id: &str, url: Option<String>, reason: Option<String>) {
        let event = ShellSurfaceEvent {
            kind,
            session_id: session_id.to_string(),
            url,
            occurred_at_ms: now_ms(),
            reason,
        };
        let _ = app.emit("wfx://surface", &event);
    }

    /// Open one isolated contained surface at a provider-owned URL.
    pub fn open(&self, app: &AppHandle, request: ShellSurfaceOpenRequest) -> CommandResult<ShellSurfaceHandle> {
        if request.restrict_cookies != "isolate" {
            return Err(ShellError::new(
                "invalid-session",
                "the cookie-isolation contract is not optional (the shell refuses non-isolated surfaces)",
            ));
        }
        let url = tauri::Url::parse(&request.url).map_err(|e| {
            ShellError::new("invalid-url", format!("the URL '{}' is not openable: {}", request.url, e))
        })?;
        if url.scheme() != "http" && url.scheme() != "https" {
            return Err(ShellError::new(
                "invalid-url",
                format!("the contained surface only opens http(s) URLs (got '{}')", url.scheme()),
            ));
        }

        let id = format!("wfx-surface-{}", self.counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst));
        // The isolated data directory for THIS session (cookie/storage
        // isolation — the mandatory law).
        let data_dir = self.app_data_dir.join("wfx-desktop").join("surfaces").join(&id);
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| ShellError::new("io", format!("surface data dir: {e}")))?;

        let builder = WebviewWindowBuilder::new(app, &id, url)
            .title("WebFlix")
            .inner_size(1100.0, 720.0)
            .data_directory(&data_dir);
        builder
            .build()
            .map_err(|e| ShellError::new("unavailable", format!("the webview surface failed to open: {e}")))?;

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(id.clone(), true);
        }
        Ok(ShellSurfaceHandle { session_id: id })
    }

    /// Navigate a surface (observed, never steered).
    pub fn navigate(&self, app: &AppHandle, session_id: &str, url: &str) -> CommandResult<()> {
        let open = self.sessions.lock().map(|s| *s.get(session_id).unwrap_or(&false)).unwrap_or(false);
        if !open {
            return Err(ShellError::new("invalid-session", format!("no open surface '{session_id}'")));
        }
        let parsed = tauri::Url::parse(url)
            .map_err(|e| ShellError::new("invalid-url", format!("the URL '{url}' is not navigable: {e}")))?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(ShellError::new("invalid-url", "the surface only navigates to http(s) URLs"));
        }
        if let Some(window) = app.get_webview_window(session_id) {
            window
                .navigate(parsed)
                .map_err(|e| ShellError::new("unavailable", format!("navigate failed: {e}")))?;
        }
        Self::event(app, "navigated", session_id, Some(url.to_string()), None);
        Ok(())
    }

    /// Close a surface exactly once; emits the terminal `closed` event.
    pub fn close(&self, app: &AppHandle, session_id: &str) -> CommandResult<()> {
        let was_open = self
            .sessions
            .lock()
            .map(|mut s| s.remove(session_id).unwrap_or(false))
            .unwrap_or(false);
        if !was_open {
            return Err(ShellError::new("invalid-session", format!("no surface '{session_id}' to close")));
        }
        if let Some(window) = app.get_webview_window(session_id) {
            let _ = window.destroy();
        }
        Self::event(app, "closed", session_id, None, None);
        Ok(())
    }

    /// The window-event bridge: a surface window the USER closed emits
    /// the honest `closed` event (the runtime records an honest stop).
    pub fn on_surface_window_destroyed(app: &AppHandle, label: &str) {
        let surfaces = app.state::<Surfaces>();
        let was_open = surfaces
            .sessions
            .lock()
            .map(|mut s| s.remove(label).unwrap_or(false))
            .unwrap_or(false);
        if was_open {
            Self::event(app, "closed", label, None, None);
        }
    }
}
