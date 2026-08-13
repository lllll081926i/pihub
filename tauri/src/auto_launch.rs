//! Auto Launch Module
//!
//! Provides cross-platform auto-start functionality using the auto-launch crate.
//! - Windows: Registry (HKCU\Software\Microsoft\Windows\CurrentVersion\Run)
//! - macOS: LaunchAgent or AppleScript Login Item
//! - Linux: XDG autostart (~/.config/autostart/)

use thiserror::Error;

#[derive(Error, Debug)]
pub enum AutoLaunchError {
    #[error("Failed to get executable path: {0}")]
    ExePath(String),
    #[error("Failed to build auto launch: {0}")]
    Build(String),
    #[error("Failed to enable auto launch: {0}")]
    Enable(String),
    #[error("Failed to disable auto launch: {0}")]
    Disable(String),
    #[error("Failed to check auto launch status: {0}")]
    Check(String),
}

/// macOS: Get .app bundle path from executable path
/// Converts `/path/to/PiHub.app/Contents/MacOS/PiHub` to `/path/to/PiHub.app`
#[cfg(target_os = "macos")]
fn get_macos_app_bundle_path(exe_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let path_str = exe_path.to_string_lossy();
    // Find .app/Contents/MacOS/ pattern
    if let Some(app_pos) = path_str.find(".app/Contents/MacOS/") {
        let app_bundle_end = app_pos + 4; // End of ".app"
        Some(std::path::PathBuf::from(&path_str[..app_bundle_end]))
    } else {
        None
    }
}

/// Initialize AutoLaunch instance
fn get_auto_launch() -> Result<auto_launch::AutoLaunch, AutoLaunchError> {
    use auto_launch::AutoLaunchBuilder;

    let app_name = "PiHub";
    let exe_path = std::env::current_exe().map_err(|e| AutoLaunchError::ExePath(e.to_string()))?;

    // macOS needs .app bundle path, otherwise AppleScript login item will open terminal
    #[cfg(target_os = "macos")]
    let app_path = get_macos_app_bundle_path(&exe_path).unwrap_or(exe_path);

    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path;

    // Use AutoLaunchBuilder to eliminate platform differences
    // macOS: Uses AppleScript method (default), requires .app bundle path
    // Windows/Linux: Uses Registry/XDG autostart
    AutoLaunchBuilder::new()
        .set_app_name(app_name)
        .set_app_path(&app_path.to_string_lossy())
        .build()
        .map_err(|e| AutoLaunchError::Build(e.to_string()))
}

/// Older releases registered under the legacy app name "AI Toolbox"; the
/// auto-launch crate only manages the current app name, so the stale entry
/// survives enable/disable and keeps launching an old exe at every login.
#[cfg(target_os = "windows")]
fn remove_legacy_run_entry() {
    const LEGACY_NAME: &str = "AI Toolbox";
    let mut command = std::process::Command::new("reg");
    command.args([
        "delete",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
        "/v",
        LEGACY_NAME,
        "/f",
    ]);
    crate::coding::cli_resolver::apply_create_no_window(&mut command);
    match command.output() {
        Ok(output) if output.status.success() => {
            log::info!("已清理旧版开机自启条目: {LEGACY_NAME}");
        }
        // A missing value is the common case and reg exits non-zero for it.
        Ok(_) => {}
        Err(error) => log::warn!("清理旧版开机自启条目失败: {error}"),
    }
}

/// Enable auto launch on startup
pub fn enable_auto_launch() -> Result<(), AutoLaunchError> {
    #[cfg(target_os = "windows")]
    remove_legacy_run_entry();
    // Debug builds do not set `windows_subsystem = "windows"` (see main.rs), so
    // they are console apps: registering one for auto-start makes Windows open a
    // console window at login. Log a clear warning so developers do not mistake
    // it for a release defect. Release builds are GUI apps and never flash a
    // console. `current_exe()` below is also what lands in the Run key, so
    // launching the release build once re-points the registry entry to it.
    #[cfg(target_os = "windows")]
    if cfg!(debug_assertions) {
        log::warn!(
            "enable_auto_launch: registering a DEBUG build for auto-start; \
             the login-time console window is expected for debug binaries \
             (windows_subsystem only applies to release). Use a release build \
             if you do not want a console window at login."
        );
    }
    let auto_launch = get_auto_launch()?;
    auto_launch
        .enable()
        .map_err(|e| AutoLaunchError::Enable(e.to_string()))?;
    Ok(())
}

/// Re-register auto launch at startup so the login entry follows the current
/// exe path after updates/moves. Windows debug builds are console apps and are
/// skipped: registering one would point the Run key at the debug exe and pop a
/// console window at every login, hijacking any entry written by a release build.
pub fn re_register_auto_launch() -> Result<(), AutoLaunchError> {
    #[cfg(all(target_os = "windows", debug_assertions))]
    {
        remove_legacy_run_entry();
        log::info!("Windows debug 构建跳过开机自注重注册，避免登录项指向 debug 可执行文件");
        return Ok(());
    }
    #[cfg(not(all(target_os = "windows", debug_assertions)))]
    enable_auto_launch()
}

/// Disable auto launch on startup
pub fn disable_auto_launch() -> Result<(), AutoLaunchError> {
    #[cfg(target_os = "windows")]
    remove_legacy_run_entry();
    let auto_launch = get_auto_launch()?;
    auto_launch
        .disable()
        .map_err(|e| AutoLaunchError::Disable(e.to_string()))?;
    Ok(())
}

/// Check if auto launch is enabled
pub fn is_auto_launch_enabled() -> Result<bool, AutoLaunchError> {
    let auto_launch = get_auto_launch()?;
    auto_launch
        .is_enabled()
        .map_err(|e| AutoLaunchError::Check(e.to_string()))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::get_macos_app_bundle_path;

    #[test]
    fn test_get_macos_app_bundle_path_valid() {
        let exe_path = std::path::Path::new("/Applications/PiHub.app/Contents/MacOS/PiHub");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(
            result,
            Some(std::path::PathBuf::from("/Applications/PiHub.app"))
        );
    }

    #[test]
    fn test_get_macos_app_bundle_path_with_spaces() {
        let exe_path = std::path::Path::new("/Users/test/My Apps/PiHub.app/Contents/MacOS/PiHub");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(
            result,
            Some(std::path::PathBuf::from("/Users/test/My Apps/PiHub.app"))
        );
    }

    #[test]
    fn test_get_macos_app_bundle_path_not_in_bundle() {
        let exe_path = std::path::Path::new("/usr/local/bin/pihub");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(result, None);
    }
}
