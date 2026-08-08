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
        }
    }
}

pub fn default_sidebar_hidden_by_page() -> HashMap<String, bool> {
    HashMap::from([("pi".to_string(), false)])
}
