//! Backup export/import commands.
//!
//! Export produces a consistent single-file SQLite snapshot (`ai-toolbox.db`)
//! plus a `db_manifest.json` describing the backup. Import validates the source
//! file (schema version, JSONB support) and swaps it in on next restart, keeping
//! a safety backup of the current database first.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};

use crate::db::backup::backup_to_path;
use crate::db::health::{quick_check, verify_jsonb_support};
use crate::db::migrations::{future_backup_schema_error, get_user_version, TARGET_SCHEMA_VERSION};
use crate::db::SqliteDbState;

pub const SQLITE_DATABASE_FILE: &str = "ai-toolbox.db";
pub const BACKUP_MANIFEST_FILE: &str = "db_manifest.json";

const RESTORE_INCOMING_DIR: &str = ".restore-incoming";
const RESTORE_PENDING_FLAG: &str = ".restore-pending.flag";
const RESTORE_BACKUP_DIR: &str = "sqlite-restore-backups";

#[derive(serde::Serialize, serde::Deserialize)]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub schema_version: i32,
    pub app_version: String,
    pub created_at: String,
    pub database_file: String,
}

fn now_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// Export a consistent snapshot of the SQLite database plus a manifest into
/// `target_dir`. Returns the manifest that was written.
pub fn export_database_backup_to_dir(
    state: &SqliteDbState,
    target_dir: &Path,
    app_version: &str,
) -> Result<BackupManifest, String> {
    fs::create_dir_all(target_dir).map_err(|error| {
        format!(
            "Failed to create backup directory {}: {error}",
            target_dir.display()
        )
    })?;

    let db_file = target_dir.join(SQLITE_DATABASE_FILE);
    state
        .with_conn(|conn| backup_to_path(conn, &db_file))
        .map_err(|error| format!("Failed to create database backup: {error}"))?;

    let manifest = BackupManifest {
        format: "pihub-sqlite-backup".to_string(),
        version: 1,
        schema_version: TARGET_SCHEMA_VERSION,
        app_version: app_version.to_string(),
        created_at: now_timestamp(),
        database_file: SQLITE_DATABASE_FILE.to_string(),
    };

    let manifest_path = target_dir.join(BACKUP_MANIFEST_FILE);
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize backup manifest: {error}"))?;
    fs::write(&manifest_path, manifest_json)
        .map_err(|error| format!("Failed to write backup manifest: {error}"))?;

    Ok(manifest)
}

/// Validate a source backup file: it must be a readable SQLite database with a
/// schema version not newer than the current app, and must support JSONB.
pub fn validate_backup_file(source_path: &Path) -> Result<BackupManifest, String> {
    let conn = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Cannot open backup file: {error}"))?;

    let user_version = get_user_version(&conn)?;
    if user_version > TARGET_SCHEMA_VERSION {
        return Err(future_backup_schema_error(
            user_version as i64,
            TARGET_SCHEMA_VERSION as i64,
        ));
    }

    verify_jsonb_support(&conn)?;
    quick_check(&conn)?;

    // Read manifest if present (optional: older backups may be bare db files).
    let manifest_path = source_path.with_file_name(BACKUP_MANIFEST_FILE);
    let manifest = if manifest_path.exists() {
        let content = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Failed to read backup manifest: {error}"))?;
        serde_json::from_str(&content)
            .map_err(|error| format!("Invalid backup manifest: {error}"))?
    } else {
        BackupManifest {
            format: "pihub-sqlite-backup".to_string(),
            version: 1,
            schema_version: user_version,
            app_version: String::new(),
            created_at: now_timestamp(),
            database_file: SQLITE_DATABASE_FILE.to_string(),
        }
    };

    Ok(manifest)
}

