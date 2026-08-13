//! File I/O helpers for paths that may block.
//!
//! `Path::exists` / `fs::read_to_string` on an unreachable `\\wsl.localhost\...`
//! UNC or network root can block for a long time (the OS call only returns after
//! its own timeout). Running these calls directly on the async runtime worker
//! would stall unrelated commands, so every helper here runs the blocking call
//! via `spawn_blocking` and bails out after a timeout.
//!
//! Notes:
//! - `tokio::time::timeout` only guarantees the await returns; the stuck OS read
//!   keeps occupying its blocking thread until the OS gives up. A bounded
//!   semaphore caps how many such reads may run concurrently so a dead network
//!   root can never exhaust the blocking thread pool.
//! - Prefer the async variants from async code paths (Tauri commands, spawned
//!   tasks, tray flows). Sync helpers must stay sync-boundary only.

use serde_json::{Map, Value};
use std::io;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

/// How long a single blocking file operation may take before we give up.
const DEFAULT_FILE_IO_TIMEOUT: Duration = Duration::from_secs(10);
/// Max concurrent blocking file operations. Bounded so a few stuck UNC reads
/// cannot exhaust the spawn_blocking thread pool.
const MAX_CONCURRENT_BLOCKING_READS: usize = 8;

static READ_SEMAPHORE: LazyLock<tokio::sync::Semaphore> = LazyLock::new(|| {
    tokio::sync::Semaphore::new(MAX_CONCURRENT_BLOCKING_READS)
});

fn timeout_error(action: &str, path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::TimedOut,
        format!(
            "{action} {} timed out after {:?}",
            path.display(),
            DEFAULT_FILE_IO_TIMEOUT
        ),
    )
}

/// Async `Path::exists()` guarded by a timeout, for possibly-unreachable
/// network/WSL UNC paths. Returns `false` on timeout or OS error.
pub async fn path_exists_async(path: &Path) -> bool {
    let owned = path.to_path_buf();
    match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || owned.exists()),
    )
    .await
    {
        Ok(Ok(exists)) => exists,
        _ => false,
    }
}

/// Async `Path::is_file()` guarded by a timeout (see `path_exists_async`).
pub async fn path_is_file_async(path: &Path) -> bool {
    let owned = path.to_path_buf();
    match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || owned.is_file()),
    )
    .await
    {
        Ok(Ok(is_file)) => is_file,
        _ => false,
    }
}

/// Async `Path::is_dir()` guarded by a timeout (see `path_exists_async`).
pub async fn path_is_dir_async(path: &Path) -> bool {
    let owned = path.to_path_buf();
    match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || owned.is_dir()),
    )
    .await
    {
        Ok(Ok(is_dir)) => is_dir,
        _ => false,
    }
}

/// Async `fs::read_to_string` guarded by a timeout.
pub async fn read_to_string_async(path: &Path) -> io::Result<String> {
    let owned = path.to_path_buf();
    match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || std::fs::read_to_string(&owned)),
    )
    .await
    {
        Ok(Ok(content)) => content,
        Ok(Err(error)) => Err(error),
        Err(_) => Err(timeout_error("reading", path)),
    }
}

/// Async `fs::write` guarded by a timeout (also creates parent directories).
pub async fn write_all_async(path: &Path, content: &str) -> io::Result<()> {
    let owned = path.to_path_buf();
    let content = content.to_string();
    match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || -> io::Result<()> {
            if let Some(parent) = owned.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&owned, content)
        }),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(error),
        Err(_) => Err(timeout_error("writing", path)),
    }
}

