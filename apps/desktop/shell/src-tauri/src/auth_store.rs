//! Auth store (R22-H): the OS credential store for the session secret.
//!
//! The `wfx_auth_store_support` / `wfx_auth_store_set` / `wfx_auth_store_get`
//! / `wfx_auth_store_clear` commands — the Rust half of the `ShellIpc`
//! auth-store area (`apps/desktop/src/platform/shell-ipc.ts`). The store is
//! the platform's REAL OS credential service through the `keyring` crate
//! (macOS Keychain, Windows Credential Manager, the Linux Secret Service):
//! the Desktop platform storage law for the one-time session token the
//! R22-B account-creation contract issues.
//!
//! Truth laws kept here:
//! - THE ENTRY IS OPAQUE: the shell stores and serves the adapter's
//!   `{ payload, savedAt }` pair serialized as ONE JSON string. It never
//!   parses the payload, never logs it, never renders it (the secret law
//!   at this seam — only the serialization pair is interpreted, and only
//!   to carry it verbatim across restarts).
//! - A platform with no reachable credential service answers the typed
//!   `unsupported` verdict with the honest reason — NEVER a silent no-op,
//!   NEVER a fallback to plaintext file storage (a silent downgrade would
//!   be a fabricated safety). `wfx_auth_store_support` carries the same
//!   truth cheaply, without touching the store.
//! - An entry that cannot be read or parsed rejects with the typed
//!   `corrupt` code — surfaced to the adapter, never silently treated as
//!   absent (a corrupt secret is a loud failure; the adapter's recovery
//!   is sign-in-again).
//! - Clear is idempotent: clearing when nothing was stored is a success.
//! - One entry: the service/user pair is fixed (`webflix.session` /
//!   `wfx-desktop`) — the app stores exactly ONE session material at a
//!   time (the active account's), matching the product's single-session
//!   law. `set` REPLACES (the keychain's own upsert).

use keyring::Entry;

use crate::ipc::{CommandResult, ShellAuthStoreEntry, ShellAuthStoreSupport, ShellError};

/// The fixed keychain service/user pair (the single-session law).
const SERVICE: &str = "webflix.session";
const USER: &str = "wfx-desktop";

/// The OS credential store area.
pub struct AuthStore;

impl AuthStore {
    pub fn new() -> Self {
        Self
    }

    /// The honest capability answer for this platform.
    ///
    /// macOS and Windows always have a credential service. Linux has one
    /// when a Secret Service implementation is reachable (the `keyring`
    /// crate's linux backend resolves it lazily); the cheap answer names
    /// the requirement, and the set/get calls carry the definitive truth
    /// (a store attempt that cannot reach the service fails typed).
    pub fn support(&self) -> ShellAuthStoreSupport {
        if cfg!(target_os = "macos") || cfg!(target_os = "windows") {
            return ShellAuthStoreSupport { available: true, detail: None };
        }
        ShellAuthStoreSupport {
            available: false,
            detail: Some(
                "this Linux desktop has no reachable Secret Service for OS-keychain \
                 storage — the session secret cannot be stored (sign-in works, but \
                 the session will not persist across restarts)"
                    .to_string(),
            ),
        }
    }

    fn entry() -> CommandResult<Entry> {
        Entry::new(SERVICE, USER)
            .map_err(|e| ShellError::new("unavailable", format!("keychain entry: {e}")))
    }

    /// Store the session material (REPLACES any prior entry).
    pub fn set(&self, wire: ShellAuthStoreEntry) -> CommandResult<()> {
        let serialized =
            serde_json::to_string(&wire).map_err(|e| ShellError::new("io", format!("serialize entry: {e}")))?;
        let entry = Self::entry()?;
        entry
            .set_password(&serialized)
            .map_err(|e| ShellError::new("io", format!("keychain set: {e}")))
    }

    /// Restore the stored session material (`None` when nothing stored).
    pub fn get(&self) -> CommandResult<Option<ShellAuthStoreEntry>> {
        let entry = Self::entry()?;
        let serialized = match entry.get_password() {
            Ok(payload) => payload,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(e) => return Err(ShellError::new("corrupt", format!("keychain get: {e}"))),
        };
        let parsed: ShellAuthStoreEntry = serde_json::from_str(&serialized)
            .map_err(|e| ShellError::new("corrupt", format!("stored entry is not the entry pair: {e}")))?;
        Ok(Some(parsed))
    }

    /// Clear the stored session material (idempotent).
    pub fn clear(&self) -> CommandResult<()> {
        let entry = Self::entry()?;
        match entry.get_password() {
            Ok(_) => entry
                .delete_credential()
                .map_err(|e| ShellError::new("io", format!("keychain clear: {e}"))),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(ShellError::new("corrupt", format!("keychain clear: {e}"))),
        }
    }
}
