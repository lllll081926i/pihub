#[allow(unused_imports)]
use tauri::{Emitter, Listener, Manager};

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use surrealdb::engine::local::SurrealKv;
use surrealdb::Surreal;
#[cfg(not(test))]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[cfg(all(test, target_os = "windows"))]
#[link(name = "resource", kind = "static")]
extern "C" {}

use log::{error, info, warn};
use simplelog::{
    ColorChoice, CombinedLogger, ConfigBuilder, LevelFilter, TermLogger, TerminalMode, WriteLogger,
};

#[cfg(target_os = "linux")]
use std::sync::Arc;
#[cfg(target_os = "linux")]
use std::sync::Mutex as StdMutex;

// Module declarations
pub mod auto_launch;
pub mod coding;
pub mod db;
pub mod db_migration;
pub mod http_client;
pub mod settings;
pub mod single_instance;
pub mod tray;
pub mod update;

// Re-export SqliteDbState for use in other modules
pub use db::SqliteDbState;
pub(crate) static APP_EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

#[cfg(not(test))]
const AI_TOOLBOX_LATEST_RELEASE_URL: &str =
    "https://github.com/lllll081926i/pihub/releases/latest";

async fn open_legacy_surreal_database(
    db_path: &Path,
) -> Result<Surreal<surrealdb::engine::local::Db>, String> {
    let db = Surreal::new::<SurrealKv>(db_path.to_path_buf())
        .await
        .map_err(|error| format!("Failed to open legacy SurrealDB database: {error}"))?;
    db.use_ns("ai_toolbox")
        .use_db("main")
        .await
        .map_err(|error| {
            format!("Failed to select legacy SurrealDB namespace/database: {error}")
        })?;
    Ok(db)
}

async fn run_one_time_legacy_database_import(
    app_handle: &tauri::AppHandle,
    paths: &db::surreal_import::MigrationPaths,
    sqlite_state: &SqliteDbState,
    startup_state: db::surreal_import::StartupMigrationState,
) -> Result<(), String> {
    #[cfg(test)]
    let _ = app_handle;

    use db::surreal_import::{
        archive_legacy_database, clear_migration_failure_state,
        import_all_known_tables_from_surreal_with_warnings, mark_sqlite_import_complete,
        record_migration_failure, write_migration_log, StartupMigrationState,
    };

    let migration_result: Result<(), String> = async {
        match startup_state {
            StartupMigrationState::NewInstall | StartupMigrationState::Ready => {
                clear_migration_failure_state(paths)?;
                return Ok(());
            }
            StartupMigrationState::NeedsLegacyArchive => {
                write_migration_log(
                    paths,
                    "Detected completed SQLite import with legacy database still present; archiving legacy database.",
                )?;
                archive_legacy_database(paths)?;
                clear_migration_failure_state(paths)?;
                return Ok(());
            }
            StartupMigrationState::IncompleteImport => {
                return Err(
                    "Startup migration state was not cleaned before opening SQLite".to_string(),
                );
            }
            StartupMigrationState::NeedsSurrealImport => {}
        }

        write_migration_log(paths, "Starting one-time SurrealDB -> SQLite import.")?;
        let legacy_db = open_legacy_surreal_database(&paths.legacy_database_dir).await?;
        db_migration::run_all_db_migrations(&legacy_db)
            .await
            .map_err(|error| {
                format!("Failed to run legacy SurrealDB migrations before SQLite import: {error}")
            })?;

        let report =
            import_all_known_tables_from_surreal_with_warnings(sqlite_state, &legacy_db, paths)
                .await?;
        write_migration_log(
            paths,
            &format!(
                "Imported {} tables and {} records from legacy SurrealDB.",
                report.tables.len(),
                report.total_records()
            ),
        )?;
        drop(legacy_db);

        mark_sqlite_import_complete(paths)?;
        archive_legacy_database(paths)?;
        clear_migration_failure_state(paths)?;
        write_migration_log(paths, "SQLite import completed successfully.")?;
        Ok(())
    }
    .await;

    if let Err(error) = migration_result {
        let failure_state = record_migration_failure(paths, &error).unwrap_or_default();
        let _ = write_migration_log(paths, &format!("Migration failed: {error}"));

        #[cfg(not(test))]
        if failure_state.consecutive_failures >= 3 {
            let message = format!(
                "数据库迁移失败，已连续失败 {} 次。\n\n迁移日志：{}\n\n错误：{}",
                failure_state.consecutive_failures,
                paths.migration_log.display(),
                error
            );
            app_handle
                .dialog()
                .message(message)
                .title("PiHub 数据库迁移失败")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
        #[cfg(test)]
        let _ = failure_state;

        return Err(error);
    }

    Ok(())
}

fn prepare_startup_migration_state(
    paths: &db::surreal_import::MigrationPaths,
) -> Result<db::surreal_import::StartupMigrationState, String> {
    use db::surreal_import::{
        cleanup_incomplete_sqlite_database, detect_startup_migration_state, write_migration_log,
        StartupMigrationState,
    };

    let startup_state = detect_startup_migration_state(paths);
    if startup_state != StartupMigrationState::IncompleteImport {
        return Ok(startup_state);
    }

    write_migration_log(
        paths,
        "Detected incomplete SQLite import; removing partial SQLite files before retry.",
    )?;
    cleanup_incomplete_sqlite_database(paths)?;
    Ok(StartupMigrationState::NeedsSurrealImport)
}

/// Set window background color (affects macOS titlebar color)
#[tauri::command]
fn set_window_background_color(window: tauri::Window, r: u8, g: u8, b: u8) -> Result<(), String> {
    use tauri::window::Color;
    window
        .set_background_color(Some(Color(r, g, b, 255)))
        .map_err(|e| format!("Failed to set background color: {}", e))
}

/// Set native window theme so the OS title bar follows the app theme
/// (Windows: DWM immersive dark mode; macOS/Linux: native dark light chrome).
/// `theme`: "dark" | "light" | null (follow system).
#[tauri::command]
fn set_window_theme(window: tauri::Window, theme: Option<String>) -> Result<(), String> {
    let resolved = match theme.as_deref() {
        Some("dark") => Some(tauri::Theme::Dark),
        Some("light") => Some(tauri::Theme::Light),
        Some("system") | None => None,
        Some(other) => return Err(format!("Unknown window theme: {other}")),
    };
    window
        .set_theme(resolved)
        .map_err(|e| format!("Failed to set window theme: {}", e))
}

/// Open a folder in the system file manager
/// If the path is a file, opens the parent directory
/// Creates the directory if it doesn't exist
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let path = Path::new(&path);

    // Determine the folder to open
    let folder = if path.is_file() {
        path.parent()
            .ok_or_else(|| "Cannot get parent directory".to_string())?
    } else {
        path
    };

    // Create directory if it doesn't exist
    if !folder.exists() {
        fs::create_dir_all(folder).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    open_folder_in_file_manager(folder)
}

/// Open an existing folder in the system file manager.
/// If the path is a file, opens the parent directory.
#[tauri::command]
fn open_existing_folder(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let folder = if path.is_file() {
        path.parent()
            .ok_or_else(|| "Cannot get parent directory".to_string())?
    } else if path.is_dir() {
        path
    } else {
        return Err(format!("Path does not exist: {}", path.display()));
    };

    open_folder_in_file_manager(folder)
}

fn open_folder_in_file_manager(folder: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// 初始化日志系统
/// debug 模式下日志输出到控制台，release 模式下写入文件
fn init_logging() -> Option<std::path::PathBuf> {
    if cfg!(debug_assertions) {
        // 开发模式：日志输出到控制台
        // 只输出本 crate 的 Debug 日志，第三方库只输出 Warn 以上
        let config = ConfigBuilder::new()
            .set_max_level(LevelFilter::Warn)
            .add_filter_allow_str("ai_toolbox")
            .build();
        if TermLogger::init(
            LevelFilter::Debug,
            config,
            TerminalMode::Mixed,
            ColorChoice::Auto,
        )
        .is_err()
        {
            eprintln!("日志系统初始化失败");
        }
        return None;
    }

    // 正式版本：日志写入安装目录 data/logs
    let log_dir = resolve_app_data_dir().map(|dir| dir.join("logs")).ok();

    let log_dir = match log_dir {
        Some(dir) => dir,
        None => return None,
    };

    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("无法创建日志目录: {}", e);
        return None;
    }

    let date = chrono::Local::now().format("%Y%m%d");
    let log_file = log_dir.join(format!("pihub_{}.log", date));

    let file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("无法打开日志文件: {}", e);
            return None;
        }
    };

    let file_config = ConfigBuilder::new()
        .set_max_level(LevelFilter::Warn)
        .add_filter_allow_str("ai_toolbox")
        .build();

    if CombinedLogger::init(vec![WriteLogger::new(LevelFilter::Info, file_config, file)]).is_err() {
        eprintln!("日志系统初始化失败");
        return None;
    }

    // 清理旧日志文件（保留最近 7 天）
    if let Ok(entries) = fs::read_dir(&log_dir) {
        let mut log_files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .file_name()
                    .map(|n| n.to_string_lossy().starts_with("pihub_"))
                    .unwrap_or(false)
            })
            .collect();

        log_files.sort_by_key(|e| std::cmp::Reverse(e.path()));

        for old_log in log_files.into_iter().skip(7) {
            let _ = fs::remove_file(old_log.path());
        }
    }

    Some(log_file)
}

