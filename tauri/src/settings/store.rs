use super::{adapter, types::AppSettings};
use crate::db::helpers::{db_get, db_put};
use crate::db::schema::DbTable;
use crate::db::SqliteDbState;

const SETTINGS_ID: &str = "app";

pub fn load_settings_from_sqlite_state(
    sqlite_state: &SqliteDbState,
) -> Result<AppSettings, String> {
    sqlite_state.with_conn(load_settings_from_sqlite_conn)
}

pub async fn load_settings_from_sqlite_state_async(
    sqlite_state: &SqliteDbState,
) -> Result<AppSettings, String> {
    let sqlite_state = sqlite_state.clone();
    tauri::async_runtime::spawn_blocking(move || load_settings_from_sqlite_state(&sqlite_state))
        .await
        .map_err(|error| format!("Failed to join settings load task: {error}"))?
}

pub fn save_settings_to_sqlite_state(
    sqlite_state: &SqliteDbState,
    settings: &AppSettings,
) -> Result<(), String> {
    sqlite_state.with_conn(|conn| save_settings_to_sqlite_conn(conn, settings))
}

pub fn load_settings_from_sqlite_conn(conn: &rusqlite::Connection) -> Result<AppSettings, String> {
    let record = db_get(conn, DbTable::Settings, SETTINGS_ID)?;
    Ok(record.map(adapter::from_db_value).unwrap_or_default())
}

pub fn save_settings_to_sqlite_conn(
    conn: &rusqlite::Connection,
    settings: &AppSettings,
) -> Result<(), String> {
    let json = adapter::to_db_value(settings);
    db_put(conn, DbTable::Settings, SETTINGS_ID, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SqliteDbState;

    #[test]
    fn sqlite_settings_round_trip_uses_adapter_defaults() {
        let sqlite_state = SqliteDbState::in_memory_for_test().expect("sqlite");

        let default_settings =
            load_settings_from_sqlite_state(&sqlite_state).expect("load default settings");
        assert_eq!(default_settings.theme, "system");
        assert_eq!(default_settings.proxy_mode, "system");

        let mut settings = default_settings;
        settings.language = "en-US".to_string();
        settings.theme = "dark".to_string();
        save_settings_to_sqlite_state(&sqlite_state, &settings).expect("save settings");

        let loaded = load_settings_from_sqlite_state(&sqlite_state).expect("reload settings");
        assert_eq!(loaded.language, "en-US");
        assert_eq!(loaded.theme, "dark");
    }

    #[test]
    fn sqlite_settings_round_trip_preserves_proxy_config() {
        let sqlite_state = SqliteDbState::in_memory_for_test().expect("sqlite");

        let mut settings =
            load_settings_from_sqlite_state(&sqlite_state).expect("load default settings");
        settings.proxy_mode = "custom".to_string();
        settings.proxy_url = "http://localhost:8080".to_string();
        save_settings_to_sqlite_state(&sqlite_state, &settings).expect("save settings");

        let loaded = load_settings_from_sqlite_state(&sqlite_state).expect("reload settings");
        assert_eq!(loaded.proxy_mode, "custom");
        assert_eq!(loaded.proxy_url, "http://localhost:8080");
    }
}
