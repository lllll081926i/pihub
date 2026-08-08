//! Provider model list fetching for Pi.
//!
//! Replaces the removed open_code `fetch_provider_models` command. Given a
//! provider base URL + optional API key, it queries the provider's model
//! catalog for OpenAI-compatible or native (Anthropic/Google) endpoints and
//! returns normalized model entries for the FetchModels modal.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::SqliteDbState;
use crate::http_client;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProviderModelsRequest {
    pub provider_id: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub headers: Option<Value>,
    pub api_type: String,
    pub sdk_type: Option<String>,
    pub custom_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedModel {
    pub id: String,
    pub name: Option<String>,
    pub owned_by: Option<String>,
    pub created: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProviderModelsResponse {
    pub models: Vec<FetchedModel>,
    pub total: usize,
}

/// Fetch the provider's model list.
#[tauri::command]
pub async fn fetch_provider_models(
    state: tauri::State<'_, SqliteDbState>,
    request: FetchProviderModelsRequest,
) -> Result<FetchProviderModelsResponse, String> {
    let base_url = request
        .custom_url
        .as_deref()
        .filter(|url| !url.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| request.base_url.clone());

    let endpoint = match request.api_type.as_str() {
        "native" if request.sdk_type.as_deref() == Some("@ai-sdk/google") => {
            // Google Generative Language: models.list
            format!(
                "{}/v1beta/models?key={}",
                base_url.trim_end_matches('/'),
                request.api_key.clone().unwrap_or_default()
            )
        }
        "native" if request.sdk_type.as_deref() == Some("@ai-sdk/anthropic") => {
            // Anthropic: /v1/models with x-api-key + anthropic-version headers
            format!("{}/v1/models", base_url.trim_end_matches('/'))
        }
        _ => format!("{}/models", base_url.trim_end_matches('/')),
    };

    let client = http_client::client_with_timeout(state.inner(), 30).await?;

    let mut request_builder = client.get(&endpoint);
    if request.sdk_type.as_deref() == Some("@ai-sdk/anthropic") {
        // Anthropic requires x-api-key and anthropic-version headers, not Bearer auth
        if let Some(api_key) = &request.api_key {
            if !api_key.is_empty() {
                request_builder = request_builder.header("x-api-key", api_key.clone());
            }
        }
        request_builder = request_builder.header("anthropic-version", "2023-06-01");
    } else if let Some(api_key) = &request.api_key {
        if !api_key.is_empty() {
            request_builder = request_builder.bearer_auth(api_key);
        }
    }
    if let Some(headers) = &request.headers {
        if let Some(obj) = headers.as_object() {
            for (key, value) in obj {
                if let Some(value_str) = value.as_str() {
                    if let Ok(header_name) = key.parse::<reqwest::header::HeaderName>() {
                        request_builder = request_builder.header(header_name, value_str);
                    }
                }
            }
        }
    }

    let response = request_builder
        .send()
        .await
        .map_err(|error| format!("Failed to fetch provider models: {error}"))?;

    if !response.status().is_success() {
        // Anthropic without a reachable model endpoint: fall back to curated defaults
        if request.sdk_type.as_deref() == Some("@ai-sdk/anthropic") {
            let models = anthropic_default_models();
            let total = models.len();
            return Ok(FetchProviderModelsResponse { models, total });
        }
        return Err(format!(
            "Provider models request failed: {}",
            response.status()
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse provider models response: {error}"))?;

    let models = extract_models(&body, request.sdk_type.as_deref())?;
    let total = models.len();
    Ok(FetchProviderModelsResponse { models, total })
}

fn extract_models(body: &Value, sdk_type: Option<&str>) -> Result<Vec<FetchedModel>, String> {
    // Google: { "models": [ { "name": "models/gemini-pro", "displayName": ... } ] }
    if sdk_type == Some("@ai-sdk/google") {
        let mut models = Vec::new();
        if let Some(entries) = body.get("models").and_then(Value::as_array) {
            for entry in entries {
                let raw_name = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let id = raw_name
                    .strip_prefix("models/")
                    .unwrap_or(&raw_name)
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                models.push(FetchedModel {
                    name: entry
                        .get("displayName")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    id,
                    owned_by: entry
                        .get("supportedGenerationMethods")
                        .and_then(Value::as_array)
                        .map(|methods| {
                            methods
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join(",")
                        }),
                    created: None,
                });
            }
        }
        return Ok(models);
    }

    // OpenAI-compatible: { "data": [ { "id": "gpt-4", "owned_by": "openai", "created": 123 } ] }
    // Anthropic: { "data": [ { "id": "claude-...", "display_name": "...", "created_at": ... } ] }
    if let Some(data) = body.get("data").and_then(Value::as_array) {
        let models = data
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id").and_then(Value::as_str)?.to_string();
                Some(FetchedModel {
                    name: entry
                        .get("name")
                        .or_else(|| entry.get("display_name"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    id,
                    owned_by: entry
                        .get("owned_by")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    created: entry
                        .get("created")
                        .or_else(|| entry.get("created_at"))
                        .and_then(Value::as_i64),
                })
            })
            .collect::<Vec<_>>();
        return Ok(models);
    }

    // Anthropic has no list endpoint; check for an inline array fallback.
    if let Some(data) = body.as_array() {
        let models = data
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id").and_then(Value::as_str)?.to_string();
                Some(FetchedModel {
                    name: entry
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    id,
                    owned_by: entry
                        .get("owned_by")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    created: entry
                        .get("created")
                        .or_else(|| entry.get("created_at"))
                        .and_then(Value::as_i64),
                })
            })
            .collect::<Vec<_>>();
        if !models.is_empty() {
            return Ok(models);
        }
    }

    Err("Provider response did not contain a recognizable model list".to_string())
}

fn anthropic_default_models() -> Vec<FetchedModel> {
    [
        "claude-opus-4-6",
        "claude-opus-4-5",
        "claude-sonnet-4-6",
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "claude-opus-4",
        "claude-sonnet-4",
        "claude-3-7-sonnet-latest",
        "claude-3-5-sonnet-latest",
        "claude-3-5-haiku-latest",
    ]
    .iter()
    .map(|id| FetchedModel {
        id: id.to_string(),
        name: None,
        owned_by: Some("anthropic".to_string()),
        created: None,
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_models_parses_openai_compatible() {
        let body = json!({
            "data": [
                { "id": "gpt-4o", "owned_by": "openai", "created": 1700000000 },
                { "id": "gpt-4o-mini" }
            ]
        });
        let models = extract_models(&body, None).expect("parse openai compat");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[0].owned_by.as_deref(), Some("openai"));
    }

    #[test]
    fn extract_models_parses_google_native() {
        let body = json!({
            "models": [
                { "name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro" }
            ]
        });
        let models = extract_models(&body, Some("@ai-sdk/google")).expect("parse google");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gemini-2.5-pro");
        assert_eq!(models[0].name.as_deref(), Some("Gemini 2.5 Pro"));
    }

    #[test]
    fn extract_models_rejects_unknown_shape() {
        let body = json!({ "unexpected": true });
        assert!(extract_models(&body, None).is_err());
    }

    #[test]
    fn anthropic_defaults_are_nonempty() {
        assert!(!anthropic_default_models().is_empty());
    }
}