/// Atomic variant of `write_all_async`: writes to a sibling temp file, then
/// renames over the target. A crash mid-write leaves the previous file intact
/// instead of a truncated user config. Temp file is cleaned up on failure.
/// Note: on timeout the blocking write may still land after the caller sees
/// the TimedOut error (inherent to abandon-on-timeout); callers must not
/// blindly retry without re-reading the file.
pub async fn write_all_atomic_async(path: &Path, content: &str) -> io::Result<()> {
    let owned = path.to_path_buf();
    let content = content.to_string();
    match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || -> io::Result<()> {
            if let Some(parent) = owned.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let file_name = owned
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("config");
            // Unique tmp name: two concurrent writers to the same target must
            // not share one temp path and rename each other's content.
            static TMP_COUNTER: std::sync::atomic::AtomicU64 =
                std::sync::atomic::AtomicU64::new(0);
            let seq = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let tmp_path = owned.with_file_name(format!(
                ".{file_name}.pihub-tmp-{}-{seq}",
                std::process::id()
            ));
            if let Err(error) = std::fs::write(&tmp_path, content) {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(error);
            }
            if let Err(error) = std::fs::rename(&tmp_path, &owned) {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(error);
            }
            Ok(())
        }),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(error),
        Err(_) => Err(timeout_error("writing", path)),
    }
}

/// Read a JSON object file, returning an empty object when the file is missing
/// or unreadable within the timeout. Mirrors the sync helper used in the Pi
/// module but safe for async contexts with possibly-unreachable paths.
///
/// Runs the existence check and read in a single blocking call so the hot
/// config-read path only pays one thread hop.
pub async fn read_json_object_or_empty_async(path: &Path) -> Result<Value, String> {
    let owned = path.to_path_buf();
    let content = match tokio::time::timeout(
        DEFAULT_FILE_IO_TIMEOUT,
        run_blocking(move || -> io::Result<Option<String>> {
            if !owned.exists() {
                return Ok(None);
            }
            Ok(Some(std::fs::read_to_string(&owned)?))
        }),
    )
    .await
    {
        Ok(Ok(Ok(None))) => return Ok(Value::Object(Map::new())),
        Ok(Ok(Ok(Some(content)))) => content,
        Ok(Ok(Err(error))) => {
            return Err(format!("Failed to read {}: {error}", path.display()));
        }
        Ok(Err(error)) => {
            return Err(format!("Failed to read {}: {error}", path.display()));
        }
        Err(_) => {
            return Err(format!(
                "Failed to read {}: timed out after {:?}",
                path.display(),
                DEFAULT_FILE_IO_TIMEOUT
            ));
        }
    };

    if content.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }

    let parsed: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    if parsed.is_object() {
        Ok(parsed)
    } else {
        Err(format!("{} must contain a JSON object", path.display()))
    }
}

/// Write a JSON object to `path` using the timeout-guarded writer.
pub async fn write_json_object_async(path: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err(format!(
            "{} must be written as a JSON object",
            path.display()
        ));
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    // User-facing JSON configs must be atomic: a crash mid-write must not
    // leave a truncated models.json / auth.json behind.
    write_all_atomic_async(path, &format!("{content}\n"))
        .await
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    Ok(())
}

/// Run `operation` on the blocking thread pool while holding a permit from the
/// bounded read semaphore. Returns the operation's own result unchanged.
async fn run_blocking<F, T>(operation: F) -> io::Result<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let permit = READ_SEMAPHORE.acquire().await.map_err(|_| {
        io::Error::new(io::ErrorKind::Other, "file I/O semaphore closed")
    })?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        operation()
    })
    .await
    .map_err(|join_error| io::Error::new(io::ErrorKind::Other, join_error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[tokio::test]
    async fn read_missing_file_returns_empty_json_object() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/test-file-io-missing.json");
        let value = read_json_object_or_empty_async(&path).await.unwrap();
        assert!(value.is_object());
        assert!(value.as_object().unwrap().is_empty());
    }

    #[tokio::test]
    async fn write_then_read_round_trip() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/test-file-io-roundtrip.json");
        let value = serde_json::json!({ "hello": "world", "nested": { "ok": true } });
        write_json_object_async(&path, &value).await.unwrap();
        let read_back = read_json_object_or_empty_async(&path).await.unwrap();
        assert_eq!(read_back, value);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn path_exists_returns_false_for_missing() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/definitely-not-here-xyz");
        assert!(!path_exists_async(&path).await);
    }
}
