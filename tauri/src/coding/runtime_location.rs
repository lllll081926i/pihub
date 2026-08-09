use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::coding::pi;
use crate::coding::shell_env;
use crate::db::helpers::{db_get, db_patch_fields};
use crate::db::schema::DbTable;

const MODULE_KEYS: [&str; 1] = ["pi"];

static RUNTIME_LOCATION_CACHE: LazyLock<RwLock<HashMap<&'static str, RuntimeLocationInfo>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeLocationMode {
    LocalWindows,
    WslDirect,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLocationInfo {
    pub distro: String,
    pub linux_path: String,
    pub linux_user_root: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeLocationInfo {
    pub mode: RuntimeLocationMode,
    pub source: String,
    pub host_path: PathBuf,
    pub wsl: Option<WslLocationInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDirectModuleStatus {
    pub module: String,
    pub is_wsl_direct: bool,
    pub reason: Option<String>,
    pub source_path: Option<String>,
    pub linux_path: Option<String>,
    pub linux_user_root: Option<String>,
    pub distro: Option<String>,
}

pub fn is_wsl_unc_path(path: &str) -> bool {
    let lower = path.trim().to_ascii_lowercase();
    lower.starts_with("\\\\wsl\\")
        || lower.starts_with("\\\\wsl$\\")
        || lower.starts_with("\\\\wsl.localhost\\")
}

pub fn parse_wsl_unc_path(path: &str) -> Option<WslLocationInfo> {
    let trimmed = path.trim();
    if trimmed.is_empty() || !is_wsl_unc_path(trimmed) {
        return None;
    }

    let without_prefix = trimmed.trim_start_matches('\\');
    let mut segments = without_prefix
        .split('\\')
        .filter(|segment| !segment.is_empty());
    let host = segments.next()?.to_ascii_lowercase();
    if host != "wsl" && host != "wsl$" && host != "wsl.localhost" {
        return None;
    }

    let distro = segments.next()?.to_string();
    let linux_segments: Vec<String> = segments.map(|segment| segment.to_string()).collect();
    let linux_path = if linux_segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", linux_segments.join("/"))
    };

    let linux_user_root = detect_linux_user_root(&linux_path);

    Some(WslLocationInfo {
        distro,
        linux_path,
        linux_user_root,
    })
}

fn detect_linux_user_root(linux_path: &str) -> Option<String> {
    let segments: Vec<&str> = linux_path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    if segments.len() >= 2 && segments[0] == "home" {
        return Some(format!("/home/{}", segments[1]));
    }

    if segments.first().copied() == Some("root") {
        return Some("/root".to_string());
    }

    None
}

pub fn build_windows_unc_path(distro: &str, linux_path: &str) -> PathBuf {
    let normalized_linux_path = linux_path.trim();
    let suffix = normalized_linux_path
        .trim_start_matches('/')
        .replace('/', "\\");
    if suffix.is_empty() {
        PathBuf::from(format!("\\\\wsl.localhost\\{}", distro))
    } else {
        PathBuf::from(format!("\\\\wsl.localhost\\{}\\{}", distro, suffix))
    }
}

pub fn expand_home_from_user_root(linux_user_root: Option<&str>, candidate: &str) -> String {
    if candidate == "~" {
        return linux_user_root.unwrap_or("~").to_string();
    }

    if let Some(rest) = candidate.strip_prefix("~/") {
        return match linux_user_root {
            Some(root) => format!("{}/{}", root.trim_end_matches('/'), rest),
            None => candidate.to_string(),
        };
    }

    candidate.to_string()
}

fn build_wsl_reason(_module: &str, _source_path: &str, _distro: &str) -> String {
    "wsl_direct_config_path".to_string()
}

pub fn module_status_from_location(
    module: &str,
    location: &RuntimeLocationInfo,
) -> WslDirectModuleStatus {
    match &location.wsl {
        Some(wsl) => WslDirectModuleStatus {
            module: module.to_string(),
            is_wsl_direct: true,
            reason: Some(build_wsl_reason(
                module,
                &location.host_path.to_string_lossy(),
                &wsl.distro,
            )),
            source_path: Some(location.host_path.to_string_lossy().to_string()),
            linux_path: Some(wsl.linux_path.clone()),
            linux_user_root: wsl.linux_user_root.clone(),
            distro: Some(wsl.distro.clone()),
        },
        None => WslDirectModuleStatus {
            module: module.to_string(),
            is_wsl_direct: false,
            reason: None,
            source_path: Some(location.host_path.to_string_lossy().to_string()),
            linux_path: None,
            linux_user_root: None,
            distro: None,
        },
    }
}

fn normalize_module_key(module: &str) -> Option<&'static str> {
    match module {
        "pi" => Some("pi"),
        _ => None,
    }
}

