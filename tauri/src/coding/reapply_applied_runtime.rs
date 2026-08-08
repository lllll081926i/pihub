//! Post-restore re-apply of DB-applied Pi prompts onto local CLI config files.
//!
//! Runs after restore when CLI runtime files were skipped or missing from the backup zip.
//! The recovery stays serial at the orchestration layer, reuses existing merge paths, and
//! suppresses per-item events so sync is not spawned concurrently during recovery.
//!
//! Important: never call public `list_*_prompts` helpers that import/temp-load from local
//! files when the DB is empty — those would pollute the restored database.

use log::{info, warn};
use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::db::helpers::db_query_by_bool;
use crate::db::schema::{DbTable, JsonFieldPath};
use crate::db::SqliteDbState;

const PER_CLI_TIMEOUT: Duration = Duration::from_secs(30);
const PATH_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const LOCAL_ID: &str = "__local__";
const REAPPLY_APPLIED_FLAG_FILENAME: &str = ".reapply-applied-flag";

#[derive(Debug, Default)]
pub struct ReapplySummary {
    pub applied: Vec<String>,
    pub warnings: Vec<String>,
    /// WSL file-mapping modules whose local runtime files were actually rewritten.
    pub changed_modules: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreReapplyMode {
    None,
    Full,
    PluginsOnly,
}

/// Select one mutually exclusive restore re-apply path.
pub fn restore_reapply_mode(need_full_reapply: bool, need_resync: bool) -> RestoreReapplyMode {
    if need_full_reapply {
        RestoreReapplyMode::Full
    } else if need_resync {
        RestoreReapplyMode::PluginsOnly
    } else {
        RestoreReapplyMode::None
    }
}

#[derive(Debug, Default)]
struct ReapplyCliResult {
    applied: Vec<String>,
    warnings: Vec<String>,
}

pub async fn reapply_applied_runtime_after_restore<R: Runtime>(
    app: &AppHandle<R>,
) -> ReapplySummary {
    let mut summary = ReapplySummary::default();

    // Runtime location cache is refreshed by the startup recovery task before this runs.
    let pi_app = app.clone();
    reapply_cli(&mut summary, "pi", async move { reapply_pi(&pi_app).await }).await;

    let _ = app.emit("config-changed", "restore-reapply");
    info!(
        "Post-restore re-apply finished: applied={}, warnings={}",
        summary.applied.len(),
        summary.warnings.len()
    );
    summary
}

/// Re-apply only the DB-applied Pi prompt configuration restored by SQLite.
/// This is used by ordinary restore resyncs.
pub async fn reapply_applied_pi_prompts_after_restore<R: Runtime>(
    app: &AppHandle<R>,
) -> ReapplySummary {
    reapply_applied_runtime_after_restore(app).await
}

async fn reapply_cli<Fut>(summary: &mut ReapplySummary, label: &str, work: Fut)
where
    Fut: Future<Output = ReapplyCliResult> + Send + 'static,
{
    // Keep the apply work in a separate task. If a synchronous filesystem call inside the
    // async apply chain stalls, the outer recovery task can still observe the timeout, abort
    // the future, and continue to the next CLI.
    let mut task = tokio::spawn(work);
    match tokio::time::timeout(PER_CLI_TIMEOUT, &mut task).await {
        Ok(Ok(result)) => {
            if !result.applied.is_empty() {
                push_unique(&mut summary.changed_modules, "pi");
            }
            summary.applied.extend(
                result
                    .applied
                    .into_iter()
                    .map(|item| format!("{label}:{item}")),
            );
            for warning_message in result.warnings {
                let message = format!("{label}: {warning_message}");
                warn!("Post-restore re-apply warning: {message}");
                summary.warnings.push(message);
            }
        }
        Ok(Err(join_error)) => {
            let message = format!("{label}: recovery task failed: {join_error}");
            warn!("Post-restore re-apply failed: {message}");
            summary.warnings.push(message);
        }
        Err(_) => {
            task.abort();
            let message = format!("{label}: timed out after {}s", PER_CLI_TIMEOUT.as_secs());
            warn!("Post-restore re-apply failed: {message}");
            summary.warnings.push(message);
        }
    }
}

fn push_unique(items: &mut Vec<String>, item: &str) {
    if !items.iter().any(|existing| existing == item) {
        items.push(item.to_string());
    }
}

/// Return the modules that a recovery-scoped full WSL sync must skip.
pub fn unchanged_wsl_modules(changed_modules: &[String]) -> Vec<String> {
    const ALL_WSL_FILE_MODULES: &[&str] = &["pi"];

    ALL_WSL_FILE_MODULES
        .iter()
        .filter(|module| !changed_modules.iter().any(|changed| changed == **module))
        .map(|module| (*module).to_string())
        .collect()
}

async fn probe_runtime_path(path: PathBuf) -> Result<(), String> {
    let display_path = path.to_string_lossy().to_string();
    let probe_task = tokio::task::spawn_blocking(move || match std::fs::symlink_metadata(&path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "runtime path is not accessible ({}): {error}",
            path.display()
        )),
    });

    match tokio::time::timeout(PATH_PROBE_TIMEOUT, probe_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(join_error)) => Err(format!(
            "runtime path probe failed ({display_path}): {join_error}"
        )),
        Err(_) => Err(format!(
            "runtime path probe timed out after {}s ({display_path})",
            PATH_PROBE_TIMEOUT.as_secs()
        )),
    }
}

