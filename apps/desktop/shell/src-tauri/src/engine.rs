//! Engine: the native-media engine process host (R08 — the R10 seam's
//! native side).
//!
//! The shell spawns the engine binary (the R10 service process) as a
//! CHILD PROCESS speaking the frozen WFX-014 wire protocol: newline-
//! delimited JSON on stdin/stdout. Every value crossing the process
//! boundary is a versioned `EngineCommand`/`EngineEvent` DTO; the shell
//! relays — it adds NO protocol logic of its own (the adapter's binding
//! owns the port semantics on top).
//!
//! ```text
//!   adapter binding ── wfx_engine_send ──> stdin line ──> engine child
//!        ^                                                    |
//!        └── wfx://engine/<id> events <── stdout lines <──────┘
//! ```
//!
//! BINARY RESOLUTION (documented, in order):
//! 1. the spawn config's `binaryPath` (explicit);
//! 2. `WFX_ENGINE_PATH` (development override);
//! 3. the bundled sidecar `binaries/wfx-native-media-engine` (the Tauri
//!    `externalBin` config resolves it next to the app binary, with the
//!    target-triple suffix).
//!
//! The engine's cache directory and byte budget come from the spawn
//! config (the adapter's `EngineConfig`, re-validated here — a malformed
//! config is the typed `INVALID_INPUT` failure).
//!
//! Wire deadline: `wfx_engine_send` waits up to `WFX_ENGINE_TIMEOUT_MS`
//! (default 30 000) for the command's answering line; a silent engine
//! answers the typed `ENGINE_TIMEOUT` failure (the binding maps it onto
//! the port's `deadline-missed`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::ipc::{CommandResult, ShellEngineConfig, ShellError, ShellEngineHandleId};

/// The wire-command deadline environment knob (ms; default 30 000).
pub const ENGINE_TIMEOUT_ENV: &str = "WFX_ENGINE_TIMEOUT_MS";
const DEFAULT_ENGINE_TIMEOUT_MS: u64 = 30_000;

/// The engine binary name (the sidecar identity in tauri.conf.json).
pub const ENGINE_BINARY_NAME: &str = "wfx-native-media-engine";

/// One hosted engine: the child process, its stdin, and the routing slot
/// the reader thread uses to answer the currently-pending command.
struct HostedEngine {
    child: Child,
    stdin: ChildStdin,
    /// The pending command's reply channel (set by `send`, taken by the
    /// reader thread when the answer line arrives).
    pending: Arc<Mutex<Option<mpsc::Sender<String>>>>,
}

/// The hosted engines (the state behind the `wfx_engine_*` commands).
pub struct Engines {
    engines: Mutex<HashMap<String, HostedEngine>>,
    counter: AtomicU64,
    timeout_ms: u64,
}

impl Engines {
    pub fn new() -> Self {
        let timeout = std::env::var(ENGINE_TIMEOUT_ENV)
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .unwrap_or(DEFAULT_ENGINE_TIMEOUT_MS);
        Self {
            engines: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
            timeout_ms: timeout,
        }
    }

    /// Resolve the engine binary (explicit path, env override, sidecar).
    fn resolve_binary(config: &ShellEngineConfig) -> CommandResult<std::path::PathBuf> {
        if let Some(explicit) = &config.binary_path {
            let path = std::path::PathBuf::from(explicit);
            if path.is_file() {
                return Ok(path);
            }
            return Err(ShellError::new("INTERNAL", format!("engine binary not found at {explicit}")));
        }
        if let Ok(env_path) = std::env::var("WFX_ENGINE_PATH") {
            let path = std::path::PathBuf::from(env_path);
            if path.is_file() {
                return Ok(path);
            }
            return Err(ShellError::new("INTERNAL", format!("WFX_ENGINE_PATH '{env_path}' is not a file")));
        }
        // The sidecar: next to the current executable (Tauri resolves
        // externalBin next to the app binary, with the target triple).
        let exe = std::env::current_exe()
            .map_err(|e| ShellError::new("INTERNAL", format!("locating the app binary: {e}")))?;
        let dir = exe.parent().ok_or_else(|| ShellError::new("INTERNAL", "the app binary has no parent dir"))?;
        for candidate in [
            dir.join(format!("{ENGINE_BINARY_NAME}-{}", target_triple())),
            dir.join(ENGINE_BINARY_NAME),
        ] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        Err(ShellError::new(
            "INTERNAL",
            format!("the {ENGINE_BINARY_NAME} sidecar was not found next to the app binary (bundle it or set WFX_ENGINE_PATH)"),
        ))
    }

    /// Validate the spawn config (mirroring the frozen validateEngineConfig).
    fn validate_config(config: &ShellEngineConfig) -> CommandResult<()> {
        if config.cache_dir.trim().is_empty() {
            return Err(ShellError::new("INVALID_INPUT", "EngineConfig.cacheDir must be a non-empty string"));
        }
        Ok(())
    }

