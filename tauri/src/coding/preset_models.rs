//! Preset models cache (file-based, replaces DB table).
//!
//! The bundled `preset_models.json` resource is the default; a remote
//! fetch updates the local cache file under the app data dir.

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::Value;

use crate::db::SqliteDbState;
use crate::http_client;

const CACHE_FILE_NAME: &str = "preset_models.json";
const BUNDLED_PRESET_MODELS_JSON: &str = include_str!("../../resources/preset_models.json");

static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}

pub fn get_preset_models_cache_path() -> Option<PathBuf> {
    CACHE_DIR.get().map(|dir| dir.join(CACHE_FILE_NAME))
}

/// Load preset models from the local cache file (app data dir).
/// Returns None when no cache file exists or it is invalid.
#[tauri::command]
pub async fn load_cached_preset_models(
    state: tauri::State<'_, SqliteDbState>,
) -> Result<Option<Value>, String> {
    let _ = state;
    let Some(path) = get_preset_models_cache_path() else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) => {
            log::warn!("[PresetModels] Ignoring unreadable cache: {}", error);
            return Ok(None);
        }
    };
    match serde_json::from_str::<Value>(&content) {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            log::warn!("[PresetModels] Ignoring invalid cache: {}", error);
            Ok(None)
        }
    }
}

/// Fetch preset models from a remote URL, save to local cache file,
/// and return the parsed JSON. Falls back to bundled defaults on network
/// or parse errors.
#[tauri::command]
pub async fn fetch_remote_preset_models(
    state: tauri::State<'_, SqliteDbState>,
    url: String,
) -> Result<Value, String> {
    let client = http_client::client_with_timeout(state.inner(), 30).await?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch remote preset models: {error}"))?;

    if !response.status().is_success() {
        log::warn!(
            "[PresetModels] Remote request failed: {}",
            response.status()
        );
        return bundled_preset_models();
    }

    let content = response
        .text()
        .await
        .map_err(|error| format!("Failed to read remote preset models response: {error}"))?;

    match serde_json::from_str::<Value>(&content) {
        Ok(value) => {
            if let Err(error) = write_cache_file(&content) {
                log::warn!("[PresetModels] Failed to write cache: {}", error);
            }
            Ok(value)
        }
        Err(error) => {
            log::warn!("[PresetModels] Ignoring invalid remote payload: {}", error);
            bundled_preset_models()
        }
    }
}

fn bundled_preset_models() -> Result<Value, String> {
    serde_json::from_str(BUNDLED_PRESET_MODELS_JSON)
        .map_err(|error| format!("Failed to parse bundled preset models: {error}"))
}

fn write_cache_file(content: &str) -> Result<(), String> {
    let Some(path) = get_preset_models_cache_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create cache dir: {error}"))?;
    }
    fs::write(&path, content).map_err(|error| format!("Failed to write cache file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_preset_models_is_valid_json() {
        let value = bundled_preset_models().expect("bundled preset models should parse");
        let obj = value
            .as_object()
            .expect("preset models should be an object");
        assert!(!obj.is_empty(), "preset models should not be empty");
        for (key, models) in obj {
            let arr = models
                .as_array()
                .unwrap_or_else(|| panic!("preset group {key} should be an array"));
            assert!(!arr.is_empty(), "preset group {key} should not be empty");
        }
    }
}
