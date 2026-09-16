//! Storage: the filesystem-backed key-value + blob areas under the OS
//! app-data directory (R08).
//!
//! LAYOUT (the documented, stable layout — the adapter's StoragePort maps
//! 1:1 onto it):
//!
//! ```text
//! {appDataDir}/wfx-desktop/
//!   storage/
//!     kv/     <url-encoded-key>.json   one JSON document per kv entry
//!     blobs/  <url-encoded-key>.bin    one binary file per blob entry
//!   surfaces/<surface-id>/             isolated webview data dirs (R09)
//!   engine-cache/                      the native-media engine's own area
//! ```
//!
//! Laws kept here:
//! - QUOTA IS DISK-TRUTH: usage = the summed size of the storage files;
//!   the bound = the real free space on the app-data volume (`fs2`), or
//!   `None` when the OS cannot answer. A write that cannot fit fails with
//!   the OS write error mapped onto the typed `quota-exceeded` (ENOSPC)
//!   or `io` code — NEVER a silent drop, NEVER an eviction of other keys.
//! - THE ADAPTER NEVER EVICTS (the frozen StoragePort law); media cache
//!   eviction is `@wfx/native-media`'s policy over ITS own cache dir.
//! - Keys are URL-encoded into filenames (namespaced keys like
//!   `watch/state-a` are legal and map to one file each); an empty key or
//!   one containing NUL rejects with the typed `invalid-key`.
//! - Writes are atomic (temp file + rename) so a crash never leaves a
//!   half-written entry that a later read would surface as `corrupt`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::ipc::{now_ms, CommandResult, ShellError, ShellStorageQuota};

/// The storage areas of one app-data root.
pub struct Storage {
    root: PathBuf,
}

fn encode_key(key: &str) -> String {
    // Percent-encode everything outside the unreserved set: namespaced
    // keys (`watch/state-a`) become single flat, path-safe filenames.
    let mut out = String::with_capacity(key.len());
    for byte in key.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

impl Storage {
    /// Open (and create) the storage areas under `{app_data}/wfx-desktop/storage`.
    pub fn new(app_data_dir: &Path) -> CommandResult<Self> {
        let root = app_data_dir.join("wfx-desktop").join("storage");
        for dir in [root.join("kv"), root.join("blobs")] {
            fs::create_dir_all(&dir).map_err(|e| ShellError::new("io", format!("create_dir_all({}): {}", dir.display(), e)))?;
        }
        Ok(Self { root })
    }

    fn kv_path(&self, key: &str) -> CommandResult<PathBuf> {
        if key.is_empty() || key.contains('\0') {
            return Err(ShellError::new("invalid-key", format!("unusable key '{key}'")));
        }
        Ok(self.root.join("kv").join(format!("{}.json", encode_key(key))))
    }

    fn blob_path(&self, key: &str) -> CommandResult<PathBuf> {
        if key.is_empty() || key.contains('\0') {
            return Err(ShellError::new("invalid-key", format!("unusable key '{key}'")));
        }
        Ok(self.root.join("blobs").join(format!("{}.bin", encode_key(key))))
    }

    fn dir_size(dir: &Path) -> u64 {
        let mut total = 0u64;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        total += meta.len();
                    }
                }
            }
        }
        total
    }

    /// Write bytes atomically: temp file + rename (crash-safe).
    fn atomic_write(path: &Path, bytes: &[u8], operation: &str) -> CommandResult<()> {
        let temp = path.with_extension(format!("tmp-{}", now_ms()));
        let mut file = fs::File::create(&temp)
            .map_err(|e| Self::map_write_err(e, operation, path))?;
        file.write_all(bytes).map_err(|e| Self::map_write_err(e, operation, path))?;
        file.sync_all().map_err(|e| ShellError::new("io", format!("{operation} sync {}: {e}", path.display())))?;
        fs::rename(&temp, path).map_err(|e| ShellError::new("io", format!("{operation} rename {}: {e}", path.display())))
    }

    fn map_write_err(e: std::io::Error, operation: &str, path: &Path) -> ShellError {
        if e.raw_os_error() == Some(28) {
            // ENOSPC: the volume is out of space — the disk-truth quota law.
            ShellError::new("quota-exceeded", format!("{operation} {}: no space left on the volume", path.display()))
        } else {
            ShellError::new("io", format!("{operation} {}: {e}", path.display()))
        }
    }

    // — kv area ——————————————————————————————————————————————————————————

    pub fn kv_get(&self, key: &str) -> CommandResult<Option<String>> {
        let path = self.kv_path(key)?;
        match fs::read_to_string(&path) {
            Ok(value) => {
                if let Err(e) = serde_json::from_str::<serde_json::Value>(&value) {
                    // A stored value that fails the integrity check is corrupt.
                    return Err(ShellError::new("corrupt", format!("kvGet({key}): {e}")));
                }
                Ok(Some(value))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(ShellError::new("io", format!("kvGet({key}): {e}"))),
        }
    }

    pub fn kv_set(&self, key: &str, value: &str) -> CommandResult<()> {
        let path = self.kv_path(key)?;
        Self::atomic_write(&path, value.as_bytes(), &format!("kvSet({key})"))
    }

    pub fn kv_remove(&self, key: &str) -> CommandResult<()> {
        let path = self.kv_path(key)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // idempotent
            Err(e) => Err(ShellError::new("io", format!("kvRemove({key}): {e}"))),
        }
    }

    /// List kv keys (decoded back from their encoded filenames), optional prefix.
    pub fn kv_keys(&self, prefix: Option<String>) -> CommandResult<Vec<String>> {
        let dir = self.root.join("kv");
        let mut keys = Vec::new();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(stem) = name.strip_suffix(".json") {
                    if let Ok(key) = percent_decode(stem) {
                        let matches = match prefix.as_deref() {
                            None => true,
                            Some(p) => key.starts_with(p),
                        };
                        if matches {
                            keys.push(key);
                        }
                    }
                }
            }
        }
        keys.sort();
        Ok(keys)
    }

    // — blob area —————————————————————————————————————————————————————————

    pub fn blob_put(&self, key: &str, bytes: &[u8]) -> CommandResult<()> {
        let path = self.blob_path(key)?;
        Self::atomic_write(&path, bytes, &format!("blobPut({key})"))
    }

    pub fn blob_get(&self, key: &str) -> CommandResult<Option<Vec<u8>>> {
        let path = self.blob_path(key)?;
        match fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(ShellError::new("io", format!("blobGet({key}): {e}"))),
        }
    }

    pub fn blob_remove(&self, key: &str) -> CommandResult<()> {
        let path = self.blob_path(key)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // idempotent
            Err(e) => Err(ShellError::new("io", format!("blobRemove({key}): {e}"))),
        }
    }

    // — accounting (disk-truth) ———————————————————————————————————————————

    /// Usage = summed file sizes; quota = the volume's real free space.
    pub fn quota(&self) -> CommandResult<ShellStorageQuota> {
        let usage = Self::dir_size(&self.root.join("kv")) + Self::dir_size(&self.root.join("blobs"));
        let quota = fs2::available_space(&self.root).ok();
        Ok(ShellStorageQuota { usage_bytes: usage, quota_bytes: quota })
    }
}

/// Decode a percent-encoded filename stem back into the original key.
fn percent_decode(value: &str) -> Result<String, std::io::Error> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            let byte = u8::from_str_radix(hex, 16)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}
