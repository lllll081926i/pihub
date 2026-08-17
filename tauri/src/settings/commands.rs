use super::store;
use super::types::{AppSettings, AppSettingsPatch};
use crate::auto_launch;
use crate::db::SqliteDbState;
use crate::tray;

/// Get settings from database using adapter layer for fault tolerance
#[tauri::command]
pub async fn get_settings(
    sqlite_state: tauri::State<'_, SqliteDbState>,
) -> Result<AppSettings, String> {
    store::load_settings_from_sqlite_state(&sqlite_state)
}

/// Save settings to database using adapter layer.
#[tauri::command]
pub async fn save_settings(
    sqlite_state: tauri::State<'_, SqliteDbState>,
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    store::save_settings_to_sqlite_state(&sqlite_state, &settings)?;

    if let Err(err) = tray::refresh_tray_menus(&app).await {
        log::warn!("Failed to refresh tray after saving settings: {err}");
    }

    Ok(())
}

/// Atomically update only the supplied fields so independent UI actions do
/// not overwrite one another with stale full-record snapshots.
#[tauri::command]
pub async fn update_settings(
    sqlite_state: tauri::State<'_, SqliteDbState>,
    app: tauri::AppHandle,
    updates: AppSettingsPatch,
) -> Result<AppSettings, String> {
    let updated = sqlite_state.with_conn(|conn| {
        let mut settings = store::load_settings_from_sqlite_conn(conn)?;
        updates.apply_to(&mut settings);
        store::save_settings_to_sqlite_conn(conn, &settings)?;
        Ok(settings)
    })?;

    if let Err(err) = tray::refresh_tray_menus(&app).await {
        log::warn!("Failed to refresh tray after updating settings: {err}");
    }
    Ok(updated)
}

/// Set auto launch on startup
#[tauri::command]
pub async fn set_auto_launch(
    sqlite_state: tauri::State<'_, SqliteDbState>,
    enabled: bool,
) -> Result<(), String> {
    // Persist the DB flag FIRST: the startup re-register task in lib.rs
    // replays the DB value into the registry, so the DB must already hold the
    // new value before the registry is touched. A later registry failure then
    // self-heals on next launch instead of resurrecting a stale entry.
    let mut settings = store::load_settings_from_sqlite_state(&sqlite_state)?;
    let previous_enabled = settings.launch_on_startup;
    if settings.launch_on_startup != enabled {
        settings.launch_on_startup = enabled;
        store::save_settings_to_sqlite_state(&sqlite_state, &settings)?;
    }

    // Registry mutations block on `reg` CLI calls; keep them off the tokio
    // worker threads.
    let operation = tokio::task::spawn_blocking(move || {
        if enabled {
            auto_launch::enable_auto_launch()
                .map_err(|e| format!("Failed to enable auto launch: {}", e))
        } else {
            auto_launch::disable_auto_launch()
                .map_err(|e| format!("Failed to disable auto launch: {}", e))
        }
    })
    .await
    .map_err(|e| format!("Auto launch task failed: {e}"))?;
    if let Err(error) = operation {
        let actual_enabled = auto_launch::is_auto_launch_enabled().unwrap_or(previous_enabled);
        let mut persisted = store::load_settings_from_sqlite_state(&sqlite_state)?;
        persisted.launch_on_startup = actual_enabled;
        store::save_settings_to_sqlite_state(&sqlite_state, &persisted)?;
        return Err(error);
    }
    Ok(())
}

/// Get the application data directory (exe sibling `data/` folder).
#[tauri::command]
pub fn get_app_data_dir() -> Result<String, String> {
    crate::resolve_app_data_dir().map(|path| path.to_string_lossy().to_string())
}

/// Get auto launch status
#[tauri::command]
pub fn get_auto_launch_status() -> Result<bool, String> {
    auto_launch::is_auto_launch_enabled()
        .map_err(|e| format!("Failed to check auto launch status: {}", e))
}

/// Restart the application
#[tauri::command]
pub fn restart_app() -> Result<(), String> {
    // Get the current executable path
    let current_exe =
        std::env::current_exe().map_err(|e| format!("Failed to get current executable: {}", e))?;

    // Spawn a new instance and exit the current one
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // Use cmd /c start to spawn a new process and return immediately;
        // CREATE_NO_WINDOW prevents a flash cmd console from the GUI host.
        let mut command = Command::new("cmd");
        command.args(["/c", "start", "", current_exe.to_string_lossy().as_ref()]);
        crate::coding::cli_resolver::apply_create_no_window(&mut command);
        command
            .spawn()
            .map_err(|e| format!("Failed to spawn new process: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // On macOS, we need to open the .app bundle, not the binary directly.
        // The binary is at: /path/to/App.app/Contents/MacOS/binary
        // We need to get: /path/to/App.app
        let app_bundle = current_exe
            .parent() // Contents/MacOS
            .and_then(|p| p.parent()) // Contents
            .and_then(|p| p.parent()); // App.app

        match app_bundle {
            Some(bundle_path) if bundle_path.extension().map_or(false, |ext| ext == "app") => {
                Command::new("open")
                    .arg("-n") // Open a new instance
                    .arg(bundle_path)
                    .spawn()
                    .map_err(|e| format!("Failed to spawn new process: {}", e))?;
            }
            _ => {
                // Fallback: if not in a bundle, just run the binary directly
                Command::new(&current_exe)
                    .spawn()
                    .map_err(|e| format!("Failed to spawn new process: {}", e))?;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
        Command::new(&current_exe)
            .args(args)
            .env("AI_TOOLBOX_RESTART_WAIT_LOCK", "1")
            .spawn()
            .map_err(|e| format!("Failed to spawn new process: {}", e))?;
    }

    // Exit the current instance
    std::process::exit(0);
}

/// Test proxy connection
#[tauri::command]
pub async fn test_proxy_connection(proxy_url: String) -> Result<(), String> {
    crate::http_client::test_proxy(&proxy_url).await
}

/// Export the SQLite database plus manifest to `target_dir`.
#[tauri::command]
pub async fn export_database_backup(
    sqlite_state: tauri::State<'_, SqliteDbState>,
    app: tauri::AppHandle,
    target_dir: String,
) -> Result<String, String> {
    let app_version = app.package_info().version.to_string();
    let db = sqlite_state.inner().clone();
    let manifest = tokio::task::spawn_blocking(move || {
        crate::db::backup_commands::export_database_backup_to_dir(
            &db,
            std::path::Path::new(&target_dir),
            &app_version,
        )
    })
    .await
    .map_err(|error| format!("Backup export task failed: {error}"))??;
    serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize backup manifest: {error}"))
}

/// Validate a backup file and stage it for swap on next restart.
#[tauri::command]
pub async fn import_database_backup(
    source_db: String,
) -> Result<String, String> {
    let app_data_dir = crate::resolve_app_data_dir()?;
    let manifest = tokio::task::spawn_blocking(move || {
        crate::db::backup_commands::stage_restore(
            &app_data_dir,
            std::path::Path::new(&source_db),
        )
    })
    .await
    .map_err(|error| format!("Backup import task failed: {error}"))??;
    serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize backup manifest: {error}"))
}
