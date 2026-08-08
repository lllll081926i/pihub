//! System Tray Module
//!
//! Provides system tray icon and menu with flat structure:
//! - Open Main Window
//! - ─── Pi ────
//! - 默认模型 (with submenus for model selection)
//! - ─── Skills ────
//! - Skill options (with submenus for tool sync)
//! - ─── MCP Servers ───
//! - MCP server options (with submenus for tool selection)
//! - Quit

use crate::coding::mcp::tray_support as mcp_tray;
use crate::coding::pi::tray_support as pi_tray;
use crate::coding::skills::tray_support as skills_tray;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

#[derive(Clone, Copy)]
struct TrayTexts {
    show_window: &'static str,
    quit: &'static str,
    global_prompt: &'static str,
    pi_header: &'static str,
    skills_header: &'static str,
    mcp_header: &'static str,
    no_config: &'static str,
    no_model: &'static str,
    no_tools: &'static str,
}

fn is_english_language(language: &str) -> bool {
    language.eq_ignore_ascii_case("en-US") || language.to_ascii_lowercase().starts_with("en")
}

fn tray_texts(language: &str) -> TrayTexts {
    if is_english_language(language) {
        TrayTexts {
            show_window: "Open Main Window",
            quit: "Quit",
            global_prompt: "Global Prompt",
            pi_header: "Pi",
            skills_header: "Skills",
            mcp_header: "MCP Servers",
            no_config: "  No configs",
            no_model: "  No models",
            no_tools: "  No tools",
        }
    } else {
        TrayTexts {
            show_window: "打开主界面",
            quit: "退出",
            global_prompt: "全局提示词",
            pi_header: "Pi",
            skills_header: "Skills",
            mcp_header: "MCP Servers",
            no_config: "  暂无配置",
            no_model: "  暂无模型",
            no_tools: "  暂无工具",
        }
    }
}

/// Prevents concurrent refresh_tray_menus execution
static TRAY_REFRESHING: AtomicBool = AtomicBool::new(false);
/// Signals that another refresh was requested during the current one
static TRAY_REFRESH_PENDING: AtomicBool = AtomicBool::new(false);
const TRAY_SHOW_MENU_ID: &str = "show";
const TRAY_QUIT_MENU_ID: &str = "app_quit";

fn request_app_exit<R: Runtime>(app: &AppHandle<R>) {
    crate::APP_EXIT_REQUESTED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(target_os = "macos")]
use tauri::image::Image;

#[cfg(target_os = "macos")]
fn macos_tray_icon() -> Option<Image<'static>> {
    const ICON_BYTES: &[u8] = include_bytes!("../icons/tray/macos/statusbar_template@3x.png");

    match Image::from_bytes(ICON_BYTES) {
        Ok(icon) => Some(icon),
        Err(err) => {
            log::warn!("Failed to load macOS tray icon: {err}");
            None
        }
    }
}

/// 命令：刷新托盘菜单
#[tauri::command]
pub async fn refresh_tray_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    refresh_tray_menus(&app).await
}