    /// Spawn the engine process; relay its spontaneous events to the
    /// frontend channel `wfx://engine/<id>`.
    pub fn spawn(&self, app: &AppHandle, config: ShellEngineConfig) -> CommandResult<ShellEngineHandleId> {
        Self::validate_config(&config)?;
        let binary = Self::resolve_binary(&config)?;

        let mut child = Command::new(&binary)
            .env("WFX_ENGINE_CACHE_DIR", &config.cache_dir)
            .env("WFX_ENGINE_MAX_CACHE_BYTES", config.max_cache_bytes.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| ShellError::new("INTERNAL", format!("spawning the engine binary ({}): {e}", binary.display())))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ShellError::new("INTERNAL", "the engine stdin could not be captured"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ShellError::new("INTERNAL", "the engine stdout could not be captured"))?;

        let id = format!("wfx-engine-{}", self.counter.fetch_add(1, Ordering::SeqCst));
        let pending: Arc<Mutex<Option<mpsc::Sender<String>>>> = Arc::new(Mutex::new(None));

        // The reader thread: every stdout line is relayed to the frontend
        // channel AND routed to the currently-pending command's channel
        // (the v1 protocol answers commands in order — one pending slot
        // is faithful to the frozen request/response law).
        {
            let app = app.clone();
            let channel = format!("wfx://engine/{id}");
            let pending = Arc::clone(&pending);
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(event) = line else { break };
                    // Relay the raw event JSON to the frontend channel.
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&event) {
                        let _ = app.emit(&channel, &value);
                    }
                    // Route to the pending command, if one is waiting.
                    if let Ok(mut slot) = pending.lock() {
                        if let Some(tx) = slot.take() {
                            let _ = tx.send(event);
                        }
                    }
                }
                // The engine's stdout closed: it died. Route a terminal
                // nothing to any pending command so it fails the deadline
                // honestly, and let the frontend observe the silence.
            });
        }

        let hosted = HostedEngine { child, stdin, pending };
        if let Ok(mut engines) = self.engines.lock() {
            engines.insert(id.clone(), hosted);
        }
        Ok(ShellEngineHandleId { engine_id: id })
    }

    /// Send one command; wait for its answering line (bounded by the
    /// wire deadline). The command DTO is serialized verbatim.
    pub fn send(&self, engine_id: &str, command: &serde_json::Value) -> CommandResult<serde_json::Value> {
        let engines = self
            .engines
            .lock()
            .map_err(|e| ShellError::new("INTERNAL", format!("engine registry lock: {e}")))?;
        let hosted = engines
            .get(engine_id)
            .ok_or_else(|| ShellError::new("NOT_FOUND", format!("no live engine '{engine_id}'")))?;

        // Serialize + write the command line.
        let mut line = serde_json::to_string(command)
            .map_err(|e| ShellError::new("INTERNAL", format!("serializing the engine command: {e}")))?;
        line.push('\n');
        hosted
            .stdin
            .write_all(line.as_bytes())
            .map_err(|e| ShellError::new("IO_ERROR", format!("writing to the engine stdin: {e}")))?;
        hosted
            .stdin
            .flush()
            .map_err(|e| ShellError::new("IO_ERROR", format!("flushing the engine stdin: {e}")))?;

        // Arm the reply slot and wait (bounded by the wire deadline).
        let (tx, rx) = mpsc::channel::<String>();
        if let Ok(mut slot) = hosted.pending.lock() {
            *slot = Some(tx);
        } else {
            return Err(ShellError::new("INTERNAL", "the engine reply slot is poisoned"));
        }
        let answer = rx
            .recv_timeout(Duration::from_millis(self.timeout_ms))
            .map_err(|_| {
                // Clear the slot so a late answer is not routed nowhere.
                if let Ok(mut slot) = hosted.pending.lock() {
                    *slot = None;
                }
                ShellError::new("ENGINE_TIMEOUT", format!("the engine did not answer within {}ms", self.timeout_ms))
            })?;
        serde_json::from_str(&answer)
            .map_err(|e| ShellError::new("INTERNAL", format!("the engine answered a malformed line: {e}")))
    }

    /// Terminate one engine (idempotent; best-effort kill).
    pub fn terminate(&self, engine_id: &str) {
        if let Ok(mut engines) = self.engines.lock() {
            if let Some(mut hosted) = engines.remove(engine_id) {
                let _ = hosted.child.kill();
                let _ = hosted.child.wait();
            }
        }
    }

    /// Terminate every hosted engine (app teardown).
    pub fn terminate_all(&self) {
        if let Ok(mut engines) = self.engines.lock() {
            for (_, mut hosted) in engines.drain() {
                let _ = hosted.child.kill();
                let _ = hosted.child.wait();
            }
        }
    }
}

impl Default for Engines {
    fn default() -> Self {
        Self::new()
    }
}

/// The Rust target triple (the sidecar naming convention).
fn target_triple() -> String {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => other,
    };
    let os = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        other => other,
    };
    format!("{arch}-{os}")
}

/// Convenience: the app-data-scoped default engine cache dir.
pub fn default_engine_cache_dir(app: &AppHandle) -> String {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("wfx-desktop").join("engine-cache"))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "wfx-desktop/engine-cache".into())
}