/// 设置 panic hook，将 panic 信息写入日志
fn setup_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        // 记录 panic 信息到日志
        let msg = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };

        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        error!("PANIC 发生: {} at {}", msg, location);

        // 尝试将错误写入单独的崩溃日志文件
        if let Ok(log_dir) = resolve_app_data_dir().map(|dir| dir.join("logs")) {
            let crash_file = log_dir.join("CRASH.log");
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let crash_msg = format!("[{}] PANIC: {} at {}\n", timestamp, msg, location);
            let _ = std::fs::write(&crash_file, crash_msg);
        }

        // 调用默认 hook
        default_hook(panic_info);
    }));
}

#[cfg(target_os = "linux")]
fn set_env_if_missing(key: &str, value: &str) -> bool {
    if std::env::var_os(key).is_some() {
        return false;
    }
    std::env::set_var(key, value);
    true
}

#[cfg(target_os = "linux")]
fn is_wayland_session() -> bool {
    let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if session_type.eq_ignore_ascii_case("wayland") {
        return true;
    }
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn is_appimage_runtime() -> bool {
    std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some()
}

#[cfg(target_os = "linux")]
const APPIMAGE_WAYLAND_PRELOAD_APPLIED_ENV: &str = "AI_TOOLBOX_APPIMAGE_WAYLAND_PRELOAD_APPLIED";

#[cfg(target_os = "linux")]
const SYSTEM_WAYLAND_CLIENT_LIBRARY_PATHS: &[&str] = &[
    "/usr/lib64/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so.0",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0",
    "/lib64/libwayland-client.so.0",
    "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/lib/aarch64-linux-gnu/libwayland-client.so.0",
];

#[cfg(target_os = "linux")]
fn env_var_has_value(key: &str) -> bool {
    std::env::var_os(key)
        .map(|value| !value.as_os_str().is_empty())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn should_reexec_for_appimage_wayland_preload(
    workaround_disabled: bool,
    is_appimage: bool,
    is_wayland: bool,
    preload_already_applied: bool,
    ld_preload_is_set: bool,
    system_library_found: bool,
) -> bool {
    !workaround_disabled
        && is_appimage
        && is_wayland
        && !preload_already_applied
        && !ld_preload_is_set
        && system_library_found
}

#[cfg(target_os = "linux")]
fn find_system_wayland_client_library() -> Option<std::path::PathBuf> {
    SYSTEM_WAYLAND_CLIENT_LIBRARY_PATHS
        .iter()
        .map(std::path::PathBuf::from)
        .find(|path| path.is_file())
}

#[cfg(target_os = "linux")]
fn appimage_reexec_target() -> Result<std::path::PathBuf, String> {
    if let Some(appimage_path) = std::env::var_os("APPIMAGE") {
        if !appimage_path.as_os_str().is_empty() {
            let path = std::path::PathBuf::from(appimage_path);
            if path.is_file() {
                return Ok(path);
            }
            warn!(
                "APPIMAGE points to a missing file ({}); falling back to current executable",
                path.display()
            );
        }
    }

    std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))
}