/// Create system tray icon and menu
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let texts = tauri::async_runtime::block_on(async {
        crate::settings::commands::get_settings(app.state())
            .await
            .map(|settings| tray_texts(&settings.language))
            .unwrap_or_else(|_| tray_texts("zh-CN"))
    });

    let quit_item = MenuItem::with_id(app, TRAY_QUIT_MENU_ID, texts.quit, true, None::<&str>)?;
    let show_item = MenuItem::with_id(
        app,
        TRAY_SHOW_MENU_ID,
        texts.show_window,
        true,
        None::<&str>,
    )?;

    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let event_id = event.id().as_ref().to_string();

            if event_id == TRAY_SHOW_MENU_ID {
                // macOS: Switch back to Regular mode to show in Dock
                #[cfg(target_os = "macos")]
                {
                    use tauri::ActivationPolicy;
                    let _ = app.set_activation_policy(ActivationPolicy::Regular);
                }

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            } else if event_id == TRAY_QUIT_MENU_ID {
                request_app_exit(app);
            } else if let Some(selection) = event_id.strip_prefix("pi_model_") {
                let selection = selection.to_string();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let Some((provider_key, model_id)) = selection.split_once('/') else {
                        eprintln!("Invalid Pi model tray selection: {}", selection);
                        return;
                    };
                    if let Err(e) =
                        pi_tray::apply_pi_model(&app_handle, provider_key, model_id).await
                    {
                        eprintln!("Failed to apply Pi model: {}", e);
                    }
                    let _ = refresh_tray_menus(&app_handle).await;
                });
            } else if let Some(config_id) = event_id.strip_prefix("pi_prompt_") {
                let config_id = config_id.to_string();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = pi_tray::apply_pi_prompt_config(&app_handle, &config_id).await {
                        eprintln!("Failed to apply Pi prompt config: {}", e);
                    }
                    let _ = refresh_tray_menus(&app_handle).await;
                });
            } else if let Some(remaining) = event_id.strip_prefix("skill_tool_") {
                // Parse: skill_tool_{skill_id}\x01{tool_key}
                if let Some(sep_pos) = remaining.find('\x01') {
                    let skill_id = remaining[..sep_pos].to_string();
                    let tool_key = remaining[sep_pos + 1..].to_string();
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) =
                            skills_tray::apply_skills_tool_toggle(&app_handle, &skill_id, &tool_key)
                                .await
                        {
                            eprintln!("Failed to toggle skill tool: {}", e);
                        }
                        let _ = refresh_tray_menus(&app_handle).await;
                    });
                }
            } else if let Some(remaining) = event_id.strip_prefix("mcp_tool_") {
                // Parse: mcp_tool_{server_id}\x01{tool_key}
                if let Some(sep_pos) = remaining.find('\x01') {
                    let server_id = remaining[..sep_pos].to_string();
                    let tool_key = remaining[sep_pos + 1..].to_string();
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) =
                            mcp_tray::apply_mcp_tool_toggle(&app_handle, &server_id, &tool_key)
                                .await
                        {
                            eprintln!("Failed to toggle MCP tool: {}", e);
                        }
                        let _ = refresh_tray_menus(&app_handle).await;
                    });
                }
            }
        })
        // macOS: 左键点击也显示菜单（与右键行为一致）
        .show_menu_on_left_click(true);

    #[cfg(target_os = "macos")]
    {
        if let Some(icon) = macos_tray_icon() {
            tray_builder = tray_builder.icon(icon).icon_as_template(true);
        } else if let Some(icon) = app.default_window_icon() {
            log::warn!("Falling back to default window icon for tray");
            tray_builder = tray_builder.icon(icon.clone());
        } else {
            log::warn!("Failed to load macOS tray icon for tray");
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(icon) = app.default_window_icon() {
            tray_builder = tray_builder.icon(icon.clone());
        } else {
            log::warn!("Failed to get default window icon for tray");
        }
    }

    let _tray = tray_builder.build(app)?;

    // Store tray in app state for later updates
    app.manage(_tray);

    // Initial menu refresh
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = refresh_tray_menus(&app_clone).await;
    });

    Ok(())
}

/// Refresh tray menus with deduplication (coalescing pattern)
pub async fn refresh_tray_menus<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // If already refreshing, mark pending and return
    if TRAY_REFRESHING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        TRAY_REFRESH_PENDING.store(true, Ordering::SeqCst);
        return Ok(());
    }

    loop {
        TRAY_REFRESH_PENDING.store(false, Ordering::SeqCst);
        let result = refresh_tray_menus_inner(app).await;

        if !TRAY_REFRESH_PENDING.load(Ordering::SeqCst) {
            TRAY_REFRESHING.store(false, Ordering::SeqCst);
            return result;
        }
        // A new request came in during refresh, loop once more
    }
}

