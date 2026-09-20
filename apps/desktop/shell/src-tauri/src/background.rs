//! Background work: the native task registry (R08).
//!
//! Desktop truthfully declares `backgroundWork: "full"`:
//! - tasks keep RUNNING while the window is unfocused/minimized (the
//!   tray-kept process is alive — the "background acquisition/completion
//!   while unfocused" the frozen architecture names);
//! - the registry is the TRUTHFUL STATE authority: every transition the
//!   executors report is pushed to the `wfx://task` channel verbatim,
//!   never invented here;
//! - scheduling is idempotent per `taskId`; rejected work answers the
//!   typed reason (`invalid-task` / `unsupported-kind` / `at-capacity`)
//!   — never silently dropped;
//! - on shutdown the registry stops (bounded by the shell's teardown);
//!   durable resumption of interrupted acquisition is R13's recovery
//!   lane, keyed by the native-media session persistence.
//!
//! EXECUTION BINDING (documented boundary): the executors that drive
//! `acquisition` tasks are the native-media engine sessions themselves
//! (R10's service process keeps downloading — it reports progress/state
//! through the engine channel, and R14 wires the acquisition UX); the
//! BYOF feed `sync` executor landed with R20-F (the Desktop adapter's
//! feed-sync driver reports through the `wfx_task_report` seam); other
//! `sync`/`maintenance` executors land with their lanes. Until an executor
//! attaches, a task honestly sits in `scheduled` (progress `-1`) — never
//! fake `running`.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::ipc::{now_ms, CommandResult, ShellTaskOutcome, ShellTaskReport, ShellTaskSpec, ShellTaskStatus};

/// The registry cap (bounded bookkeeping; `at-capacity` is a typed answer).
const MAX_TRACKED_TASKS: usize = 256;

pub struct Tasks {
    tasks: Mutex<HashMap<String, ShellTaskStatus>>,
}

impl Tasks {
    pub fn new() -> Self {
        Self { tasks: Mutex::new(HashMap::new()) }
    }

    fn push(app: &AppHandle, status: ShellTaskStatus) {
        let _ = app.emit("wfx://task", &status);
    }

    /// Schedule one task (idempotent per taskId; typed rejections).
    pub fn schedule(&self, app: &AppHandle, task: ShellTaskSpec) -> CommandResult<ShellTaskOutcome> {
        if task.task_id.is_empty() {
            return Ok(ShellTaskOutcome {
                accepted: false,
                task_id: None,
                reason: Some("invalid-task"),
                detail: Some("the taskId must be a non-empty string".into()),
            });
        }
        if !matches!(task.kind.as_str(), "acquisition" | "sync" | "maintenance") {
            return Ok(ShellTaskOutcome {
                accepted: false,
                task_id: None,
                reason: Some("unsupported-kind"),
                detail: Some(format!("unknown background task kind '{}'", task.kind)),
            });
        }
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|e| crate::ipc::ShellError::new("INTERNAL", format!("task registry lock: {e}")))?;
        if let Some(existing) = tasks.get(&task.task_id) {
            if existing.state != "cancelled" {
                // Idempotent: re-scheduling answers accepted, no duplicate.
                return Ok(ShellTaskOutcome { accepted: true, task_id: Some(task.task_id), reason: None, detail: None });
            }
        }
        if tasks.len() >= MAX_TRACKED_TASKS {
            return Ok(ShellTaskOutcome {
                accepted: false,
                task_id: None,
                reason: Some("at-capacity"),
                detail: Some(format!("the task registry is at capacity ({MAX_TRACKED_TASKS})")),
            });
        }
        let status = ShellTaskStatus {
            task_id: task.task_id.clone(),
            kind: task.kind,
            state: "scheduled",
            progress: -1.0, // honestly unknown until an executor reports
            detail: None,
            updated_at_ms: now_ms(),
        };
        Self::push(app, status.clone());
        tasks.insert(task.task_id.clone(), status);
        Ok(ShellTaskOutcome { accepted: true, task_id: Some(task.task_id), reason: None, detail: None })
    }

    /// Cancel one task; `false` when unknown or already finished.
    pub fn cancel(&self, app: &AppHandle, task_id: &str) -> bool {
        let mut tasks = match self.tasks.lock() {
            Ok(tasks) => tasks,
            Err(_) => return false,
        };
        match tasks.get(task_id) {
            None => false,
            Some(task) if matches!(task.state, "completed" | "failed" | "cancelled") => false,
            Some(_) => {
                let next = ShellTaskStatus {
                    task_id: task_id.to_string(),
                    kind: tasks.get(task_id).map(|t| t.kind.clone()).unwrap_or_default(),
                    state: "cancelled",
                    progress: -1.0,
                    detail: None,
                    updated_at_ms: now_ms(),
                };
                Self::push(app, next.clone());
                tasks.insert(task_id.to_string(), next);
                true
            }
        }
    }

    /// One task's status snapshot (a copy).
    pub fn status(&self, task_id: &str) -> Option<ShellTaskStatus> {
        self.tasks.lock().ok().and_then(|tasks| tasks.get(task_id).cloned())
    }

    /// Every tracked task's status.
    pub fn list(&self) -> Vec<ShellTaskStatus> {
        self.tasks.lock().map(|tasks| tasks.values().cloned().collect()).unwrap_or_default()
    }

    /// The executor-facing report seam (R10/R14/R15/R20-F): an executor
    /// reports a truthful transition; the registry records and pushes it.
    /// The state string is VALIDATED against the closed task-state
    /// vocabulary — a bogus state never reaches the channel. Answers
    /// whether a KNOWN task was moved (`false` = unknown id: an honest
    /// no, never a fake transition).
    pub fn report(&self, app: &AppHandle, report: &ShellTaskReport) -> bool {
        const STATES: [&str; 6] = ["scheduled", "running", "suspended", "completed", "failed", "cancelled"];
        let state: &'static str = match STATES.iter().find(|s| **s == report.state) {
            Some(valid) => valid,
            None => return false, // a state outside the closed vocabulary is refused
        };
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(task) = tasks.get(&report.task_id) {
                let next = ShellTaskStatus {
                    task_id: report.task_id.clone(),
                    kind: task.kind.clone(),
                    state,
                    progress: report.progress,
                    detail: report.detail.clone(),
                    updated_at_ms: now_ms(),
                };
                Self::push(app, next.clone());
                tasks.insert(report.task_id.clone(), next);
                return true;
            }
        }
        false
    }
}

impl Default for Tasks {
    fn default() -> Self {
        Self::new()
    }
}