fn get_cached_runtime_location(module: &str) -> Option<RuntimeLocationInfo> {
    let module = normalize_module_key(module)?;
    RUNTIME_LOCATION_CACHE
        .read()
        .ok()
        .and_then(|cache| cache.get(module).cloned())
}

fn set_cached_runtime_location(module: &'static str, location: RuntimeLocationInfo) {
    if let Ok(mut cache) = RUNTIME_LOCATION_CACHE.write() {
        cache.insert(module, location);
    }
}

fn get_cached_or_fallback_runtime_location(module: &str) -> RuntimeLocationInfo {
    get_cached_runtime_location(module).unwrap_or_else(|| get_runtime_location_without_db(module))
}

async fn get_cached_or_refresh_runtime_location_async(
    db: &crate::db::SqliteDbState,
    module: &str,
) -> Result<RuntimeLocationInfo, String> {
    match get_cached_runtime_location(module) {
        Some(location) => Ok(location),
        None => refresh_runtime_location_cache_for_module_async(db, module).await,
    }
}

#[cfg(test)]
fn clear_runtime_location_cache() {
    if let Ok(mut cache) = RUNTIME_LOCATION_CACHE.write() {
        cache.clear();
    }
}

pub async fn refresh_runtime_location_cache_for_module_async(
    db: &crate::db::SqliteDbState,
    module: &str,
) -> Result<RuntimeLocationInfo, String> {
    match normalize_module_key(module) {
        Some("pi") => {
            let location = resolve_pi_runtime_location_uncached_async(db).await?;
            set_cached_runtime_location("pi", location.clone());
            Ok(location)
        }
        Some(_) | None => Err(format!("Unsupported runtime module: {}", module)),
    }
}

pub async fn refresh_runtime_location_cache_async(
    db: &crate::db::SqliteDbState,
) -> Result<(), String> {
    for module in MODULE_KEYS {
        refresh_runtime_location_cache_for_module_async(db, module).await?;
    }

    Ok(())
}

#[cfg(test)]
fn module_status_from_runtime_result(
    module: &str,
    runtime_result: Result<RuntimeLocationInfo, String>,
    fallback_location: &RuntimeLocationInfo,
) -> WslDirectModuleStatus {
    match runtime_result {
        Ok(location) => module_status_from_location(module, &location),
        Err(error) => {
            log::warn!(
                "Failed to resolve runtime location for module '{}' while building WSL direct status: {}. Falling back to non-database runtime resolution.",
                module,
                error
            );
            module_status_from_location(module, fallback_location)
        }
    }
}

pub fn get_pi_runtime_location_sync(
    db: &crate::db::SqliteDbState,
) -> Result<RuntimeLocationInfo, String> {
    let _ = db;
    Ok(get_cached_or_fallback_runtime_location("pi"))
}

pub async fn get_pi_runtime_location_async(
    db: &crate::db::SqliteDbState,
) -> Result<RuntimeLocationInfo, String> {
    get_cached_or_refresh_runtime_location_async(db, "pi").await
}

async fn resolve_pi_runtime_location_uncached_async(
    db: &crate::db::SqliteDbState,
) -> Result<RuntimeLocationInfo, String> {
    let path_info = normalize_stored_pi_root_dir_async(db).await?;

    let (path, source) = if let Some(path) = path_info {
        (PathBuf::from(path), "custom".to_string())
    } else {
        resolve_pi_path_without_db()
    };

    Ok(build_runtime_location(path, source))
}