fn record_id(record: &serde_json::Value) -> Option<String> {
    record
        .get("id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn record_is_disabled(record: &serde_json::Value) -> bool {
    record
        .get("is_disabled")
        .or_else(|| record.get("isDisabled"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn query_applied_records(
    db: &SqliteDbState,
    table: DbTable,
) -> Result<Vec<serde_json::Value>, String> {
    db.with_conn(|conn| {
        db_query_by_bool(
            conn,
            table,
            &JsonFieldPath::new("is_applied")?,
            true,
            None,
            None,
        )
    })
}

fn first_applied_prompt_id(db: &SqliteDbState, table: DbTable) -> Result<Option<String>, String> {
    let records = query_applied_records(db, table)?;
    Ok(records.into_iter().find_map(|record| {
        let id = record_id(&record)?;
        if id == LOCAL_ID || record_is_disabled(&record) {
            None
        } else {
            Some(id)
        }
    }))
}

fn resolve_record_id(
    result: &mut ReapplyCliResult,
    item_type: &str,
    record_result: Result<Option<String>, String>,
) -> Option<String> {
    match record_result {
        Ok(record_id) => record_id,
        Err(error) => {
            result
                .warnings
                .push(format!("failed to query applied {item_type}: {error}"));
            None
        }
    }
}

async fn apply_record<F, Fut>(
    result: &mut ReapplyCliResult,
    item_type: &str,
    record_id: Option<String>,
    apply: F,
) where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let Some(record_id) = record_id else {
        return;
    };
    match apply(record_id.clone()).await {
        Ok(()) => result.applied.push(format!("{item_type}:{record_id}")),
        Err(error) => result
            .warnings
            .push(format!("{item_type}:{record_id}: {error}")),
    }
}

async fn reapply_pi<R: Runtime>(app: &AppHandle<R>) -> ReapplyCliResult {
    use crate::coding::pi;

    let db_state = app.state::<SqliteDbState>();
    let db = db_state.db();
    let mut result = ReapplyCliResult::default();
    let prompt_id = resolve_record_id(
        &mut result,
        "prompt",
        first_applied_prompt_id(&db, DbTable::PiPromptConfig),
    );
    if prompt_id.is_none() {
        return result;
    }

    match pi::get_pi_prompt_path_async(&db).await {
        Ok(path) => {
            if let Err(error) = probe_runtime_path(path).await {
                result.warnings.push(error);
                return result;
            }
        }
        Err(error) => {
            result
                .warnings
                .push(format!("failed to resolve prompt path: {error}"));
            return result;
        }
    }

    apply_record(&mut result, "prompt", prompt_id, |prompt_id| async move {
        pi::apply_pi_prompt_config_internal_without_events(app.state(), app, &prompt_id).await
    })
    .await;
    result
}

/// Path of the post-restore re-apply flag under app data.
pub fn reapply_flag_path(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    app_data_dir.join(REAPPLY_APPLIED_FLAG_FILENAME)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_record, resolve_record_id, restore_reapply_mode, unchanged_wsl_modules,
        ReapplyCliResult, RestoreReapplyMode,
    };

    #[tokio::test]
    async fn failed_prompt_step_is_recorded() {
        let mut result = ReapplyCliResult::default();
        apply_record(
            &mut result,
            "prompt",
            Some("prompt-1".to_string()),
            |_| async { Err("prompt failed".to_string()) },
        )
        .await;

        assert!(result.applied.is_empty());
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("prompt failed"));
    }

    #[test]
    fn query_error_is_recorded_without_panicking() {
        let mut result = ReapplyCliResult::default();
        let record_id = resolve_record_id(
            &mut result,
            "prompt",
            Err("database unavailable".to_string()),
        );

        assert!(record_id.is_none());
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("database unavailable"));
    }

    #[test]
    fn full_restore_reapply_takes_precedence_over_plugin_only_reapply() {
        assert_eq!(restore_reapply_mode(true, true), RestoreReapplyMode::Full);
    }

    #[test]
    fn resync_without_full_flag_selects_plugin_only_reapply() {
        assert_eq!(
            restore_reapply_mode(false, true),
            RestoreReapplyMode::PluginsOnly
        );
        assert_eq!(restore_reapply_mode(false, false), RestoreReapplyMode::None);
    }

    #[test]
    fn recovery_wsl_sync_skips_unmodified_pi() {
        let skipped_modules = unchanged_wsl_modules(&["pi".to_string()]);
        assert!(!skipped_modules.contains(&"pi".to_string()));
        assert_eq!(unchanged_wsl_modules(&[]), vec!["pi"]);
    }
}
