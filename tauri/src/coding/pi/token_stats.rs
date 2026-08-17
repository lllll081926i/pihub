//! Token usage statistics aggregated from Pi session files.
//!
//! Scans the Pi sessions root for JSONL session files, extracts usage
//! (input/output/cache tokens and cost) from assistant messages, and
//! aggregates them into daily buckets for the Token Stats page.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::db::helpers::{db_delete, db_get, db_put};
use crate::db::schema::DbTable;

const TOKEN_STATS_CACHE_ID: &str = "token_stats_cache/latest";

/// Daily token usage bucket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenDayBucket {
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_write_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost_usd: f64,
    pub message_count: u32,
}

/// Per-model token usage bucket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenModelBucket {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_write_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost_usd: f64,
    pub message_count: u32,
}

/// Aggregated token stats response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatsResult {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_write_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cost_usd: f64,
    pub total_messages: u32,
    pub session_count: u32,
    pub avg_tokens_per_session: i64,
    pub avg_cost_per_session: f64,
    pub cache_savings_usd: f64,
    pub days: Vec<TokenDayBucket>,
    pub models: Vec<TokenModelBucket>,
}

/// Resolve the Pi sessions root directory is shared with the session manager
/// (see `session_manager::resolve_pi_sessions_root_with_db`).

fn read_usage_from_value(value: &Value) -> Option<(i64, i64, i64, i64, f64)> {
    let usage = value.get("usage")?;
    let input = usage
        .get("input")
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output = usage
        .get("output")
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("completion_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_write = usage
        .get("cacheWrite")
        .or_else(|| usage.get("cache_creation_input_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_read = usage
        .get("cacheRead")
        .or_else(|| usage.get("cache_read_input_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cost = usage
        .get("cost")
        .and_then(|c| c.get("total"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    Some((input, output, cache_write, cache_read, cost))
}

fn day_key(timestamp_ms: i64) -> String {
    // Simple UTC day key: yyyy-mm-dd
    let secs = timestamp_ms.max(0) / 1000;
    let days = secs / 86400;
    // 1970-01-01 is day 0; compute via civil-from-days approximation.
    let (year, month, day) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// Extract a yyyy-mm-dd day key from a Pi timestamp value.
/// Pi writes ISO 8601 strings ("2026-08-07T07:34:38.110Z"); fall back to
/// epoch milliseconds for forward compatibility.
fn day_key_from_value(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        if text.len() >= 10 {
            return text[..10].to_string();
        }
        return String::new();
    }
    if let Some(ms) = value.as_i64() {
        return day_key(ms);
    }
    String::new()
}

/// Convert days-since-epoch to a (year, month, day) civil date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn aggregate_file(
    path: &PathBuf,
    buckets: &mut HashMap<String, TokenDayBucket>,
    model_buckets: &mut HashMap<String, TokenModelBucket>,
    session_count: &mut u32,
) -> Result<(), String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        if entry_type != "message" {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        if !role.eq_ignore_ascii_case("assistant") {
            continue;
        }

        let Some((input, output, cache_write, cache_read, cost)) = read_usage_from_value(message)
        else {
            continue;
        };

        if input == 0 && output == 0 && cache_write == 0 && cache_read == 0 && cost == 0.0 {
            continue;
        }

        let date = value
            .get("timestamp")
            .map(day_key_from_value)
            .filter(|day| !day.is_empty())
            .unwrap_or_else(|| "unknown".to_string());
        let bucket = buckets
            .entry(date.clone())
            .or_insert_with(|| TokenDayBucket {
                date,
                input_tokens: 0,
                output_tokens: 0,
                cache_write_tokens: 0,
                cache_read_tokens: 0,
                cost_usd: 0.0,
                message_count: 0,
            });
        bucket.input_tokens += input;
        bucket.output_tokens += output;
        bucket.cache_write_tokens += cache_write;
        bucket.cache_read_tokens += cache_read;
        bucket.cost_usd += cost;
        bucket.message_count += 1;

        let model = message
            .get("model")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "unknown".to_string());
        let model_bucket = model_buckets
            .entry(model.clone())
            .or_insert_with(|| TokenModelBucket {
                model: String::new(),
                input_tokens: 0,
                output_tokens: 0,
                cache_write_tokens: 0,
                cache_read_tokens: 0,
                cost_usd: 0.0,
                message_count: 0,
            });
        model_bucket.model = model;
        model_bucket.input_tokens += input;
        model_bucket.output_tokens += output;
        model_bucket.cache_write_tokens += cache_write;
        model_bucket.cache_read_tokens += cache_read;
        model_bucket.cost_usd += cost;
        model_bucket.message_count += 1;
    }

    *session_count += 1;
    Ok(())
}

fn read_cached_stats(db: &crate::db::SqliteDbState) -> Option<TokenStatsResult> {
    let value = db
        .with_conn(|conn| db_get(conn, DbTable::TokenStatsCache, TOKEN_STATS_CACHE_ID))
        .ok()??;
    let result_value = value.get("result")?.clone();
    serde_json::from_value(result_value).ok()
}

fn write_cached_stats(db: &crate::db::SqliteDbState, result: &TokenStatsResult) {
    let Ok(result_value) = serde_json::to_value(result) else {
        return;
    };
    let payload = json!({
        "computed_at": now_rfc3339_like(),
        "result": result_value,
    });
    let _ = db.with_conn(|conn| {
        db_put(
            conn,
            DbTable::TokenStatsCache,
            TOKEN_STATS_CACHE_ID,
            &payload,
        )
    });
}

async fn scan_and_cache_stats(db: &crate::db::SqliteDbState) -> Result<TokenStatsResult, String> {
    // 与会话管理共用同一份运行时位置解析（runtime location + settings.json sessionDir）
    let root = crate::coding::session_manager::resolve_pi_sessions_root_with_db(db).await?;
    let result = tauri::async_runtime::spawn_blocking(move || compute_token_stats(&root))
        .await
        .map_err(|error| format!("Failed to join token stats scan: {error}"))??;
    write_cached_stats(db, &result);
    Ok(result)
}

/// Tauri command: return aggregated token usage stats.
/// Cache-first: 有缓存立即返回（秒开）；无缓存时同步扫描并写入缓存。
#[tauri::command]
pub async fn get_token_stats(
    state: tauri::State<'_, crate::db::SqliteDbState>,
) -> Result<TokenStatsResult, String> {
    if let Some(cached) = read_cached_stats(&state.db()) {
        return Ok(cached);
    }
    scan_and_cache_stats(&state.db()).await
}

/// Tauri command: rescan sessions and return fresh stats, updating the cache.
/// 前端在显示缓存数据后静默调用，拿到新数据后无感刷新。
#[tauri::command]
pub async fn refresh_token_stats(
    state: tauri::State<'_, crate::db::SqliteDbState>,
) -> Result<TokenStatsResult, String> {
    scan_and_cache_stats(&state.db()).await
}

/// Tauri command: 清理 Token 统计缓存（设置页“清理缓存”入口调用）。
/// 删除后下次打开 Token 统计页会重新扫描并重建缓存。
#[tauri::command]
pub async fn clear_token_stats_cache(
    state: tauri::State<'_, crate::db::SqliteDbState>,
) -> Result<(), String> {
    state
        .db()
        .with_conn(|conn| db_delete(conn, DbTable::TokenStatsCache, TOKEN_STATS_CACHE_ID))?;
    Ok(())
}

/// RFC3339 timestamp without pulling in chrono (matches db helpers' format).
fn now_rfc3339_like() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    )
}

/// Recursively collect Pi session JSONL files under `root`.
/// Pi stores sessions in per-project subdirectories, so a top-level read_dir
/// would miss every real session file.
fn collect_session_files(root: &std::path::Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_session_files(&path, files);
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext == "jsonl")
            .unwrap_or(false)
        {
            files.push(path);
        }
    }
}

