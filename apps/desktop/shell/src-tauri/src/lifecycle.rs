//! Lifecycle: the native window events bridged onto the frozen lifecycle
//! vocabulary (R08).
//!
//! ```text
//! window created + frontend loaded        -> ready
//! minimized / hidden                      -> background
//! restored / shown                        -> resume
//! close requested (X button / Cmd-Q)      -> shutdown (BOUNDED drain)
//! ```
//!
//! THE SHUTDOWN LAW (the adapter contract the runtime's at-least-once
//! outbox flush depends on): on close-requested the shell PREVENTS the
//! default exit, emits `shutdown`, and waits up to
//! `WFX_SHUTDOWN_TIMEOUT_MS` (default 5000) for the frontend's
//! `wfx_lifecycle_shutdown_done` command — the adapter drains its async
//! shutdown hooks and then releases the shell. When the budget elapses,
//! the shell exits anyway (bounded teardown — the pending events stay
//! visible in the next session's outbox, never silently lost).
//!
//! The tray icon keeps the PROCESS alive while the window is hidden/
//! minimized (the Desktop `backgroundWork: "full"` truth): backgrounding
//! does NOT exit the app; only an explicit quit (after the bounded drain)
//! does.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use crate::ipc::{now_ms, ShellLifecycleEvent};

/// The shutdown-budget environment knob (ms; default 5000).
pub const SHUTDOWN_TIMEOUT_ENV: &str = "WFX_SHUTDOWN_TIMEOUT_MS";
const DEFAULT_SHUTDOWN_TIMEOUT_MS: u64 = 5_000;

/// The lifecycle bridge state (managed at setup).
pub struct Lifecycle {
    release: Mutex<mpsc::Sender<()>>,
    shutdown_armed: AtomicBool,
    shutdown_timeout_ms: u64,
}

impl Lifecycle {
    pub fn new() -> Self {
        let timeout = std::env::var(SHUTDOWN_TIMEOUT_ENV)
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .unwrap_or(DEFAULT_SHUTDOWN_TIMEOUT_MS);
        let (tx, _rx) = mpsc::channel();
        Self {
            release: Mutex::new(tx),
            shutdown_armed: AtomicBool::new(false),
            shutdown_timeout_ms: timeout,
        }
    }

    /// The configured shutdown budget (surfaced through `wfx_shell_info`).
    pub fn shutdown_timeout_ms(&self) -> u64 {
        self.shutdown_timeout_ms
    }

    /// Push one lifecycle event to the frontend channel.
    fn emit(app: &AppHandle, kind: &'static str) {
        let event = ShellLifecycleEvent { kind, occurred_at_ms: now_ms() };
        let _ = app.emit("wfx://lifecycle", &event);
    }

    /// The window-event bridge (registered at setup).
    pub fn on_window_event(app: &AppHandle, event: &WindowEvent) {
        let lifecycle = app.state::<Lifecycle>();
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                // First close request: prevent the default exit, drain.
                if !lifecycle.shutdown_armed.swap(true, Ordering::SeqCst) {
                    api.prevent_close();
                    Self::emit(app, "shutdown");
                    let app = app.clone();
                    let timeout = Duration::from_millis(lifecycle.shutdown_timeout_ms);
                    std::thread::spawn(move || {
                        // Wait for the adapter's release (bounded), then exit.
                        let (tx, rx) = mpsc::channel();
                        if let Ok(mut guard) = app.state::<Lifecycle>().release.lock() {
                            *guard = tx;
                        }
                        let _ = rx.recv_timeout(timeout); // elapsed: exit anyway
                        Lifecycle::exit_process(&app);
                    });
                }
            }
            WindowEvent::Destroyed => {
                if lifecycle.shutdown_armed.load(Ordering::SeqCst) {
                    Self::exit_process(app);
                }
            }
            _ => {}
        }
    }

    /// The frontend's release: the adapter finished draining its hooks.
    pub fn release(&self, app: &AppHandle) {
        if let Ok(guard) = self.release.lock() {
            let _ = guard.send(());
        }
    }

    /// Tear the process down: engines first (their children die with the
    /// process; the engines own their durable state — R10/R13's lane),
    /// then the app loop.
    fn exit_process(app: &AppHandle) {
        if let Some(engines) = app.try_state::<crate::engine::Engines>() {
            engines.terminate_all();
        }
        app.exit(0);
    }

    /// The setup hook: after the frontend is ready, emit `ready`.
    pub fn emit_ready(app: &AppHandle) {
        Self::emit(app, "ready");
    }

    /// Window visibility changes (minimize/restore) push background/resume.
    pub fn emit_background(app: &AppHandle) {
        Self::emit(app, "background");
    }

    pub fn emit_resume(app: &AppHandle) {
        Self::emit(app, "resume");
    }
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self::new()
    }
}