/// Resolve the application data directory.
///
/// Data lives in a `data/` subdirectory next to the executable (install dir),
/// keeping all databases, logs and caches self-contained with the app. This
/// makes the app portable: the data follows the executable instead of the
/// system-wide `%APPDATA%` location.
pub fn resolve_app_data_dir() -> Result<std::path::PathBuf, String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Failed to resolve executable directory".to_string())?;
    Ok(exe_dir.join("data"))
}

#[cfg(target_os = "linux")]
fn maybe_reexec_appimage_with_system_wayland_client() {
    let workaround_disabled =
        std::env::var_os("AI_TOOLBOX_DISABLE_WAYLAND_WEBVIEW_WORKAROUND").is_some();
    let is_appimage = is_appimage_runtime();
    let is_wayland = is_wayland_session();
    let preload_already_applied = std::env::var_os(APPIMAGE_WAYLAND_PRELOAD_APPLIED_ENV).is_some();
    let ld_preload_is_set = env_var_has_value("LD_PRELOAD");
    let system_library = if !workaround_disabled
        && is_appimage
        && is_wayland
        && !preload_already_applied
        && !ld_preload_is_set
    {
        find_system_wayland_client_library()
    } else {
        None
    };

    if !should_reexec_for_appimage_wayland_preload(
        workaround_disabled,
        is_appimage,
        is_wayland,
        preload_already_applied,
        ld_preload_is_set,
        system_library.is_some(),
    ) {
        if !workaround_disabled
            && is_appimage
            && is_wayland
            && !preload_already_applied
            && !ld_preload_is_set
        {
            warn!(
                "Detected AppImage on Wayland but no system libwayland-client.so.0 was found; continuing with WebKitGTK fallback levels"
            );
        }
        return;
    }

    let Some(system_library) = system_library else {
        return;
    };
    let launch_target = match appimage_reexec_target() {
        Ok(path) => path,
        Err(error) => {
            error!(
                "Failed to prepare AppImage Wayland LD_PRELOAD re-exec: {}; continuing with WebKitGTK fallback levels",
                error
            );
            return;
        }
    };
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();

    info!(
        "Detected AppImage on Wayland; re-executing with system libwayland-client ({})",
        system_library.display()
    );

    match std::process::Command::new(&launch_target)
        .args(args)
        .env("LD_PRELOAD", &system_library)
        .env(APPIMAGE_WAYLAND_PRELOAD_APPLIED_ENV, "1")
        .spawn()
    {
        Ok(_) => {
            std::process::exit(0);
        }
        Err(error) => {
            error!(
                "Failed to re-exec AppImage with system libwayland-client ({}): {}; continuing with WebKitGTK fallback levels",
                launch_target.display(),
                error
            );
        }
    }
}

#[cfg(target_os = "linux")]
const WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL: u8 = 4;

#[cfg(target_os = "linux")]
fn wayland_webview_workaround_level_path() -> Option<std::path::PathBuf> {
    let base_dir = resolve_app_data_dir().ok()?;
    Some(
        base_dir
            .join("runtime")
            .join("wayland_webview_workaround_level"),
    )
}

#[cfg(target_os = "linux")]
fn read_wayland_webview_workaround_level() -> u8 {
    let Some(path) = wayland_webview_workaround_level_path() else {
        return 0;
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return 0;
    };
    raw.trim()
        .parse::<u8>()
        .ok()
        .map(|v| v.min(WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL))
        .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn write_wayland_webview_workaround_level(level: u8) {
    let Some(path) = wayland_webview_workaround_level_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, level.to_string());
}

#[cfg(target_os = "linux")]
fn try_acquire_single_instance_lock_with_optional_retry(
) -> Result<single_instance::SingleInstanceLock, String> {
    if std::env::var_os("AI_TOOLBOX_RESTART_WAIT_LOCK").is_none() {
        return single_instance::try_acquire_lock();
    }

    let mut last_err: Option<String> = None;
    for _ in 0..20 {
        match single_instance::try_acquire_lock() {
            Ok(lock) => return Ok(lock),
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(Duration::from_millis(150));
            }
        }
    }

    Err(last_err.unwrap_or_else(|| "Failed to acquire single instance lock".to_string()))
}

#[cfg(target_os = "linux")]
fn setup_linux_wayland_egl_failure_monitor(
    egl_failure_flag: Arc<std::sync::atomic::AtomicBool>,
) -> Arc<std::sync::atomic::AtomicBool> {
    use std::io::{Read, Write};
    use std::os::unix::io::FromRawFd;

    if std::env::var_os("AI_TOOLBOX_DISABLE_WAYLAND_WEBVIEW_WORKAROUND").is_some() {
        return egl_failure_flag;
    }

    let egl_failure_flag_clone = egl_failure_flag.clone();
    let Ok(thread_builder) = std::thread::Builder::new()
        .name("egl-stderr-monitor".to_string())
        .spawn(move || unsafe {
            let mut pipe_fds = [0; 2];
            if libc::pipe(pipe_fds.as_mut_ptr()) != 0 {
                return;
            }

            let read_fd = pipe_fds[0];
            let write_fd = pipe_fds[1];

            let original_stderr_fd = libc::dup(libc::STDERR_FILENO);
            if original_stderr_fd < 0 {
                libc::close(read_fd);
                libc::close(write_fd);
                return;
            }

            if libc::dup2(write_fd, libc::STDERR_FILENO) < 0 {
                libc::close(original_stderr_fd);
                libc::close(read_fd);
                libc::close(write_fd);
                return;
            }
            libc::close(write_fd);

            let mut original_stderr = std::fs::File::from_raw_fd(original_stderr_fd);
            let mut reader = std::fs::File::from_raw_fd(read_fd);

            let mut buf = [0u8; 4096];
            let mut carry = String::new();
            loop {
                let Ok(n) = reader.read(&mut buf) else { break };
                if n == 0 {
                    break;
                }

                let chunk = &buf[..n];
                let _ = original_stderr.write_all(chunk);
                let text = String::from_utf8_lossy(chunk);

                carry.push_str(&text);
                if carry.contains("Could not create default EGL display")
                    || carry.contains("EGL_BAD_PARAMETER")
                {
                    egl_failure_flag_clone.store(true, std::sync::atomic::Ordering::Relaxed);
                }

                if carry.len() > 4096 {
                    let keep_from = carry.len().saturating_sub(2048);
                    carry.drain(..keep_from);
                }
            }
        })
    else {
        return egl_failure_flag;
    };

    let _ = thread_builder;
    egl_failure_flag
}

