use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Application settings
///
/// Note: This struct is no longer directly serialized to/from database.
/// Use the adapter layer (settings/adapter.rs) for all database operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub language: String,
    pub current_module: String,
    pub current_sub_tab: String,
    /// Launch on startup (default: true)
    pub launch_on_startup: bool,
    /// Minimize to tray on close instead of exiting (default: true)
    pub minimize_to_tray_on_close: bool,
    /// Start minimized to tray (default: false)
    pub start_minimized: bool,
    /// Proxy mode for network requests: "direct", "custom", or "system" (default: "system")
    pub proxy_mode: String,
    /// Proxy URL for network requests (e.g., http://user:pass@proxy.com:8080 or socks5://proxy.com:1080)
    pub proxy_url: String,
    /// Theme mode: "light", "dark", or "system" (default: "system")
    pub theme: String,
    /// Auto check for updates on startup (default: true)
    pub auto_check_update: bool,
    /// Visible tabs in the tab bar (default: all tabs shown)
    pub visible_tabs: Vec<String>,
    /// Per-page sidebar visibility preferences.
    #[serde(default = "default_sidebar_hidden_by_page")]
    pub sidebar_hidden_by_page: HashMap<String, bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AppSettingsPatch {
    pub language: Option<String>,
    pub current_module: Option<String>,
    pub current_sub_tab: Option<String>,
    pub launch_on_startup: Option<bool>,
    pub minimize_to_tray_on_close: Option<bool>,
    pub start_minimized: Option<bool>,
    pub proxy_mode: Option<String>,
    pub proxy_url: Option<String>,
    pub theme: Option<String>,
    pub auto_check_update: Option<bool>,
    pub visible_tabs: Option<Vec<String>>,
    pub sidebar_hidden_by_page: Option<HashMap<String, bool>>,
}

impl AppSettingsPatch {
    pub fn apply_to(self, settings: &mut AppSettings) {
        if let Some(value) = self.language { settings.language = value; }
        if let Some(value) = self.current_module { settings.current_module = value; }
        if let Some(value) = self.current_sub_tab { settings.current_sub_tab = value; }
        if let Some(value) = self.launch_on_startup { settings.launch_on_startup = value; }
        if let Some(value) = self.minimize_to_tray_on_close { settings.minimize_to_tray_on_close = value; }
        if let Some(value) = self.start_minimized { settings.start_minimized = value; }
        if let Some(value) = self.proxy_mode { settings.proxy_mode = value; }
        if let Some(value) = self.proxy_url { settings.proxy_url = value; }
        if let Some(value) = self.theme { settings.theme = value; }
        if let Some(value) = self.auto_check_update { settings.auto_check_update = value; }
        if let Some(value) = self.visible_tabs { settings.visible_tabs = value; }
        if let Some(value) = self.sidebar_hidden_by_page { settings.sidebar_hidden_by_page = value; }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: String::new(),
            current_module: String::new(),
            current_sub_tab: String::new(),
            launch_on_startup: true,
            minimize_to_tray_on_close: true,
            start_minimized: false,
            proxy_mode: "system".to_string(),
            proxy_url: String::new(),
            theme: "system".to_string(),
            auto_check_update: true,
            visible_tabs: vec!["pi".to_string(), "skills".to_string(), "mcp".to_string()],
            sidebar_hidden_by_page: default_sidebar_hidden_by_page(),
        }
    }
}

pub fn default_sidebar_hidden_by_page() -> HashMap<String, bool> {
    HashMap::from([("pi".to_string(), false)])
}