/// Stage an imported backup for swap on next restart. The current database is
/// NOT touched here; `swap_restore_pending_on_startup` performs the safe swap
/// (backup old db, then replace) before the app opens the database.
pub fn stage_restore(app_data_dir: &Path, source_path: &Path) -> Result<BackupManifest, String> {
    let manifest = validate_backup_file(source_path)?;

    let incoming_dir = app_data_dir.join(RESTORE_INCOMING_DIR);
    fs::create_dir_all(&incoming_dir)
        .map_err(|error| format!("Failed to create restore staging dir: {error}"))?;

    let staged_db = incoming_dir.join(SQLITE_DATABASE_FILE);
    fs::copy(source_path, &staged_db)
        .map_err(|error| format!("Failed to stage backup file: {error}"))?;

    let manifest_path = incoming_dir.join(BACKUP_MANIFEST_FILE);
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize backup manifest: {error}"))?;
    fs::write(&manifest_path, manifest_json)
        .map_err(|error| format!("Failed to write staged manifest: {error}"))?;

    fs::write(app_data_dir.join(RESTORE_PENDING_FLAG), "1")
        .map_err(|error| format!("Failed to write restore pending flag: {error}"))?;

    Ok(manifest)
}

/// Called before `SqliteDbState::open` at startup. If a staged restore exists,
/// back up the current database, then swap in the staged file.
/// Returns `true` if a restore was applied.
pub fn swap_restore_pending_on_startup(app_data_dir: &Path) -> Result<bool, String> {
    let flag_path = app_data_dir.join(RESTORE_PENDING_FLAG);
    if !flag_path.exists() {
        return Ok(false);
    }

    let incoming_dir = app_data_dir.join(RESTORE_INCOMING_DIR);
    let staged_db = incoming_dir.join(SQLITE_DATABASE_FILE);
    if !staged_db.exists() {
        // Incomplete staging; abort restore and keep the current database.
        let _ = fs::remove_file(&flag_path);
        return Ok(false);
    }

    let live_db = app_data_dir.join(SQLITE_DATABASE_FILE);

    // 1. Safety backup of the current database before replacement.
    let safety_backup_path = if live_db.exists() {
        let backup_dir = app_data_dir.join(RESTORE_BACKUP_DIR);
        fs::create_dir_all(&backup_dir)
            .map_err(|error| format!("Failed to create restore backup dir: {error}"))?;
        let backup_path = backup_dir.join(format!(
            "ai-toolbox-before-restore-{}.db",
            now_timestamp()
        ));
        // Open read-only to avoid touching WAL of the live db.
        match Connection::open_with_flags(&live_db, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(conn) => {
                if let Err(error) = backup_to_path(&conn, &backup_path) {
                    // Backup failed: abort restore, keep the live database and flag.
                    log::warn!("Restore aborted, failed to back up current database: {error}");
                    return Ok(false);
                }
            }
            Err(error) => {
                log::warn!("Restore aborted, cannot open current database for backup: {error}");
                return Ok(false);
            }
        }
        Some(backup_path)
    } else {
        None
    };

    // 2. Validate and stage a second copy before touching the live database.
    // This keeps the live file intact if the staged file disappears or the
    // destination volume rejects the copy.
    validate_backup_file(&staged_db)?;
    let replacement_path = app_data_dir.join(format!(".{SQLITE_DATABASE_FILE}.restore-tmp"));
    let _ = fs::remove_file(&replacement_path);
    fs::copy(&staged_db, &replacement_path)
        .map_err(|error| format!("Failed to prepare restored database: {error}"))?;

    // Drop sidecar state only after the replacement copy is known to exist.
    for suffix in ["-wal", "-shm"] {
        match fs::remove_file(format!("{}{}", live_db.display(), suffix)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                let _ = fs::remove_file(&replacement_path);
                return Err(format!("Failed to clear live database sidecar: {error}"));
            }
        }
    }

    // `fs::copy` replaces an existing file on Windows and leaves the old file
    // untouched when opening the source fails. If the final copy is partial,
    // restore the safety backup before returning the error.
    if let Err(error) = fs::copy(&replacement_path, &live_db) {
        if let Some(backup_path) = safety_backup_path.as_ref() {
            let _ = fs::copy(backup_path, &live_db);
        }
        let _ = fs::remove_file(&replacement_path);
        return Err(format!("Failed to swap restored database: {error}"));
    }
    let _ = fs::remove_file(&replacement_path);

    // 3. Clear staging.
    let _ = fs::remove_file(&flag_path);
    let _ = fs::remove_dir_all(&incoming_dir);

    Ok(true)
}