#[cfg(target_os = "linux")]
fn start_linux_wayland_webview_auto_downgrade_watchdog(
    app_handle: tauri::AppHandle,
    current_level: u8,
    egl_failure_flag: Option<Arc<std::sync::atomic::AtomicBool>>,
    single_instance_lock_holder: Arc<StdMutex<Option<single_instance::SingleInstanceLock>>>,
) {
    use std::sync::atomic::Ordering;
    use tokio::sync::watch;

    let egl_failure_flag =
        egl_failure_flag.unwrap_or_else(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));

    info!(
        "Starting WebKitGTK webview auto-downgrade watchdog at level {}",
        current_level
    );

    tauri::async_runtime::spawn(async move {
        let (ready_tx, mut ready_rx) = watch::channel(false);
        let _handler = app_handle.listen("frontend-ready", move |_event| {
            let _ = ready_tx.send(true);
        });

        let timeout_secs = std::env::var("AI_TOOLBOX_FRONTEND_READY_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(20);
        let timeout = Duration::from_secs(timeout_secs);
        let start = std::time::Instant::now();

        loop {
            if *ready_rx.borrow() {
                info!("frontend-ready received; WebKitGTK webview auto-downgrade not needed");
                return;
            }

            let egl_failed = egl_failure_flag.load(Ordering::Relaxed);
            if egl_failed || start.elapsed() >= timeout {
                let next_level = if egl_failed {
                    WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL
                } else {
                    (current_level + 1).min(WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL)
                };

                if next_level <= current_level {
                    warn!(
                        "WebKitGTK webview auto-downgrade triggered but already at level {}",
                        current_level
                    );
                    return;
                }

                if egl_failed {
                    warn!(
                        "Detected EGL initialization failure; restarting with WebKitGTK webview workaround level {}",
                        next_level
                    );
                } else {
                    warn!(
                        "frontend-ready not received in {:?}; restarting with WebKitGTK webview workaround level {}",
                        timeout, next_level
                    );
                }

                write_wayland_webview_workaround_level(next_level);

                if let Ok(mut guard) = single_instance_lock_holder.lock() {
                    let _ = guard.take();
                }

                let current_exe = match std::env::current_exe() {
                    Ok(p) => p,
                    Err(e) => {
                        error!("Failed to get current executable for restart: {}", e);
                        return;
                    }
                };
                let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();

                match std::process::Command::new(&current_exe)
                    .args(args)
                    .env("AI_TOOLBOX_RESTART_WAIT_LOCK", "1")
                    .spawn()
                {
                    Ok(_) => {
                        std::process::exit(0);
                    }
                    Err(e) => {
                        error!("Failed to spawn restarted instance: {}", e);
                        return;
                    }
                }
            }

            tokio::select! {
                _ = ready_rx.changed() => {},
                _ = tokio::time::sleep(Duration::from_millis(200)) => {},
            }
        }
    });
}

