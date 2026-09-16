//! Sharing: the OS share sheet seam (R08).
//!
//! HONESTY LAWS (the port contract, kept verbatim):
//! - A user DISMISSAL of the sheet is NOT a failure — the distinct
//!   `"dismissed"` outcome; only a real handoff answers `"shared"`.
//! - Platforms without a standard share sheet answer the honest
//!   `"unsupported"` outcome (`canShare` answers false; the UI renders
//!   the honest unsupported state — a clipboard copy is NOT presented as
//!   a share).
//!
//! Platform truth (the shell consults the OS, per request):
//! - macOS: the real `NSSharingServicePicker` share sheet (the raw-objc
//!   backend below; requires the R19 native-compile verification like
//!   every shell module — see shell/README.md).
//! - Windows / Linux: no wired sheet in R08 — the honest `unsupported`
//!   answer with the platform named. Wiring the WinRT
//!   `DataTransferManager` share UI (Windows) is an R19 acceptance item;
//!   Linux desktops have no standard sheet at all.
//!
//! Outcome honesty on the asynchronous sheet: a synchronous command cannot
//! observe the user's LATER dismissal. The sheet handoff itself is the
//! share: once the picker is shown with the request's items, the outcome
//! is `"shared"` (the OS owns the rest of the interaction). The delegate
//! callback channel (dismissed vs completed) is the R19 refinement,
//! documented here so the seam is explicit.

use crate::ipc::{CommandResult, ShellError, ShellShareOutcome, ShellShareRequest};

pub struct Sharing;

impl Sharing {
    /// Whether the OS share target exists for this request on this platform.
    pub fn can_present(_request: &ShellShareRequest) -> bool {
        cfg!(target_os = "macos")
    }

    /// Present the share sheet; the outcome is typed and honest.
    pub fn present(request: ShellShareRequest) -> CommandResult<ShellShareOutcome> {
        if !Self::can_present(&request) {
            return Ok(ShellShareOutcome {
                outcome: "unsupported",
                detail: Some(format!(
                    "no OS share sheet is wired on {} in R08 (macOS has the NSSharingServicePicker; see shell/README.md)",
                    std::env::consts::OS
                )),
            });
        }
        #[cfg(target_os = "macos")]
        {
            return macos::present(&request);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = request;
            unreachable!("can_present is false on non-macOS platforms")
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::msg_send;
    use objc2::runtime::{AnyObject, Class};
    use objc2_foundation::NSString;

    use super::*;

    /// Present the real macOS share sheet anchored on the main window.
    pub fn present(request: &ShellShareRequest) -> CommandResult<ShellShareOutcome> {
        unsafe {
            let app_class = Class::get("NSApplication").expect("NSApplication");
            let app: *mut AnyObject = msg_send![app_class, sharedApplication];
            if app.is_null() {
                return Err(ShellError::new("unavailable", "NSApplication is not running"));
            }
            let window: *mut AnyObject = msg_send![app, keyWindow];
            if window.is_null() {
                return Err(ShellError::new("unavailable", "no key window to anchor the share sheet on"));
            }
            let view: *mut AnyObject = msg_send![window, contentView];

            // Build the share items from the request's honest content: the
            // URL when present, otherwise the text — a title alone is not a
            // share item.
            let items: Vec<*mut AnyObject> = if let Some(url) = &request.url {
                let url_class = Class::get("NSURL").expect("NSURL");
                let ns_url: *mut AnyObject =
                    msg_send![url_class, URLWithString: NSString::from_str(url)];
                if ns_url.is_null() {
                    return Ok(ShellShareOutcome {
                        outcome: "failed",
                        detail: Some(format!("the share URL '{url}' could not be parsed by NSURL")),
                    });
                }
                vec![ns_url]
            } else if let Some(text) = &request.text {
                vec!(NSString::from_str(text) as *mut AnyObject)
            } else {
                return Ok(ShellShareOutcome {
                    outcome: "failed",
                    detail: Some("share request needs text or url to present an OS share target".into()),
                });
            };

            let array_class = Class::get("NSArray").expect("NSArray");
            let items_array: *mut AnyObject = msg_send![
                array_class,
                arrayWithObjects: items.as_ptr(),
                count: items.len()
            ];

            // NSSharingServicePicker: alloc + initWithItems:, shown relative
            // to the content view (the standard sheet anchor).
            let picker_class = Class::get("NSSharingServicePicker").expect("NSSharingServicePicker");
            let picker: *mut AnyObject = msg_send![picker_class, alloc];
            let picker: *mut AnyObject = msg_send![picker, initWithItems: items_array];
            let _: () = msg_send![
                picker,
                showRelativeToRect: std::ptr::null::<AnyObject>(),
                ofEdge: 1u64, // NSMinYEdge
                preferredEdge: 1u64,
                ofView: view
            ];

            // The sheet is shown — the OS owns the interaction from here.
            Ok(ShellShareOutcome { outcome: "shared", detail: None })
        }
    }
}