/// Aggregate token usage across all Pi session files under `root`.
pub fn compute_token_stats(root: &std::path::Path) -> Result<TokenStatsResult, String> {
    if !root.exists() {
        return Ok(TokenStatsResult {
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_write_tokens: 0,
            total_cache_read_tokens: 0,
            total_cost_usd: 0.0,
            total_messages: 0,
            session_count: 0,
            avg_tokens_per_session: 0,
            avg_cost_per_session: 0.0,
            cache_savings_usd: 0.0,
            days: Vec::new(),
            models: Vec::new(),
        });
    }

    let mut buckets: HashMap<String, TokenDayBucket> = HashMap::new();
    let mut model_buckets: HashMap<String, TokenModelBucket> = HashMap::new();
    let mut session_count: u32 = 0;

    let mut files = Vec::new();
    collect_session_files(root, &mut files);
    for path in files {
        let _ = aggregate_file(&path, &mut buckets, &mut model_buckets, &mut session_count);
    }

    let mut days: Vec<TokenDayBucket> = buckets.into_values().collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));

    let mut models: Vec<TokenModelBucket> = model_buckets.into_values().collect();
    models.sort_by(|a, b| {
        (b.input_tokens + b.output_tokens).cmp(&(a.input_tokens + a.output_tokens))
    });

    let mut total_input_tokens = 0;
    let mut total_output_tokens = 0;
    let mut total_cache_write_tokens = 0;
    let mut total_cache_read_tokens = 0;
    let mut total_cost_usd = 0.0;
    let mut total_messages = 0;
    for day in &days {
        total_input_tokens += day.input_tokens;
        total_output_tokens += day.output_tokens;
        total_cache_write_tokens += day.cache_write_tokens;
        total_cache_read_tokens += day.cache_read_tokens;
        total_cost_usd += day.cost_usd;
        total_messages += day.message_count;
    }

    let total_tokens = total_input_tokens
        + total_output_tokens
        + total_cache_write_tokens
        + total_cache_read_tokens;
    let avg_tokens_per_session = if session_count > 0 {
        total_tokens / session_count as i64
    } else {
        0
    };
    let avg_cost_per_session = if session_count > 0 {
        total_cost_usd / session_count as f64
    } else {
        0.0
    };
    // Cache read tokens already saved us from re-sending them as input.
    // Rough estimate: cache read is ~1/10th the input price on many providers.
    // Cache pricing varies by provider/model. Do not present a fabricated
    // dollar amount when the session record does not contain a price source.
    let cache_savings_usd = 0.0;

    Ok(TokenStatsResult {
        total_input_tokens,
        total_output_tokens,
        total_cache_write_tokens,
        total_cache_read_tokens,
        total_cost_usd,
        total_messages,
        session_count,
        avg_tokens_per_session,
        avg_cost_per_session,
        cache_savings_usd,
        days,
        models,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_key_produces_iso_date() {
        // 2024-01-01T00:00:00Z = 1704067200
        assert_eq!(day_key(1_704_067_200_000), "2024-01-01");
        // 2024-12-31T00:00:00Z
        assert_eq!(day_key(1_735_603_200_000), "2024-12-31");
    }

    #[test]
    fn reads_pi_style_usage() {
        let value = serde_json::json!({
            "usage": {
                "input": 100,
                "output": 50,
                "cacheWrite": 20,
                "cacheRead": 10,
                "cost": { "total": 0.012 }
            }
        });
        let parsed = read_usage_from_value(&value).expect("usage");
        assert_eq!(parsed, (100, 50, 20, 10, 0.012));
    }
}