/// Workaround: On some Linux environments, especially AppImage builds running on modern Wayland
/// stacks, WebKitGTK can fail to initialize GPU rendering and the webview shows a white screen.
///
/// We apply WebKitGTK GPU/DMABuf workarounds based on a fallback level:
/// - 0: Default (GPU/DMABuf enabled)
/// - 1: Disable DMABuf renderer
/// - 2: Disable GPU process
/// - 3: Disable compositing mode
/// - 4: Fallback to X11 backend (GDK_BACKEND=x11)
///
/// Notes:
/// - AppImage + Wayland first tries a one-time re-exec with system libwayland-client via
///   LD_PRELOAD, before WebKitGTK loads its bundled Wayland/EGL stack.
/// - Debug builds default to level 4 to avoid dev-time white screens.
/// - Release builds default to level 0 and may auto-downgrade on failure.
/// - Set `AI_TOOLBOX_DISABLE_WAYLAND_WEBVIEW_WORKAROUND=1` to opt out of both mitigations.
/// - Set `AI_TOOLBOX_WAYLAND_WEBVIEW_WORKAROUND_LEVEL=0..4` to override.
#[cfg(target_os = "linux")]
fn setup_linux_wayland_webview_workaround() -> u8 {
    if std::env::var_os("AI_TOOLBOX_DISABLE_WAYLAND_WEBVIEW_WORKAROUND").is_some() {
        info!(
            "WebKitGTK webview workaround disabled via AI_TOOLBOX_DISABLE_WAYLAND_WEBVIEW_WORKAROUND"
        );
        return 0;
    }

    let session_type = if is_wayland_session() {
        "Wayland"
    } else {
        "X11"
    };

    let appimage_min_level = if !cfg!(debug_assertions) && is_appimage_runtime() {
        1
    } else {
        0
    };

    let level = std::env::var("AI_TOOLBOX_WAYLAND_WEBVIEW_WORKAROUND_LEVEL")
        .ok()
        .and_then(|v| v.trim().parse::<u8>().ok())
        .map(|v| v.min(WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL))
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL
            } else {
                read_wayland_webview_workaround_level().max(appimage_min_level)
            }
        });

    if appimage_min_level > 0 && level == appimage_min_level {
        info!(
            "Detected AppImage runtime; using safer initial workaround level {}",
            appimage_min_level
        );
    }

    let mut changed = false;
    if level >= 1 {
        changed |= set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if level >= 2 {
        changed |= set_env_if_missing("WEBKIT_DISABLE_GPU_PROCESS", "1");
    }
    if level >= 3 {
        changed |= set_env_if_missing("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    if level >= 4 {
        changed |= set_env_if_missing("GDK_BACKEND", "x11");
    }

    if level == 0 {
        info!(
            "Detected {} session; WebKitGTK GPU/DMABuf is enabled (workaround level 0)",
            session_type
        );
    } else if changed {
        info!(
            "Detected {} session; applied WebKitGTK workarounds (level {}) to avoid white screen",
            session_type, level
        );
    } else {
        info!(
            "Detected {} session; WebKitGTK workarounds (level {}) already set via environment",
            session_type, level
        );
    }

    if level >= 4 {
        info!("Level 4: Falling back to X11 backend via GDK_BACKEND=x11 (requires XWayland)");
    }

    level
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志系统
    let log_file = init_logging();
    if let Some(ref path) = log_file {
        eprintln!("日志文件: {:?}", path);
    }

    // 设置 panic hook
    setup_panic_hook();

    info!("========================================");
    info!("PiHub 启动中...");
    info!("版本: {}", env!("CARGO_PKG_VERSION"));
    info!("操作系统: {}", std::env::consts::OS);
    info!("架构: {}", std::env::consts::ARCH);
    info!("========================================");

    #[cfg(target_os = "linux")]
    maybe_reexec_appimage_with_system_wayland_client();

    #[cfg(target_os = "linux")]
    let wayland_webview_workaround_level = setup_linux_wayland_webview_workaround();

    #[cfg(target_os = "linux")]
    let auto_downgrade_enabled = std::env::var_os("AI_TOOLBOX_DISABLE_WAYLAND_WEBVIEW_WORKAROUND")
        .is_none()
        && std::env::var_os("AI_TOOLBOX_WAYLAND_WEBVIEW_WORKAROUND_LEVEL").is_none()
        && wayland_webview_workaround_level < WAYLAND_WEBVIEW_WORKAROUND_MAX_LEVEL
        && (!cfg!(debug_assertions)
            || std::env::var_os("AI_TOOLBOX_ENABLE_WAYLAND_WEBVIEW_AUTO_DOWNGRADE").is_some());

    #[cfg(target_os = "linux")]
    let egl_failure_flag: Option<Arc<std::sync::atomic::AtomicBool>> = if auto_downgrade_enabled {
        Some(setup_linux_wayland_egl_failure_monitor(Arc::new(
            std::sync::atomic::AtomicBool::new(false),
        )))
    } else {
        None
    };

    // Linux: Try to acquire file-based single instance lock as fallback
    // This is needed because D-Bus based detection may not work in all environments
    #[cfg(target_os = "linux")]
    let single_instance_lock_holder: Arc<
        StdMutex<Option<single_instance::SingleInstanceLock>>,
    > = Arc::new(StdMutex::new(None));

    #[cfg(target_os = "linux")]
    {
        let lock = match try_acquire_single_instance_lock_with_optional_retry() {
            Ok(lock) => {
                info!("文件锁单实例检测成功");
                lock
            }
            Err(e) => {
                error!("单实例检测失败: {}", e);
                eprintln!("PiHub 已经在运行中。");
                eprintln!("{}", e);
                std::process::exit(1);
            }
        };

        if let Ok(mut guard) = single_instance_lock_holder.lock() {
            *guard = Some(lock);
        }
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show and focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                // macOS: Switch back to Regular mode to show in Dock
                #[cfg(target_os = "macos")]
                {
                    use tauri::ActivationPolicy;
                    let _ = app.set_activation_policy(ActivationPolicy::Regular);
                }
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(test))]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .setup(move |app| {
            info!("开始执行 setup()...");
            let app_handle = app.handle().clone();

            #[cfg(target_os = "linux")]
            if auto_downgrade_enabled {
                start_linux_wayland_webview_auto_downgrade_watchdog(
                    app_handle.clone(),
                    wayland_webview_workaround_level,
                    egl_failure_flag.clone(),
                    single_instance_lock_holder.clone(),
                );
            }

            // Create main window with platform-specific configuration
            info!("正在创建主窗口...");
            #[cfg(target_os = "macos")]
            {
                use tauri::{TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

                let _window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("PiHub")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
                    .title_bar_style(TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .visible(false)
                    .build()
                    .expect("Failed to create main window");
            }

            #[cfg(not(target_os = "macos"))]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};

                let _window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("PiHub")
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
                    .visible(false)
                    .build()
                    .expect("Failed to create main window");
            }

            // Create app data directory (install directory, self-contained)
            info!("正在获取应用数据目录...");
            let app_data_dir = match resolve_app_data_dir() {
                Ok(dir) => {
                    info!("应用数据目录: {:?}", dir);
                    dir
                }
                Err(e) => {
                    error!("无法获取应用数据目录: {}", e);
                    panic!("Failed to get app data dir: {}", e);
                }
            };

            if !app_data_dir.exists() {
                info!("创建应用数据目录...");
                if let Err(e) = fs::create_dir_all(&app_data_dir) {
                    error!("无法创建应用数据目录: {}", e);
                    panic!("Failed to create app data dir: {}", e);
                }
            }

            // Initialize preset models cache directory
            coding::preset_models::set_cache_dir(app_data_dir.clone());
            info!("预设模型缓存目录已初始化");

            // Apply any staged database restore (backup old db, then swap) before opening.
            match db::backup_commands::swap_restore_pending_on_startup(&app_data_dir) {
                Ok(true) => info!("已应用数据库备份恢复"),
                Ok(false) => {}
                Err(e) => warn!("应用数据库恢复失败，继续使用当前数据库: {}", e),
            }

            // Initialize model pricing cache directory
            db::model_pricing_seed::set_cache_dir(app_data_dir.clone());
            info!("模型定价缓存目录已初始化");

            let migration_paths = db::surreal_import::MigrationPaths::new(&app_data_dir);
            let startup_migration_state = match prepare_startup_migration_state(&migration_paths) {
                Ok(state) => state,
                Err(e) => {
                    error!("数据库迁移状态准备失败: {}", e);
                    panic!("Failed to prepare database migration state: {}", e);
                }
            };
            let sqlite_db_path = migration_paths.sqlite_database_file.clone();
            info!("正在初始化 SQLite 主数据库: {:?}", sqlite_db_path);
            let db_state = match SqliteDbState::open(sqlite_db_path) {
                Ok(state) => {
                    info!("SQLite 主数据库初始化成功");
                    state
                }
                Err(e) => {
                    error!("SQLite 主数据库初始化失败: {}", e);
                    if db::migrations::is_future_schema_error(&e) {
                        #[cfg(not(test))]
                        {
                            let message = format!(
                                "{}\n\n下载最新版：{}",
                                db::migrations::future_schema_user_message(&e),
                                AI_TOOLBOX_LATEST_RELEASE_URL
                            );
                            let exit_app_handle = app_handle.clone();
                            app_handle
                                .dialog()
                                .message(message)
                                .title("PiHub 数据库版本过新")
                                .kind(MessageDialogKind::Error)
                                .buttons(MessageDialogButtons::OkCancelCustom(
                                    "下载最新版".to_string(),
                                    "退出".to_string(),
                                ))
                                .show(move |open_latest_release| {
                                    if open_latest_release {
                                        if let Err(error) = tauri_plugin_opener::open_url(
                                            AI_TOOLBOX_LATEST_RELEASE_URL,
                                            None::<&str>,
                                        ) {
                                            error!(
                                                "打开 PiHub 最新 Release 页面失败: {}",
                                                error
                                            );
                                        }
                                    }
                                    exit_app_handle.exit(1);
                                });
                            return Ok(());
                        }
                    }
                    panic!("Failed to initialize SQLite database: {}", e);
                }
            };

            let legacy_import_result =
                tauri::async_runtime::block_on(run_one_time_legacy_database_import(
                    &app_handle,
                    &migration_paths,
                    &db_state,
                    startup_migration_state,
                ));

            if let Err(e) = legacy_import_result {
                error!("一次性旧库导入失败: {}", e);
                drop(db_state);
                if matches!(
                    startup_migration_state,
                    db::surreal_import::StartupMigrationState::NeedsSurrealImport
                        | db::surreal_import::StartupMigrationState::IncompleteImport
                ) {
                    if let Err(cleanup_error) =
                        db::surreal_import::cleanup_incomplete_sqlite_database(&migration_paths)
                    {
                        warn!("清理不完整 SQLite 数据库失败: {}", cleanup_error);
                    }
                }
                panic!("Failed to migrate legacy database into SQLite: {}", e);
            }

            tauri::async_runtime::block_on(async {
                if let Err(e) =
                    coding::runtime_location::refresh_runtime_location_cache_async(&db_state).await
                {
                    warn!("运行时路径缓存初始化失败: {}", e);
                }

                app.manage(db_state);
                info!("SQLite 主数据库状态已注册到应用");
            });

            // Create system tray
            info!("正在创建系统托盘...");
            if let Err(e) = tray::create_tray(&app_handle) {
                error!("创建系统托盘失败: {}", e);
                panic!("Failed to create system tray: {}", e);
            }
            info!("系统托盘创建成功");

            // Listen for config changes to refresh tray menu
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let value = app_handle_clone.clone();
                let value_for_closure = value.clone();
                let _listener = value.listen("config-changed", move |_event| {
                    let app = value_for_closure.app_handle().clone();
                    let _ = tauri::async_runtime::spawn(async move {
                        let _ = tray::refresh_tray_menus(&app).await;
                    });
                });

                // Keep this async block alive forever to prevent listener from being dropped
                std::future::pending::<()>().await;
            });

            // Auto update check: honor the `auto_check_update` setting, wait for the
            // frontend to attach its listeners (`frontend-ready` handshake, same pattern
            // as the Linux webview watchdog) so the `update-available` event is never
            // emitted before the UI can receive it, then run the check in the background.
            {
                let app_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    use tokio::sync::watch;

                    let (ready_tx, mut ready_rx) = watch::channel(false);
                    let _handler = app_clone.listen("frontend-ready", move |_event| {
                        let _ = ready_tx.send(true);
                    });

                    let timeout = Duration::from_secs(20);
                    let start = std::time::Instant::now();
                    loop {
                        if *ready_rx.borrow() || start.elapsed() >= timeout {
                            break;
                        }
                        tokio::select! {
                            _ = ready_rx.changed() => {}
                            _ = tokio::time::sleep(Duration::from_millis(200)) => {}
                        }
                    }

                    let db_state = app_clone.state::<crate::SqliteDbState>();
                    let auto_check =
                        settings::store::load_settings_from_sqlite_state(&db_state)
                            .map(|settings| settings.auto_check_update)
                            .unwrap_or(true);

                    if !auto_check {
                        info!("自动更新检查已关闭，跳过启动检查");
                        return;
                    }

                    match update::check_for_updates_internal(&app_clone, db_state.inner()).await {
                        Ok(result) if result.has_update => {
                            info!(
                                "发现新版本 {}（当前 {}），通知前端",
                                result.latest_version, result.current_version
                            );
                            // Match the frontend `UpdateInfo` shape (camelCase).
                            let payload = serde_json::json!({
                                "hasUpdate": result.has_update,
                                "currentVersion": result.current_version,
                                "latestVersion": result.latest_version,
                                "releaseUrl": result.release_url,
                                "releaseNotes": result.release_notes,
                                "signature": result.signature,
                                "url": result.url,
                            });
                            let _ = app_clone.emit("update-available", payload);
                        }
                        Ok(_) => {}
                        Err(e) => {
                            warn!("启动时自动更新检查失败: {}", e);
                        }
                    }
                });
            }

            // Enable auto-launch if setting is true, and handle start_minimized
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let start_minimized = {
                    let sqlite_state = app_handle_clone.state::<SqliteDbState>();
                    match settings::store::load_settings_from_sqlite_state(&sqlite_state) {
                        Ok(settings) => {
                            if settings.launch_on_startup {
                                let _ = auto_launch::re_register_auto_launch();
                            }
                            settings.start_minimized
                        }
                        Err(error) => {
                            warn!("读取启动设置失败: {}", error);
                            false
                        }
                    }
                }; // db lock released here

                // Show window unless start_minimized is enabled
                if !start_minimized {
                    if let Some(window) = app_handle_clone.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                } else {
                    // macOS: Switch to Accessory mode to hide from Dock
                    #[cfg(target_os = "macos")]
                    {
                        use tauri::ActivationPolicy;
                        let _ = app_handle_clone.set_activation_policy(ActivationPolicy::Accessory);
                    }
                }
            });

            // Git cache auto-cleanup task (checks every hour)
            {
                let app_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Initial delay before first cleanup
                    tokio::time::sleep(Duration::from_secs(5)).await;

                    loop {
                        let db_state = app_clone.state::<crate::SqliteDbState>();
                        let days =
                            coding::skills::cache_cleanup::get_git_cache_cleanup_days(&db_state)
                                .await;
                        if days > 0 {
                            let max_age = Duration::from_secs((days as u64) * 86400);
                            match coding::skills::cache_cleanup::cleanup_git_cache_dirs(
                                &app_clone, max_age,
                            ) {
                                Ok(count) if count > 0 => {
                                    info!(
                                        "Git cache auto-cleanup: removed {} expired cache(s)",
                                        count
                                    );
                                }
                                Err(e) => {
                                    warn!("Git cache auto-cleanup failed: {}", e);
                                }
                                _ => {}
                            }
                        }

                        // Check every hour
                        tokio::time::sleep(Duration::from_secs(3600)).await;
                    }
                });
            }

            // Check for re-apply flags after restore (delayed to ensure DB is ready)
            {
                let app_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Delay to ensure database is fully initialized
                    tokio::time::sleep(Duration::from_secs(3)).await;

                    let app_data_dir = match resolve_app_data_dir() {
                        Ok(dir) => dir,
                        Err(_) => return,
                    };
                    let reapply_flag =
                        coding::reapply_applied_runtime::reapply_flag_path(&app_data_dir);
                    let need_reapply = reapply_flag.exists();

                    if !need_reapply {
                        return;
                    }

                    // Remove flag first to prevent repeated loops on failure.
                    let _ = fs::remove_file(&reapply_flag);

                    info!(
                        "Post-restore flag detected (reapply={}), starting serial recovery...",
                        need_reapply
                    );

                    let db_state = app_clone.state::<crate::SqliteDbState>();
                    if let Err(e) =
                        coding::runtime_location::refresh_runtime_location_cache_async(
                            &db_state.db(),
                        )
                        .await
                    {
                        warn!("Post-restore runtime location cache refresh failed: {}", e);
                    }

                    // Re-apply applied providers/prompts before skills/MCP so MCP can write into
                    // the freshly aligned CLI configs.
                    let reapply_mode =
                        coding::reapply_applied_runtime::restore_reapply_mode(
                            need_reapply,
                            false, // need_resync is always false
                        );
                    if reapply_mode
                        != coding::reapply_applied_runtime::RestoreReapplyMode::None
                    {
                        let summary = match reapply_mode {
                            coding::reapply_applied_runtime::RestoreReapplyMode::Full
                            | coding::reapply_applied_runtime::RestoreReapplyMode::PluginsOnly => {
                                coding::reapply_applied_runtime::reapply_applied_runtime_after_restore(
                                    &app_clone,
                                )
                                .await
                            }
                            coding::reapply_applied_runtime::RestoreReapplyMode::None => {
                                unreachable!("no re-apply mode was filtered above")
                            }
                        };
                        info!(
                            "Post-restore re-apply completed: mode={:?}, applied={}, warnings={}",
                            reapply_mode,
                            summary.applied.len(),
                            summary.warnings.len(),
                        );
                        for warning in summary.warnings {
                            warn!("Post-restore re-apply warning: {}", warning);
                        }
                    }

                    // Always resync skills and MCP after re-apply
                    {
                        // Resync skills
                        match coding::skills::commands::skills_resync_all(
                            app_clone.clone(),
                            db_state.clone(),
                        )
                        .await
                        {
                            Ok(synced) => {
                                info!("Skills resync completed: {} items synced", synced.len());
                            }
                            Err(e) => {
                                warn!("Skills resync failed: {}", e);
                            }
                        }

                        // Resync MCP servers
                        match coding::mcp::commands::mcp_sync_all_without_events(
                            app_clone.clone(),
                            db_state.inner(),
                        )
                        .await
                        {
                            Ok(results) => {
                                let success_count = results.iter().filter(|r| r.success).count();
                                info!(
                                    "MCP resync completed: {}/{} succeeded",
                                    success_count,
                                    results.len()
                                );
                            }
                            Err(e) => {
                                warn!("MCP resync failed: {}", e);
                            }
                        }
                    }

                    info!("Post-restore recovery completed");
                });
            }

            info!("setup() 完成，应用即将启动");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if APP_EXIT_REQUESTED.load(Ordering::SeqCst) {
                    return;
                }

                let app_handle = window.app_handle().clone();

                // Check minimize_to_tray_on_close setting with default value.
                let minimize_to_tray = app_handle
                    .try_state::<SqliteDbState>()
                    .and_then(|sqlite_state| {
                        settings::store::load_settings_from_sqlite_state(&sqlite_state).ok()
                    })
                    .map(|settings| settings.minimize_to_tray_on_close)
                    .unwrap_or(true);

                if minimize_to_tray {
                    // Hide window instead of closing
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();

                        // macOS: Switch to Accessory mode to hide from Dock
                        #[cfg(target_os = "macos")]
                        {
                            use tauri::ActivationPolicy;
                            let _ = app_handle.set_activation_policy(ActivationPolicy::Accessory);
                        }
                    }
                    // Prevent default close behavior
                    api.prevent_close();
                }
                // If minimize_to_tray is false, do nothing - window will close normally
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Common
            open_folder,
            open_existing_folder,
            set_window_background_color,
            set_window_theme,
            // Update
            update::check_for_updates,
            update::install_update,
            // Settings
            settings::get_settings,
            settings::save_settings,
            settings::update_settings,
            settings::set_auto_launch,
            settings::get_auto_launch_status,
            settings::restart_app,
            settings::test_proxy_connection,
            settings::export_database_backup,
            settings::import_database_backup,
            settings::get_app_data_dir,
            // Preset Models
            coding::preset_models::fetch_remote_preset_models,
            coding::preset_models::load_cached_preset_models,
            coding::session_manager::list_tool_sessions,
            coding::session_manager::list_tool_session_paths,
            coding::session_manager::get_tool_session_detail,
            coding::session_manager::list_tool_session_subagents,
            coding::session_manager::get_tool_subagent_session_detail,
            coding::session_manager::delete_tool_session,
            coding::session_manager::delete_tool_sessions,
            coding::session_manager::export_tool_session,
            coding::session_manager::export_tool_sessions,
            coding::session_manager::import_tool_session,
            coding::session_manager::rename_tool_session,
            coding::all_api_hub::has_all_api_hub_extension,
            coding::all_api_hub::list_all_api_hub_providers,
            coding::all_api_hub::resolve_all_api_hub_providers,
            coding::all_api_hub::get_all_api_hub_provider_models,
            // Magic Context
            coding::magic_context::read_magic_context_config,
            coding::magic_context::save_magic_context_config,
            coding::magic_context::create_magic_context_config,
            coding::magic_context::run_magic_context_doctor,
            // Pi
            coding::pi::get_pi_root_path_info,
            coding::pi::get_pi_settings_config,
            coding::pi::save_pi_settings_config,
            coding::pi::read_pi_runtime_config,
            coding::pi::save_pi_model_settings,
            coding::pi::save_pi_other_settings,
            coding::pi::save_pi_auth_provider,
            coding::pi::save_pi_models_provider,
            coding::pi::delete_pi_runtime_provider,
            coding::pi::check_pi_providers,
            coding::pi::repair_pi_providers,
            coding::pi::list_pi_extensions,
            coding::pi::refresh_pi_extensions,
            coding::pi::fetch_provider_models,
            coding::pi::get_token_stats,
            coding::pi::refresh_token_stats,
            coding::pi::clear_token_stats_cache,
            coding::pi::install_pi_extension,
            coding::pi::uninstall_pi_extension,
            coding::pi::update_pi_extensions,
            coding::pi::list_pi_prompt_configs,
            coding::pi::create_pi_prompt_config,
            coding::pi::update_pi_prompt_config,
            coding::pi::delete_pi_prompt_config,
            coding::pi::apply_pi_prompt_config,
            coding::pi::reorder_pi_prompt_configs,
            coding::pi::save_pi_local_prompt_config,
            // Tray
            tray::refresh_tray_menu,
            // Skills Hub
            coding::skills::skills_get_tool_status,
            coding::skills::skills_get_central_repo_path,
            coding::skills::skills_set_central_repo_path,
            coding::skills::skills_get_default_central_repo_path,
            coding::skills::skills_get_central_repo_path_status,
            coding::skills::skills_preview_central_repo_path,
            coding::skills::skills_apply_central_repo_path_change,
            coding::skills::skills_scan_central_repo,
            coding::skills::skills_adopt_central_repo_skills,
            coding::skills::skills_repair_central_repo_skill,
            coding::skills::skills_get_managed_skills,
            coding::skills::skills_install_local,
            coding::skills::skills_list_local_skills,
            coding::skills::skills_install_local_selection,
            coding::skills::skills_install_git,
            coding::skills::skills_list_git_skills,
            coding::skills::skills_install_git_selection,
            coding::skills::skills_sync_to_tool,
            coding::skills::skills_unsync_from_tool,
            coding::skills::skills_update_managed,
            coding::skills::skills_delete_managed,
            coding::skills::skills_get_onboarding_plan,
            coding::skills::skills_import_existing,
            coding::skills::skills_get_git_cache_cleanup_days,
            coding::skills::skills_set_git_cache_cleanup_days,
            coding::skills::skills_get_git_cache_ttl_secs,
            coding::skills::skills_clear_git_cache,
            coding::skills::skills_get_git_cache_path,
            coding::skills::skills_get_show_in_tray,
            coding::skills::skills_set_show_in_tray,
            coding::skills::skills_get_default_view_mode,
            coding::skills::skills_set_default_view_mode,
            coding::skills::skills_get_card_columns,
            coding::skills::skills_set_card_columns,
            // Skills Hub - Custom Tools
            coding::skills::skills_get_custom_tools,
            coding::skills::skills_add_custom_tool,
            coding::skills::skills_remove_custom_tool,
            coding::skills::skills_check_custom_tool_path,
            coding::skills::skills_create_custom_tool_path,
            // Skills Hub - Skill Repos
            coding::skills::skills_get_repos,
            coding::skills::skills_add_repo,
            coding::skills::skills_remove_repo,
            coding::skills::skills_init_default_repos,
            // Skills Hub - Reorder
            coding::skills::skills_reorder,
            coding::skills::skills_get_groups,
            coding::skills::skills_save_group,
            coding::skills::skills_delete_group,
            coding::skills::skills_update_metadata,
            coding::skills::skills_batch_update_group,
            coding::skills::skills_set_management_enabled,
            coding::skills::skills_export_inventory,
            coding::skills::skills_export_inventory_file,
            coding::skills::skills_preview_inventory_import,
            coding::skills::skills_preview_inventory_import_file,
            coding::skills::skills_apply_inventory_import,
            coding::skills::skills_apply_inventory_import_file,
            // Skills Hub - Resync
            coding::skills::skills_resync_all,
            // MCP Servers
            coding::mcp::mcp_list_servers,
            coding::mcp::mcp_resolve_package_versions,
            coding::mcp::mcp_create_server,
            coding::mcp::mcp_update_server,
            coding::mcp::mcp_delete_server,
            coding::mcp::mcp_toggle_tool,
            coding::mcp::mcp_reorder_servers,
            coding::mcp::mcp_update_metadata,
            coding::mcp::mcp_sync_to_tool,
            coding::mcp::mcp_sync_all,
            coding::mcp::mcp_import_from_tool,
            coding::mcp::mcp_get_tools,
            coding::mcp::mcp_scan_servers,
            coding::mcp::mcp_get_show_in_tray,
            coding::mcp::mcp_set_show_in_tray,
            coding::mcp::mcp_get_card_columns,
            coding::mcp::mcp_set_card_columns,
            coding::mcp::mcp_add_custom_tool,
            coding::mcp::mcp_remove_custom_tool,
            // MCP Favorites
            coding::mcp::mcp_list_favorites,
            coding::mcp::mcp_upsert_favorite,
            coding::mcp::mcp_delete_favorite,
            coding::mcp::mcp_init_default_favorites,
        ])
        .build(tauri::generate_context!())
        .map_err(|e| {
            error!("构建 Tauri 应用失败: {}", e);
            e
        })
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            match event {
                // Handle macOS dock icon click when app is hidden
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    use tauri::ActivationPolicy;
                    // Switch back to Regular mode to show in Dock
                    let _ = app_handle.set_activation_policy(ActivationPolicy::Regular);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }

                _ => {}
            }

            // Avoid unused warnings on platforms where the match arms above are empty.
            let _ = app_handle;
        });
}

#[cfg(all(test, target_os = "linux"))]
mod linux_startup_tests {
    use super::*;

    #[test]
    fn appimage_wayland_preload_requires_all_conditions() {
        assert!(should_reexec_for_appimage_wayland_preload(
            false, true, true, false, false, true,
        ));

        assert!(!should_reexec_for_appimage_wayland_preload(
            true, true, true, false, false, true,
        ));
        assert!(!should_reexec_for_appimage_wayland_preload(
            false, false, true, false, false, true,
        ));
        assert!(!should_reexec_for_appimage_wayland_preload(
            false, true, false, false, false, true,
        ));
        assert!(!should_reexec_for_appimage_wayland_preload(
            false, true, true, true, false, true,
        ));
        assert!(!should_reexec_for_appimage_wayland_preload(
            false, true, true, false, true, true,
        ));
        assert!(!should_reexec_for_appimage_wayland_preload(
            false, true, true, false, false, false,
        ));
    }
}
