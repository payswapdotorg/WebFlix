//! The typed IPC surface of the WebFlix Desktop shell (R08).
//!
//! These DTOs are the Rust half of the `ShellIpc` contract
//! (`apps/desktop/src/platform/shell-ipc.ts`): every command the adapter
//! invokes and every event the shell pushes crosses this boundary in the
//! SAME shapes, serialized by serde. The TS side's `ShellIpcError`
//! (`{ name: "ShellIpcError", code, detail }`) is the error payload every
//! fallible command returns — the adapter's port wrappers re-map it onto
//! the platform-contracts error taxonomies (same vocabulary, verbatim).

use serde::{Deserialize, Serialize};

/// The shell's identity + shutdown budget (the `info` command's answer).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub shell_id: &'static str,
    pub shell_version: &'static str,
    pub shutdown_timeout_ms: u64,
    pub app_data_dir: String,
}

// — lifecycle ————————————————————————————————————————————————————————————
/// One native lifecycle transition pushed on the `wfx://lifecycle` channel.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellLifecycleEvent {
    pub kind: &'static str, // "ready" | "background" | "resume" | "shutdown"
    pub occurred_at_ms: u64,
}

// — storage ——————————————————————————————————————————————————————————————
/// Filesystem accounting (the `wfx_storage_quota` answer): disk-truth.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellStorageQuota {
    pub usage_bytes: u64,
    pub quota_bytes: Option<u64>,
}

// — browser host ——————————————————————————————————————————————————————————
/// A surface-open request (the adapter always sends `restrictCookies: "isolate"`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSurfaceOpenRequest {
    pub url: String,
    pub restrict_cookies: String, // must be "isolate" — enforced, not trusted
    pub purpose: String,          // "playback" | "authorization" | "general"
}

/// The `wfx_surface_open` answer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSurfaceHandle {
    pub session_id: String,
}

/// One surface event pushed on the `wfx://surface` channel.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellSurfaceEvent {
    pub kind: &'static str, // "navigated" | "closed" | "blocked"
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub occurred_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

// — notifications ————————————————————————————————————————————————————————
/// The OS permission state (the `wfx_notify_permission` answers).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellPermissionState {
    pub granted: bool,
    pub can_request: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// One notification to show through the OS channel.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellNotification {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub category: String, // "acquisition" | "playback" | "general"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

/// The OS handoff outcome (never a fabricated delivery).
#[derive(Serialize)]
#[serde(tag = "delivered", rename_all = "camelCase")]
pub enum ShellNotifyOutcome {
    Delivered,
    #[serde(rename_all = "camelCase")]
    NotDelivered {
        reason: &'static str, // "permission-denied" | "unavailable" | "invalid-request"
        detail: String,
    },
}

// — background work ———————————————————————————————————————————————————————
/// One background task to schedule (the BackgroundTaskSpec shape).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellTaskSpec {
    pub task_id: String,
    pub kind: String, // "acquisition" | "sync" | "maintenance"
    pub label: String,
}

/// One task status snapshot (the BackgroundTaskStatus shape).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellTaskStatus {
    pub task_id: String,
    pub kind: String,
    pub state: &'static str, // "scheduled" | "running" | "suspended" | "completed" | "failed" | "cancelled"
    pub progress: f64,       // [0,1], or -1 when honestly unknown
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub updated_at_ms: u64,
}

/// The typed outcome of a schedule call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellTaskOutcome {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>, // "unsupported-kind" | "at-capacity" | "invalid-task"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One executor-reported task transition (the ShellTaskReport shape, R20-F).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellTaskReport {
    pub task_id: String,
    pub state: String, // the task-state vocabulary above, enforced by the registry
    pub progress: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// — native file import (R20-F) ————————————————————————————————————————————
/// One file-type filter row of a pick request (the ShellFilePickFilter shape).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellFilePickFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// A native open-file dialog request (the ShellFilePickRequest shape).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellFilePickRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<ShellFilePickFilter>>,
}

/// One picked file (the ShellPickedFile shape — shell-truth metadata).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellPickedFile {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
}

/// The typed pick outcome: picked, dismissed, or the honest unsupported
/// verdict of a platform with no dialog service (never a silent no-op).
#[derive(Serialize, Clone)]
#[serde(tag = "picked", rename_all = "camelCase")]
pub enum ShellFilePickOutcome {
    Picked { file: ShellPickedFile },
    NotPicked {
        reason: &'static str, // "dismissed" | "unsupported"
        detail: String,
    },
}

/// The file-dialog capability answer (the ShellFilePickSupport shape).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellFilePickSupport {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// — sharing ———————————————————————————————————————————————————————————————
/// One share request (the ShareRequest shape).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellShareRequest {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

/// The OS share-sheet outcome (dismissed is distinct from failed; the
/// honest `unsupported` names platforms without a sheet).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellShareOutcome {
    pub outcome: &'static str, // "shared" | "dismissed" | "failed" | "unsupported"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// — engine process ————————————————————————————————————————————————————————
/// The engine spawn configuration (the EngineConfig shape).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellEngineConfig {
    pub cache_dir: String,
    pub max_cache_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
}

/// The `wfx_engine_spawn` answer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellEngineHandleId {
    pub engine_id: String,
}

/// The typed shell failure — the error payload EVERY fallible command
/// returns (serde-serialized as `{ name, code, detail }`-compatible JSON;
/// the TS side's `ShellIpcError` normalizes it).
#[derive(Serialize, Clone)]
pub struct ShellError {
    pub name: &'static str, // "ShellIpcError"
    pub code: &'static str, // the closed per-area vocabulary (see shell-ipc.ts)
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl ShellError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self { name: "ShellIpcError", code, detail: detail.into(), session_id: None }
    }

    pub fn with_session(code: &'static str, detail: impl Into<String>, session_id: String) -> Self {
        Self { name: "ShellIpcError", code, detail: detail.into(), session_id: Some(session_id) }
    }
}

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "shell ipc failure ({}): {}", self.code, self.detail)
    }
}

/// Every command result the shell answers with.
pub type CommandResult<T> = Result<T, ShellError>;

/// Milliseconds since the Unix epoch (the shell's clock — the native side
/// owns window/event timestamps).
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
