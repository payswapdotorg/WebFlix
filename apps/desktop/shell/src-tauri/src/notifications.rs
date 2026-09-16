//! Notifications: the OS notification channel through
//! `tauri-plugin-notification` (R08).
//!
//! The truth law: delivery is NEVER fabricated — permission-denied before
//! the grant, invalid-request for malformed notifications, and `delivered`
//! only after the OS accepted the handoff.

use tauri_plugin_notification::NotificationExt;

use tauri::AppHandle;

use crate::ipc::{CommandResult, ShellError, ShellNotification, ShellNotifyOutcome, ShellPermissionState};

pub struct Notifications;

impl Notifications {
    /// The truthful current permission state.
    pub fn permission(app: &AppHandle) -> CommandResult<ShellPermissionState> {
        let state = app.notification().permission_state();
        let (granted, can_request) = match state {
            tauri_plugin_notification::PermissionState::Granted => (true, false),
            tauri_plugin_notification::PermissionState::Denied => {
                // A denied OS state may be soft (askable) or hard (settings);
                // request_permission is the honest probe-free resolution —
                // canRequest stays true until a request answers denied.
                (false, true)
            }
            tauri_plugin_notification::PermissionState::Prompt => (false, true),
            tauri_plugin_notification::PermissionState::Default => (false, true),
            _ => (false, true),
        };
        Ok(ShellPermissionState {
            granted,
            can_request: can_request && !granted,
            reason: if granted { None } else { Some("the OS notification permission is not granted".into()) },
        })
    }

    /// Ask the user where possible; answers the resulting state.
    pub async fn request_permission(app: AppHandle) -> CommandResult<ShellPermissionState> {
        let result = app.notification().request_permission().await;
        match result {
            Ok(tauri_plugin_notification::PermissionState::Granted) => {
                Ok(ShellPermissionState { granted: true, can_request: false, reason: None })
            }
            Ok(_) => Ok(ShellPermissionState {
                granted: false,
                can_request: false,
                reason: Some("the user or OS denied the notification permission".into()),
            }),
            Err(e) => Err(ShellError::new("unavailable", format!("requesting notification permission failed: {e}"))),
        }
    }

    /// Show one notification; the outcome is typed and honest.
    pub fn show(app: &AppHandle, notification: ShellNotification) -> CommandResult<ShellNotifyOutcome> {
        if notification.title.trim().is_empty() {
            return Ok(ShellNotifyOutcome::NotDelivered {
                reason: "invalid-request",
                detail: format!("notification.title: expected a non-empty string, got '{}'", notification.title),
            });
        }
        let permission = Self::permission(app)?;
        if !permission.granted {
            return Ok(ShellNotifyOutcome::NotDelivered {
                reason: "permission-denied",
                detail: "the OS notification permission is not granted".into(),
            });
        }
        let mut builder = app.notification().builder().title(&notification.title);
        if let Some(body) = &notification.body {
            builder = builder.body(body);
        }
        // The real OS handoff (the plugin routes to NSUserNotification /
        // the Windows notification channel / libnotify).
        builder
            .show()
            .map_err(|e| ShellError::new("unavailable", format!("the OS notification channel failed: {e}")))?;
        Ok(ShellNotifyOutcome::Delivered)
    }
}