/// Refresh tray menus with flat structure
async fn refresh_tray_menus_inner<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let (visible_tabs, texts) = match crate::settings::commands::get_settings(app.state()).await {
        Ok(settings) => (settings.visible_tabs, tray_texts(&settings.language)),
        Err(err) => {
            log::warn!("Failed to read settings for tray visibility: {err}");
            (
                vec!["pi".to_string(), "skills".to_string(), "mcp".to_string()],
                tray_texts("zh-CN"),
            )
        }
    };

    let is_tab_visible = |tab: &str| visible_tabs.iter().any(|item| item == tab);

    // Check if modules are enabled
    let pi_enabled = is_tab_visible("pi");
    let skills_enabled = skills_tray::is_skills_enabled_for_tray(app).await;
    let mcp_enabled = mcp_tray::is_mcp_enabled_for_tray(app).await;

    // Get data from modules (only if enabled)
    let pi_data = if pi_enabled {
        pi_tray::get_pi_tray_data(app).await?
    } else {
        pi_tray::TrayModelData {
            title: "默认模型".to_string(),
            current_display: String::new(),
            items: vec![],
        }
    };

    let mut pi_prompt_data = if pi_enabled {
        pi_tray::get_pi_prompt_tray_data(app).await?
    } else {
        pi_tray::TrayPromptData {
            title: texts.global_prompt.to_string(),
            current_display: String::new(),
            items: vec![],
        }
    };
    pi_prompt_data.title = texts.global_prompt.to_string();

    let mut skills_data = if skills_enabled {
        skills_tray::get_skills_tray_data(app).await?
    } else {
        skills_tray::TraySkillData {
            title: texts.skills_header.to_string(),
            items: vec![],
        }
    };
    skills_data.title = texts.skills_header.to_string();

    let mut mcp_data = if mcp_enabled {
        mcp_tray::get_mcp_tray_data(app).await?
    } else {
        mcp_tray::TrayMcpData {
            title: texts.mcp_header.to_string(),
            items: vec![],
        }
    };
    mcp_data.title = texts.mcp_header.to_string();

    // Check if modules have items
    let pi_has_items = pi_enabled && !pi_data.items.is_empty();
    let pi_has_prompt_items = pi_enabled && !pi_prompt_data.items.is_empty();
    let pi_has_section = pi_enabled && (pi_has_items || pi_has_prompt_items);
    let skills_has_items = skills_enabled && !skills_data.items.is_empty();
    let mcp_has_items = mcp_enabled && !mcp_data.items.is_empty();

    let pi_prompt_submenu = if pi_has_prompt_items {
        Some(build_named_prompt_submenu(
            app,
            "pi",
            &pi_prompt_data,
            texts,
        )?)
    } else {
        None
    };

    // Build flat menu - all menu items created in same scope to ensure valid lifetime
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_MENU_ID, texts.quit, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let show_item = MenuItem::with_id(
        app,
        TRAY_SHOW_MENU_ID,
        texts.show_window,
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let pi_header = if pi_has_section {
        Some(
            MenuItem::with_id(app, "pi_header", texts.pi_header, false, None::<&str>)
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    let pi_model_submenu = if pi_has_items {
        Some(build_pi_model_submenu(app, &pi_data, texts)?)
    } else {
        None
    };

    // Skills section (only if enabled)
    let skills_header = if skills_has_items {
        Some(
            MenuItem::with_id(
                app,
                "skills_header",
                &skills_data.title,
                false,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    // Build Skills submenus - each skill gets a submenu with tools as CheckMenuItems
    let mut skills_submenus: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
    if skills_has_items {
        for skill in skills_data.items {
            let skill_submenu = build_skill_submenu(app, &skill, texts)?;
            let boxed: Box<dyn tauri::menu::IsMenuItem<R>> = Box::new(skill_submenu);
            skills_submenus.push(boxed);
        }
    }

    // MCP section (only if enabled)
    let mcp_header = if mcp_has_items {
        Some(
            MenuItem::with_id(app, "mcp_header", &mcp_data.title, false, None::<&str>)
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    // Build MCP submenus - each server gets a submenu with tools as CheckMenuItems
    let mut mcp_submenus: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
    if mcp_has_items {
        for server in mcp_data.items {
            let mcp_submenu = build_mcp_submenu(app, &server, texts)?;
            let boxed: Box<dyn tauri::menu::IsMenuItem<R>> = Box::new(mcp_submenu);
            mcp_submenus.push(boxed);
        }
    }

    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    let append_separator = |menu: &Menu<R>| -> Result<(), String> {
        let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
        menu.append(&separator).map_err(|e| e.to_string())
    };

    menu.append(&show_item).map_err(|e| e.to_string())?;
    append_separator(&menu)?;

    // Add Pi section if enabled
    if pi_has_section {
        if let Some(ref header) = pi_header {
            menu.append(header).map_err(|e| e.to_string())?;
        }
        if let Some(ref submenu) = pi_model_submenu {
            menu.append(submenu).map_err(|e| e.to_string())?;
        }
        if let Some(ref submenu) = pi_prompt_submenu {
            menu.append(submenu).map_err(|e| e.to_string())?;
        }
        append_separator(&menu)?;
    }

    // Add Skills section if enabled
    if skills_has_items {
        if let Some(ref header) = skills_header {
            menu.append(header).map_err(|e| e.to_string())?;
        }
        for item in &skills_submenus {
            menu.append(item.as_ref()).map_err(|e| e.to_string())?;
        }
        append_separator(&menu)?;
    }

    // Add MCP section if enabled
    if mcp_has_items {
        if let Some(ref header) = mcp_header {
            menu.append(header).map_err(|e| e.to_string())?;
        }
        for item in &mcp_submenus {
            menu.append(item.as_ref()).map_err(|e| e.to_string())?;
        }
        append_separator(&menu)?;
    }

    menu.append(&quit_item).map_err(|e| e.to_string())?;

    // Update tray menu
    let tray = app.state::<tauri::tray::TrayIcon>();
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;

    Ok(())
}

fn build_pi_model_submenu<R: Runtime>(
    app: &AppHandle<R>,
    data: &pi_tray::TrayModelData,
    texts: TrayTexts,
) -> Result<Submenu<R>, String> {
    let title = if data.current_display.is_empty() {
        data.title.clone()
    } else {
        format!("{} ({})", data.title, data.current_display)
    };
    let submenu =
        Submenu::with_id(app, "pi_model_submenu", &title, true).map_err(|e| e.to_string())?;

    if data.items.is_empty() {
        let empty_item =
            MenuItem::with_id(app, "pi_model_empty", texts.no_model, false, None::<&str>)
                .map_err(|e| e.to_string())?;
        submenu.append(&empty_item).map_err(|e| e.to_string())?;
        return Ok(submenu);
    }

    let mut provider_map: std::collections::HashMap<
        String,
        (String, Vec<&pi_tray::TrayModelItem>),
    > = std::collections::HashMap::new();

    for item in &data.items {
        let provider_id = item.id.split('/').next().unwrap_or(&item.id).to_string();
        let provider_label = item
            .display_name
            .split(" / ")
            .next()
            .unwrap_or(&provider_id)
            .to_string();
        let entry = provider_map
            .entry(provider_id)
            .or_insert_with(|| (provider_label, Vec::new()));
        entry.1.push(item);
    }

    let mut providers: Vec<(String, String, Vec<&pi_tray::TrayModelItem>)> = provider_map
        .into_iter()
        .map(|(provider_id, (provider_label, items))| (provider_id, provider_label, items))
        .collect();
    providers.sort_by(|a, b| a.1.cmp(&b.1));

    for (provider_id, provider_label, mut items) in providers {
        items.sort_by(|a, b| {
            let a_model = a
                .display_name
                .split(" / ")
                .nth(1)
                .unwrap_or(&a.display_name);
            let b_model = b
                .display_name
                .split(" / ")
                .nth(1)
                .unwrap_or(&b.display_name);
            a_model.cmp(b_model)
        });

        let safe_provider_id: String = provider_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();

        let provider_submenu = Submenu::with_id(
            app,
            format!("pi_provider_{}_submenu", safe_provider_id),
            &provider_label,
            true,
        )
        .map_err(|e| e.to_string())?;

        for item in &items {
            let item_id = format!("pi_model_{}", item.id);
            let model_label = item
                .display_name
                .split(" / ")
                .nth(1)
                .unwrap_or(&item.display_name);
            let menu_item = CheckMenuItem::with_id(
                app,
                &item_id,
                model_label,
                !item.is_disabled,
                item.is_selected,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            provider_submenu
                .append(&menu_item)
                .map_err(|e| e.to_string())?;
        }

        submenu
            .append(&provider_submenu)
            .map_err(|e| e.to_string())?;
    }

    Ok(submenu)
}

fn build_named_prompt_submenu<R: Runtime>(
    app: &AppHandle<R>,
    prefix: &str,
    data: &impl NamedPromptTrayData,
    texts: TrayTexts,
) -> Result<Submenu<R>, String> {
    let title = if data.current_display().is_empty() {
        data.title().to_string()
    } else {
        format!("{} ({})", data.title(), data.current_display())
    };
    let submenu = Submenu::with_id(app, format!("{}_prompt_submenu", prefix), &title, true)
        .map_err(|e| e.to_string())?;

    if data.items().is_empty() {
        let empty_item = MenuItem::with_id(
            app,
            format!("{}_prompt_empty", prefix),
            texts.no_config,
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu.append(&empty_item).map_err(|e| e.to_string())?;
    } else {
        for item in data.items() {
            let item_id = format!("{}_prompt_{}", prefix, item.id());
            let menu_item = CheckMenuItem::with_id(
                app,
                &item_id,
                item.display_name(),
                true,
                item.is_selected(),
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            submenu.append(&menu_item).map_err(|e| e.to_string())?;
        }
    }

    Ok(submenu)
}

trait NamedPromptTrayItem {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn is_selected(&self) -> bool;
}

trait NamedPromptTrayData {
    type Item: NamedPromptTrayItem;

    fn title(&self) -> &str;
    fn current_display(&self) -> &str;
    fn items(&self) -> &[Self::Item];
}

impl NamedPromptTrayItem for pi_tray::TrayPromptItem {
    fn id(&self) -> &str {
        &self.id
    }

    fn display_name(&self) -> &str {
        &self.display_name
    }

    fn is_selected(&self) -> bool {
        self.is_selected
    }
}

impl NamedPromptTrayData for pi_tray::TrayPromptData {
    type Item = pi_tray::TrayPromptItem;

    fn title(&self) -> &str {
        &self.title
    }

    fn current_display(&self) -> &str {
        &self.current_display
    }

    fn items(&self) -> &[Self::Item] {
        &self.items
    }
}

/// Build a skill submenu with tool checkmarks
fn build_skill_submenu<R: Runtime>(
    app: &AppHandle<R>,
    skill: &skills_tray::TraySkillItem,
    texts: TrayTexts,
) -> Result<Submenu<R>, String> {
    let submenu_id = format!("skill_{}", skill.id);
    let submenu =
        Submenu::with_id(app, &submenu_id, &skill.display_name, true).map_err(|e| e.to_string())?;

    if skill.tools.is_empty() {
        let empty_item = MenuItem::with_id(
            app,
            &format!("skill_{}_empty", skill.id),
            texts.no_tools,
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu.append(&empty_item).map_err(|e| e.to_string())?;
    } else {
        for tool in &skill.tools {
            let item_id = format!("skill_tool_{}\x01{}", skill.id, tool.tool_key);
            let menu_item = CheckMenuItem::with_id(
                app,
                &item_id,
                &tool.display_name,
                tool.is_installed, // enabled only if tool is installed
                tool.is_synced,    // checked if synced
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            submenu.append(&menu_item).map_err(|e| e.to_string())?;
        }
    }

    Ok(submenu)
}

/// Build an MCP server submenu with tool checkmarks
fn build_mcp_submenu<R: Runtime>(
    app: &AppHandle<R>,
    server: &mcp_tray::TrayMcpServerItem,
    texts: TrayTexts,
) -> Result<Submenu<R>, String> {
    let submenu_id = format!("mcp_{}", server.id);
    let submenu = Submenu::with_id(app, &submenu_id, &server.display_name, true)
        .map_err(|e| e.to_string())?;

    if server.tools.is_empty() {
        let empty_item = MenuItem::with_id(
            app,
            &format!("mcp_{}_empty", server.id),
            texts.no_tools,
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu.append(&empty_item).map_err(|e| e.to_string())?;
    } else {
        for tool in &server.tools {
            let item_id = format!("mcp_tool_{}\x01{}", server.id, tool.tool_key);
            let menu_item = CheckMenuItem::with_id(
                app,
                &item_id,
                &tool.display_name,
                tool.is_installed, // enabled only if tool is installed
                tool.is_enabled,   // checked if enabled
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            submenu.append(&menu_item).map_err(|e| e.to_string())?;
        }
    }

    Ok(submenu)
}
