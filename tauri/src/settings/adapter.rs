use super::types::AppSettings;
use serde_json::Value;
use std::collections::HashMap;

/// Convert database JSON Value to AppSettings with fault tolerance
pub fn from_db_value(value: Value) -> AppSettings {
    AppSettings {
        language: get_str(&value, "language", "zh-CN"),
        current_module: get_str(&value, "current_module", "coding"),
        current_sub_tab: get_str(&value, "current_sub_tab", "pi"),
        launch_on_startup: get_bool(&value, "launch_on_startup", true),
        minimize_to_tray_on_close: get_bool(&value, "minimize_to_tray_on_close", true),
        start_minimized: get_bool(&value, "start_minimized", false),
        proxy_mode: get_str(&value, "proxy_mode", "system"),
        proxy_url: get_str(&value, "proxy_url", ""),
        theme: get_str(&value, "theme", "system"),
        auto_check_update: get_bool(&value, "auto_check_update", true),
        visible_tabs: get_string_array(&value, "visible_tabs", &["pi", "skills", "mcp"]),
        sidebar_hidden_by_page: get_bool_map(&value, "sidebar_hidden_by_page"),
    }
}

/// Convert AppSettings to database JSON Value
pub fn to_db_value(settings: &AppSettings) -> Value {
    serde_json::json!({
        "language": settings.language,
        "current_module": settings.current_module,
        "current_sub_tab": settings.current_sub_tab,
        "launch_on_startup": settings.launch_on_startup,
        "minimize_to_tray_on_close": settings.minimize_to_tray_on_close,
        "start_minimized": settings.start_minimized,
        "proxy_mode": settings.proxy_mode,
        "proxy_url": settings.proxy_url,
        "theme": settings.theme,
        "auto_check_update": settings.auto_check_update,
        "visible_tabs": settings.visible_tabs,
        "sidebar_hidden_by_page": settings.sidebar_hidden_by_page,
    })
}

fn get_bool_map(value: &Value, key: &str) -> HashMap<String, bool> {
    value
        .get(key)
        .and_then(Value::as_object)
        .map(|items| {
            items
                .iter()
                .filter_map(|(key, value)| value.as_bool().map(|value| (key.clone(), value)))
                .collect()
        })
        .filter(|items: &HashMap<String, bool>| !items.is_empty())
        .unwrap_or_else(super::types::default_sidebar_hidden_by_page)
}

fn get_str(value: &Value, key: &str, default: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| default.to_string())
}

fn get_bool(value: &Value, key: &str, default: bool) -> bool {
    value.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

fn get_string_array(value: &Value, key: &str, default: &[&str]) -> Vec<String> {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .filter(|arr: &Vec<String>| !arr.is_empty())
        .unwrap_or_else(|| default.iter().map(|s| s.to_string()).collect())
}
