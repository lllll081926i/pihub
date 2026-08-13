//! Pi provider configuration checkup & auto-repair.
//!
//! Detects provider configs that are likely broken in practice — the classic
//! case being a base URL missing its version suffix (`/v1`, `/v1beta`), which
//! surfaces as 404s at runtime — and can rewrite them to the normalized form.
//! Normalization itself lives in `provider_url.rs` and is idempotent, so the
//! repair never double-appends and never strips an explicit suffix.

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::commands::{
    emit_config_changed, get_pi_auth_path_async, get_pi_models_path_async, models_json_lock,
    read_pi_runtime_config,
};
use super::models_fetch::build_models_endpoint;
use super::provider_url::{
    api_supports_normalization, normalize_provider_base_url, pi_api_to_fetch_target,
};
use super::types::PiRuntimeConfig;
use crate::coding::file_io;
use crate::db::SqliteDbState;
use crate::http_client;

/// Probe classification for a provider's model-list endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PiProviderProbeStatus {
    /// Endpoint responded with a success status.
    Ok,
    /// 401/403 — the URL answers but the credential is rejected.
    Auth,
    /// 404 — classic missing/extra suffix symptom.
    NotFound,
    /// Any other non-success HTTP status.
    HttpError,
    /// DNS/connect/timeout — endpoint could not be reached at all.
    Unreachable,
    /// Probe was not requested or provider has no base URL.
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderCheckupItem {
    pub provider_key: String,
    pub display_name: String,
    pub api: Option<String>,
    pub base_url: String,
    /// Normalized base URL when it differs from the stored one (auto-fixable).
    pub suggested_base_url: Option<String>,
    pub probe_status: PiProviderProbeStatus,
    pub probe_detail: Option<String>,
    /// When the stored URL failed the probe but the suggested one succeeded.
    pub suggested_probe_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderCheckupReport {
    pub items: Vec<PiProviderCheckupItem>,
    pub fixable_count: usize,
    pub probed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderRepairedItem {
    pub provider_key: String,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderRepairResult {
    pub repaired: Vec<PiProviderRepairedItem>,
    pub config: PiRuntimeConfig,
}

fn provider_api_key(provider: &Value, auth: &Value, provider_key: &str) -> Option<String> {
    if let Some(key) = provider
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        return Some(key.to_string());
    }
    let entry = auth.get(provider_key)?;
    if let Some(key) = entry.as_str().map(str::trim).filter(|key| !key.is_empty()) {
        return Some(key.to_string());
    }
    entry
        .get("key")
        .or_else(|| entry.get("token"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

async fn probe_endpoint(
    client: &reqwest::Client,
    base_url: &str,
    api: Option<&str>,
    api_key: Option<&str>,
    headers: Option<&Value>,
) -> (PiProviderProbeStatus, Option<String>) {
    let (api_type, sdk_type) = pi_api_to_fetch_target(api);
    let endpoint = build_models_endpoint(base_url, api_type, Some(sdk_type), api_key.unwrap_or(""));

    let mut request = client.get(&endpoint);
    if sdk_type == "@ai-sdk/anthropic" {
        if let Some(key) = api_key {
            request = request.header("x-api-key", key);
        }
        request = request.header("anthropic-version", "2023-06-01");
    } else if sdk_type != "@ai-sdk/google" {
        // Google passes the key as a query param inside build_models_endpoint.
        if let Some(key) = api_key {
            request = request.bearer_auth(key);
        }
    }
    if let Some(obj) = headers.and_then(Value::as_object) {
        for (key, value) in obj {
            if let (Ok(name), Some(value_str)) = (
                key.parse::<reqwest::header::HeaderName>(),
                value.as_str(),
            ) {
                request = request.header(name, value_str);
            }
        }
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                (PiProviderProbeStatus::Ok, None)
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                (PiProviderProbeStatus::Auth, Some(status.to_string()))
            } else if status.as_u16() == 404 {
                (PiProviderProbeStatus::NotFound, Some(status.to_string()))
            } else {
                (PiProviderProbeStatus::HttpError, Some(status.to_string()))
            }
        }
        Err(error) => (
            PiProviderProbeStatus::Unreachable,
            // `without_url` keeps the API key (embedded in Google URLs) out of
            // the detail string that is rendered in the UI.
            Some(error.without_url().to_string()),
        ),
    }
}

/// Diagnose all models.json providers: missing-suffix detection plus an
/// optional live probe of each provider's model-list endpoint.
#[tauri::command]
pub async fn check_pi_providers(
    state: tauri::State<'_, SqliteDbState>,
    probe: bool,
) -> Result<PiProviderCheckupReport, String> {
    let db = state.db();
    let models_path = get_pi_models_path_async(&db).await?;
    let auth_path = get_pi_auth_path_async(&db).await?;
    let models = file_io::read_json_object_or_empty_async(&models_path).await?;
    let auth = file_io::read_json_object_or_empty_async(&auth_path).await?;

    let Some(providers) = models.get("providers").and_then(Value::as_object) else {
        return Ok(PiProviderCheckupReport {
            items: vec![],
            fixable_count: 0,
            probed: probe,
        });
    };

    let client = if probe {
        Some(http_client::client_with_timeout(state.inner(), 10).await?)
    } else {
        None
    };

    let mut items = Vec::new();
    let mut probe_inputs: Vec<(String, Option<String>, Option<String>, Option<Value>)> =
        Vec::new();
    for (provider_key, provider) in providers {
        let Some(base_url) = provider
            .get("baseUrl")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|url| !url.is_empty())
        else {
            continue;
        };
        let api = provider
            .get("api")
            .and_then(Value::as_str)
            .map(str::to_string);
        let display_name = provider
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(provider_key)
            .to_string();

        let normalized = normalize_provider_base_url(base_url, api.as_deref());
        let suggested_base_url = (normalized != base_url).then_some(normalized);

        if client.is_some() && api_supports_normalization(api.as_deref()) {
            probe_inputs.push((
                base_url.to_string(),
                api.clone(),
                provider_api_key(provider, &auth, provider_key),
                provider.get("headers").cloned(),
            ));
        } else {
            probe_inputs.push((String::new(), None, None, None));
        }

        items.push(PiProviderCheckupItem {
            provider_key: provider_key.clone(),
            display_name,
            api,
            base_url: base_url.to_string(),
            suggested_base_url,
            probe_status: PiProviderProbeStatus::Skipped,
            probe_detail: None,
            suggested_probe_ok: false,
        });
    }

    if let Some(client) = &client {
        // Probe all providers concurrently; each may follow up with the
        // suggested URL when the stored one fails, so a suggested fix is only
        // recommended after it actually answers.
        let probe_futures = items.iter().zip(probe_inputs.iter()).map(
            |(item, (base_url, api, api_key, headers))| async move {
                if base_url.is_empty() {
                    return (PiProviderProbeStatus::Skipped, None, false);
                }
                let (status, detail) = probe_endpoint(
                    client,
                    base_url,
                    api.as_deref(),
                    api_key.as_deref(),
                    headers.as_ref(),
                )
                .await;
                let suggested_probe_ok = if status != PiProviderProbeStatus::Ok {
                    match &item.suggested_base_url {
                        Some(suggested) => {
                            let (fixed_status, _) = probe_endpoint(
                                client,
                                suggested,
                                api.as_deref(),
                                api_key.as_deref(),
                                headers.as_ref(),
                            )
                            .await;
                            fixed_status == PiProviderProbeStatus::Ok
                        }
                        None => false,
                    }
                } else {
                    false
                };
                (status, detail, suggested_probe_ok)
            },
        );
        let probe_results = join_all(probe_futures).await;
        for (item, (status, detail, suggested_ok)) in
            items.iter_mut().zip(probe_results.into_iter())
        {
            item.probe_status = status;
            item.probe_detail = detail;
            item.suggested_probe_ok = suggested_ok;
        }
    }

    let fixable_count = items
        .iter()
        .filter(|item| item.suggested_base_url.is_some())
        .count();
    Ok(PiProviderCheckupReport {
        items,
        fixable_count,
        probed: probe,
    })
}

/// Apply idempotent base URL normalization to models.json providers.
/// Only the `baseUrl` string is touched; all unknown fields are preserved.
/// When `provider_keys` is given, only those providers are repaired (the
/// frontend uses this to skip providers whose suggested URL failed the probe).
#[tauri::command]
pub async fn repair_pi_providers(
    state: tauri::State<'_, SqliteDbState>,
    app: tauri::AppHandle,
    provider_keys: Option<Vec<String>>,
) -> Result<PiProviderRepairResult, String> {
    let filter: Option<std::collections::HashSet<&str>> = provider_keys
        .as_deref()
        .map(|keys| keys.iter().map(String::as_str).collect());
    let db = state.db();
    let models_path = get_pi_models_path_async(&db).await?;
    let _guard = models_json_lock().lock().await;
    let mut models = file_io::read_json_object_or_empty_async(&models_path).await?;

    let mut repaired = Vec::new();
    if let Some(providers) = models.get_mut("providers").and_then(Value::as_object_mut) {
        for (provider_key, provider) in providers.iter_mut() {
            if let Some(filter) = &filter {
                if !filter.contains(provider_key.as_str()) {
                    continue;
                }
            }
            let Some(obj) = provider.as_object_mut() else {
                continue;
            };
            let api = obj
                .get("api")
                .and_then(Value::as_str)
                .map(str::to_string);
            let Some(base_url) = obj.get("baseUrl").and_then(Value::as_str) else {
                continue;
            };
            let normalized = normalize_provider_base_url(base_url, api.as_deref());
            if normalized != base_url {
                repaired.push(PiProviderRepairedItem {
                    provider_key: provider_key.clone(),
                    before: base_url.to_string(),
                    after: normalized.clone(),
                });
                obj.insert("baseUrl".to_string(), Value::String(normalized));
            }
        }
    }

    if !repaired.is_empty() {
        file_io::write_json_object_async(&models_path, &models).await?;
        emit_config_changed(&app, "window");
    }

    let config = read_pi_runtime_config(state).await?;
    Ok(PiProviderRepairResult { repaired, config })
}