async fn normalize_stored_pi_root_dir_async(
    db: &crate::db::SqliteDbState,
) -> Result<Option<String>, String> {
    let root_dir = db.with_conn(|conn| {
        let Some(record) = db_get(conn, DbTable::PiSettingsConfig, "common")? else {
            return Ok(None);
        };
        Ok(crate::coding::pi::adapter::settings_from_db_value(record)
            .root_dir
            .filter(|path| !path.trim().is_empty()))
    })?;

    let Some(root_dir) = root_dir else {
        return Ok(None);
    };

    // The layout probe may touch unreachable WSL UNC / network roots; run it
    // through the timeout-guarded async helpers instead of blocking the worker.
    let normalized_root_dir = crate::coding::pi::normalize_pi_root_dir_async(&root_dir).await;
    if normalized_root_dir != root_dir {
        // Compare-and-set: only persist the normalization if the stored value is
        // still the one we read (a concurrent `save_pi_settings_config` may have
        // updated it while the async probe was in flight).
        let normalized_clone = normalized_root_dir.clone();
        let original_root = root_dir.clone();
        let patch_result = db.with_conn(|conn| {
            let current = db_get(conn, DbTable::PiSettingsConfig, "common")?
                .map(crate::coding::pi::adapter::settings_from_db_value)
                .and_then(|value| value.root_dir)
                .unwrap_or_default();
            if current != original_root {
                return Ok(false);
            }
            db_patch_fields(
                conn,
                DbTable::PiSettingsConfig,
                "common",
                &[("root_dir", Value::String(normalized_clone))],
            )?;
            Ok(true)
        });
        match patch_result {
            Ok(true) => {}
            Ok(false) => {
                log::warn!("Skipped persisting normalized Pi root directory: value changed concurrently");
            }
            Err(error) => {
                log::warn!("Failed to persist normalized Pi root directory: {error}");
            }
        }
    }
    Ok(Some(normalized_root_dir))
}

fn get_pi_skills_path_from_location(location: &RuntimeLocationInfo) -> PathBuf {
    if let Some(wsl) = &location.wsl {
        let linux_skills_path = if location.source == "default" {
            expand_home_from_user_root(wsl.linux_user_root.as_deref(), "~/.pi/agent/skills")
        } else {
            format!("{}/skills", wsl.linux_path.trim_end_matches('/'))
        };

        build_windows_unc_path(&wsl.distro, &linux_skills_path)
    } else {
        location.host_path.join("skills")
    }
}

fn get_pi_mcp_config_path_from_location(location: &RuntimeLocationInfo) -> PathBuf {
    if let Some(wsl) = &location.wsl {
        let linux_mcp_path = if location.source == "default" {
            expand_home_from_user_root(wsl.linux_user_root.as_deref(), "~/.pi/agent/mcp.json")
        } else {
            format!("{}/mcp.json", wsl.linux_path.trim_end_matches('/'))
        };

        build_windows_unc_path(&wsl.distro, &linux_mcp_path)
    } else {
        location.host_path.join("mcp.json")
    }
}

pub fn get_tool_skills_path_sync(db: &crate::db::SqliteDbState, tool_key: &str) -> Option<PathBuf> {
    match tool_key {
        "pi" => get_pi_runtime_location_sync(db)
            .ok()
            .map(|location| get_pi_skills_path_from_location(&location)),
        _ => None,
    }
}

pub async fn get_tool_skills_path_async(
    db: &crate::db::SqliteDbState,
    tool_key: &str,
) -> Option<PathBuf> {
    match tool_key {
        "pi" => get_pi_runtime_location_async(db)
            .await
            .ok()
            .map(|location| get_pi_skills_path_from_location(&location)),
        _ => None,
    }
}

pub fn get_tool_mcp_config_path_sync(
    db: &crate::db::SqliteDbState,
    tool_key: &str,
) -> Option<PathBuf> {
    match tool_key {
        "pi" => get_pi_runtime_location_sync(db)
            .ok()
            .map(|location| get_pi_mcp_config_path_from_location(&location)),
        _ => None,
    }
}

pub async fn get_tool_mcp_config_path_async(
    db: &crate::db::SqliteDbState,
    tool_key: &str,
) -> Option<PathBuf> {
    match tool_key {
        "pi" => get_pi_runtime_location_async(db)
            .await
            .ok()
            .map(|location| get_pi_mcp_config_path_from_location(&location)),
        _ => None,
    }
}

pub fn replace_path_file_name(path: &str, file_name: &str) -> String {
    let split_index = path
        .rfind(|ch| ch == '/' || ch == '\\')
        .map(|index| index + 1)
        .unwrap_or(0);
    format!("{}{}", &path[..split_index], file_name)
}

fn build_runtime_location(path: PathBuf, source: String) -> RuntimeLocationInfo {
    let wsl = path.to_str().and_then(parse_wsl_unc_path);

    RuntimeLocationInfo {
        mode: if wsl.is_some() {
            RuntimeLocationMode::WslDirect
        } else {
            RuntimeLocationMode::LocalWindows
        },
        source,
        host_path: path,
        wsl,
    }
}

fn get_runtime_location_without_db(module: &str) -> RuntimeLocationInfo {
    let (path, source) = resolve_config_path_without_db(module);
    build_runtime_location(path, source)
}

fn resolve_config_path_without_db(module: &str) -> (PathBuf, String) {
    match module {
        "pi" => resolve_pi_path_without_db(),
        _ => (PathBuf::new(), "default".to_string()),
    }
}

fn resolve_pi_path_without_db() -> (PathBuf, String) {
    if let Ok(env_path) = std::env::var(pi::constants::PI_ENV_KEY) {
        if !env_path.trim().is_empty() {
            return (PathBuf::from(env_path), "env".to_string());
        }
    }

    if let Some(shell_path) = shell_env::get_env_from_shell_config(pi::constants::PI_ENV_KEY) {
        if !shell_path.trim().is_empty() {
            return (PathBuf::from(shell_path), "shell".to_string());
        }
    }

    (
        pi::get_pi_default_root_dir().unwrap_or_else(|_| PathBuf::from("~/.pi/agent")),
        "default".to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        clear_runtime_location_cache, expand_home_from_user_root, get_tool_mcp_config_path_async,
        get_tool_mcp_config_path_sync, get_tool_skills_path_async, get_tool_skills_path_sync,
        module_status_from_runtime_result, refresh_runtime_location_cache_for_module_async,
        replace_path_file_name, set_cached_runtime_location, RuntimeLocationInfo,
        RuntimeLocationMode, WslLocationInfo,
    };
    use crate::db::helpers::{db_get, db_put};
    use crate::db::schema::DbTable;
    use crate::db::SqliteDbState;
    use std::path::PathBuf;
    use tokio::sync::Mutex;

    static TEST_RUNTIME_LOCATION_LOCK: std::sync::LazyLock<Mutex<()>> =
        std::sync::LazyLock::new(|| Mutex::new(()));

    async fn create_test_db() -> (tempfile::TempDir, SqliteDbState) {
        let temp_dir = tempfile::tempdir().expect("create temp db dir");
        let db = SqliteDbState::in_memory_for_test().expect("open sqlite test db");
        (temp_dir, db)
    }

    /// Regression for Claude marketplace `installLocation` not being expanded.
    ///
    /// Claude CLI 2.1.126+ refuses to recognise marketplaces whose
    /// `installLocation` still contains `~`. The WSL/SSH sync paths must
    /// resolve `~` against the remote user's real `$HOME` before handing the
    /// string to `plugin_metadata_sync`. The actual substitution is delegated
    /// to `expand_home_from_user_root`, so we lock that behaviour down here.
    #[test]
    fn expand_home_from_user_root_handles_tilde_paths() {
        // Bare `~` resolves to the supplied home root.
        assert_eq!(
            expand_home_from_user_root(Some("/home/tester"), "~"),
            "/home/tester"
        );

        // `~/...` is rewritten with the real home and trailing slashes are
        // collapsed so we don't end up with `/home/tester//.claude/plugins`.
        assert_eq!(
            expand_home_from_user_root(Some("/home/tester/"), "~/.claude/plugins"),
            "/home/tester/.claude/plugins"
        );

        // Absolute paths are returned verbatim.
        assert_eq!(
            expand_home_from_user_root(Some("/home/tester"), "/etc/claude"),
            "/etc/claude"
        );

        // Without a known home root, the original `~` path is preserved so
        // callers can detect the failure (and surface a real error instead of
        // silently writing a broken `installLocation`).
        assert_eq!(
            expand_home_from_user_root(None, "~/.claude/plugins"),
            "~/.claude/plugins"
        );
    }

    #[test]
    fn replace_path_file_name_handles_unix_and_windows_paths() {
        assert_eq!(
            replace_path_file_name("~/.pi/agent/AGENTS.md", "AGENTS.override.md"),
            "~/.pi/agent/AGENTS.override.md"
        );
        assert_eq!(
            replace_path_file_name(r"C:\Users\tester\.pi\agent\AGENTS.override.md", "AGENTS.md",),
            r"C:\Users\tester\.pi\agent\AGENTS.md"
        );
    }

    #[test]
    fn runtime_result_uses_resolved_wsl_location_when_available() {
        let fallback_location = RuntimeLocationInfo {
            mode: RuntimeLocationMode::LocalWindows,
            source: "default".to_string(),
            host_path: PathBuf::from("C:\\Users\\tester\\.pi\\agent"),
            wsl: None,
        };
        let resolved_location = RuntimeLocationInfo {
            mode: RuntimeLocationMode::WslDirect,
            source: "custom".to_string(),
            host_path: PathBuf::from("\\\\wsl.localhost\\Ubuntu\\home\\tester\\.pi"),
            wsl: Some(WslLocationInfo {
                distro: "Ubuntu".to_string(),
                linux_path: "/home/tester/.pi".to_string(),
                linux_user_root: Some("/home/tester".to_string()),
            }),
        };

        let status =
            module_status_from_runtime_result("pi", Ok(resolved_location), &fallback_location);

        assert!(status.is_wsl_direct);
        assert_eq!(status.module, "pi");
        assert_eq!(status.distro.as_deref(), Some("Ubuntu"));
        assert_eq!(status.linux_path.as_deref(), Some("/home/tester/.pi"));
    }

    #[test]
    fn runtime_result_falls_back_to_non_database_location_on_error() {
        let fallback_location = RuntimeLocationInfo {
            mode: RuntimeLocationMode::LocalWindows,
            source: "default".to_string(),
            host_path: PathBuf::from("C:\\Users\\tester\\.pi\\agent"),
            wsl: None,
        };

        let status = module_status_from_runtime_result(
            "pi",
            Err("simulated db decode failure".to_string()),
            &fallback_location,
        );

        assert_eq!(status.module, "pi");
        assert!(!status.is_wsl_direct);
        assert_eq!(
            status.source_path.as_deref(),
            Some("C:\\Users\\tester\\.pi\\agent")
        );
        assert_eq!(status.reason, None);
    }

    #[tokio::test]
    async fn pi_wsl_direct_custom_root_skills_path_uses_linux_root() {
        let _guard = TEST_RUNTIME_LOCATION_LOCK.lock().await;
        clear_runtime_location_cache();
        let (_temp_dir, db) = create_test_db().await;
        let location = RuntimeLocationInfo {
            mode: RuntimeLocationMode::WslDirect,
            source: "custom".to_string(),
            host_path: PathBuf::from(r"\\wsl.localhost\Ubuntu\home\tester\custom-pi"),
            wsl: Some(WslLocationInfo {
                distro: "Ubuntu".to_string(),
                linux_path: "/home/tester/custom-pi".to_string(),
                linux_user_root: Some("/home/tester".to_string()),
            }),
        };
        set_cached_runtime_location("pi", location);

        assert_eq!(
            get_tool_skills_path_sync(&db, "pi")
                .expect("pi sync skills path")
                .to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\tester\custom-pi\skills"
        );
        assert_eq!(
            get_tool_skills_path_async(&db, "pi")
                .await
                .expect("pi async skills path")
                .to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\tester\custom-pi\skills"
        );
        assert_eq!(
            get_tool_mcp_config_path_sync(&db, "pi")
                .expect("pi sync mcp path")
                .to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\tester\custom-pi\mcp.json"
        );
        assert_eq!(
            get_tool_mcp_config_path_async(&db, "pi")
                .await
                .expect("pi async mcp path")
                .to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\tester\custom-pi\mcp.json"
        );
    }

    #[tokio::test]
    async fn pi_runtime_refresh_preserves_unconfirmed_stored_wsl_dot_pi_root() {
        let _guard = TEST_RUNTIME_LOCATION_LOCK.lock().await;
        clear_runtime_location_cache();
        let (_temp_dir, db) = create_test_db().await;
        db.with_conn(|conn| {
            db_put(
                conn,
                DbTable::PiSettingsConfig,
                "common",
                &serde_json::json!({
                    "root_dir": r"\\wsl.localhost\Ubuntu\home\tester\.pi",
                    "updated_at": "2026-01-01T00:00:00Z"
                }),
            )
        })
        .expect("save legacy Pi root");

        let location = refresh_runtime_location_cache_for_module_async(&db, "pi")
            .await
            .expect("refresh Pi runtime cache");

        assert_eq!(
            location.host_path.to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\tester\.pi"
        );
        assert_eq!(
            location.wsl.as_ref().map(|wsl| wsl.linux_path.as_str()),
            Some("/home/tester/.pi")
        );
        let stored_record = db
            .with_conn(|conn| db_get(conn, DbTable::PiSettingsConfig, "common"))
            .expect("read migrated Pi root")
            .expect("Pi settings record");
        assert_eq!(
            stored_record
                .get("root_dir")
                .and_then(serde_json::Value::as_str),
            Some(r"\\wsl.localhost\Ubuntu\home\tester\.pi")
        );
    }
}
