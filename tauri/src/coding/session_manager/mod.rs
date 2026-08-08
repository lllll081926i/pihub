mod message_blocks;
mod pi;
mod tool_normalizer;
mod utils;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::coding::runtime_location::{
    get_pi_runtime_location_async, RuntimeLocationInfo, WslLocationInfo,
};
use crate::db::SqliteDbState;

const SESSION_CACHE_TTL: Duration = Duration::from_secs(15);
const MAX_SESSION_CACHE_ENTRIES: usize = 16;
const DEFAULT_SESSION_PATH_LIMIT: usize = 200;
const MAX_SESSION_PATH_LIMIT: usize = 500;
const EXPORT_SCHEMA_VERSION: u8 = 2;
const EXPORT_SCHEMA_NAME: &str = "ai-toolbox.session-export.v2";
const SNAPSHOT_FORMAT_PI: &str = "pi-session-jsonl";

#[derive(Debug, Clone)]
struct SessionCacheEntry {
    created_at: Instant,
    sessions: Vec<SessionMeta>,
}

static SESSION_LIST_CACHE: LazyLock<Mutex<HashMap<String, SessionCacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub provider_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_active_at: Option<i64>,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_distro: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<SessionMessageBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<SessionMessageUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_sidechain: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessageBlock {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

pub(super) fn assign_missing_message_ids(messages: &mut [SessionMessage], provider_id: &str) {
    for (index, message) in messages.iter_mut().enumerate() {
        if message
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
        {
            continue;
        }

        message.id = Some(format!("{provider_id}-message-{index:06}"));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessageUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListPage {
    pub items: Vec<SessionMeta>,
    pub page: u32,
    pub page_size: u32,
    pub total: usize,
    pub has_more: bool,
    #[serde(default)]
    pub partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_state: Option<String>,
    #[serde(default)]
    pub meta_complete: bool,
    #[serde(default)]
    pub message_search_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_sources: Vec<SessionSourceOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSourceOption {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distro: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub meta: SessionMeta,
    pub messages: Vec<SessionMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSubagentMeta {
    pub id: String,
    pub source_path: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_message_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionFailure {
    pub source_path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteToolSessionsResult {
    pub deleted_count: usize,
    pub failed_items: Vec<DeleteSessionFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionItem {
    pub source_path: String,
    pub export_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionFailure {
    pub source_path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportToolSessionsResult {
    pub exported_count: usize,
    pub exported_items: Vec<ExportSessionItem>,
    pub failed_items: Vec<ExportSessionFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSnapshot {
    format: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedSessionFile {
    version: u8,
    schema: String,
    tool: String,
    exported_at: String,
    meta: SessionMeta,
    normalized_messages: Vec<SessionMessage>,
    native_snapshot: NativeSnapshot,
}

#[derive(Debug, Clone)]
enum ToolSessionContext {
    Pi { sessions_root: PathBuf },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionRuntimeSource {
    Local,
    Wsl,
}

impl SessionRuntimeSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Wsl => "wsl",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionSourceMode {
    All,
    Local,
    Wsl,
}

impl SessionSourceMode {
    fn parse(raw: Option<String>) -> Result<Self, String> {
        match raw
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("all")
        {
            "all" => Ok(Self::All),
            "local" => Ok(Self::Local),
            "wsl" => Ok(Self::Wsl),
            value => Err(format!("Unsupported session source mode: {value}")),
        }
    }

    fn accepts(self, source: SessionRuntimeSource) -> bool {
        matches!(self, Self::All)
            || matches!((self, source), (Self::Local, SessionRuntimeSource::Local))
            || matches!((self, source), (Self::Wsl, SessionRuntimeSource::Wsl))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionListLoadMode {
    Auto,
    CacheFirst,
    Full,
    Refresh,
}

impl SessionListLoadMode {
    fn parse(raw: Option<String>) -> Result<Self, String> {
        match raw
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("auto")
        {
            "auto" => Ok(Self::Auto),
            "cache-first" => Ok(Self::CacheFirst),
            "full" => Ok(Self::Full),
            "refresh" => Ok(Self::Refresh),
            value => Err(format!("Unsupported session list load mode: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionListCacheState {
    None,
    Quick,
    Stale,
    Fresh,
}

impl SessionListCacheState {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Quick => "quick",
            Self::Stale => "stale",
            Self::Fresh => "fresh",
        }
    }
}

#[derive(Debug, Clone)]
struct SessionContextEntry {
    context: ToolSessionContext,
    source: SessionRuntimeSource,
    distro: Option<String>,
}

#[derive(Debug, Clone)]
struct SessionContextSet {
    entries: Vec<SessionContextEntry>,
    available_sources: Vec<SessionSourceOption>,
}

#[derive(Debug, Clone, Copy)]
enum SessionTool {
    Pi,
}

impl SessionTool {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "pi" => Ok(Self::Pi),
            _ => Err(format!("Unsupported session tool: {raw}")),
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Pi => "pi",
        }
    }
}

impl ToolSessionContext {
    fn cache_key(&self) -> String {
        match self {
            Self::Pi { sessions_root } => format!("pi:{}", sessions_root.display()),
        }
    }
}

#[tauri::command]
pub async fn list_tool_sessions(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    query: Option<String>,
    path_filter: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    force_refresh: Option<bool>,
    source_mode: Option<String>,
    load_mode: Option<String>,
) -> Result<SessionListPage, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let query = normalize_query(query);
    let path_filter = normalize_query(path_filter);
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(10).clamp(1, 50);
    let force_refresh = force_refresh.unwrap_or(false);
    let source_mode = SessionSourceMode::parse(source_mode)?;
    let load_mode = SessionListLoadMode::parse(load_mode)?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || {
        list_sessions_blocking(
            contexts,
            source_mode,
            query,
            path_filter,
            page as usize,
            page_size as usize,
            force_refresh,
            load_mode,
        )
    })
    .await
    .map_err(|error| format!("Failed to list sessions: {error}"))?
}

#[tauri::command]
pub async fn list_tool_session_paths(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    limit: Option<u32>,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let limit = limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_SESSION_PATH_LIMIT)
        .clamp(1, MAX_SESSION_PATH_LIMIT);
    let force_refresh = force_refresh.unwrap_or(false);
    let context = resolve_context(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || {
        list_session_paths_blocking(context, limit, force_refresh)
    })
    .await
    .map_err(|error| format!("Failed to list session paths: {error}"))?
}

#[tauri::command]
pub async fn get_tool_session_detail(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_path: String,
) -> Result<SessionDetail, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || get_session_detail_blocking(contexts, source_path))
        .await
        .map_err(|error| format!("Failed to load session detail: {error}"))?
}

#[tauri::command]
pub async fn list_tool_session_subagents(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_path: String,
) -> Result<Vec<SessionSubagentMeta>, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || {
        list_session_subagents_blocking(contexts, source_path)
    })
    .await
    .map_err(|error| format!("Failed to list subagent sessions: {error}"))?
}

#[tauri::command]
pub async fn get_tool_subagent_session_detail(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    parent_source_path: String,
    subagent_source_path: String,
) -> Result<SessionDetail, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || {
        get_subagent_session_detail_blocking(contexts, parent_source_path, subagent_source_path)
    })
    .await
    .map_err(|error| format!("Failed to load subagent session detail: {error}"))?
}

#[tauri::command]
pub async fn delete_tool_session(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_path: String,
) -> Result<(), String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || delete_session_blocking(contexts, source_path))
        .await
        .map_err(|error| format!("Failed to delete session: {error}"))?
}

#[tauri::command]
pub async fn delete_tool_sessions(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_paths: Vec<String>,
) -> Result<DeleteToolSessionsResult, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || delete_sessions_blocking(contexts, source_paths))
        .await
        .map_err(|error| format!("Failed to delete sessions: {error}"))
}

#[tauri::command]
pub async fn export_tool_session(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_path: String,
    export_path: String,
    export_format: Option<String>,
) -> Result<(), String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;
    let normalized_tool = session_tool.as_str().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        export_session_blocking(
            contexts,
            normalized_tool,
            source_path,
            export_path,
            export_format.as_deref().unwrap_or("ai_toolbox").to_string(),
        )
    })
    .await
    .map_err(|error| format!("Failed to export session: {error}"))?
}

#[tauri::command]
pub async fn export_tool_sessions(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_paths: Vec<String>,
    export_dir: String,
    export_format: Option<String>,
) -> Result<ExportToolSessionsResult, String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;
    let normalized_tool = session_tool.as_str().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        export_sessions_blocking(
            contexts,
            normalized_tool,
            source_paths,
            export_dir,
            export_format.as_deref().unwrap_or("ai_toolbox").to_string(),
        )
    })
    .await
    .map_err(|error| format!("Failed to export sessions: {error}"))?
}

#[tauri::command]
pub async fn import_tool_session(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    import_path: String,
) -> Result<(), String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let context = resolve_context(&state.db(), session_tool).await?;
    let normalized_tool = session_tool.as_str().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        import_session_blocking(context, normalized_tool, import_path)
    })
    .await
    .map_err(|error| format!("Failed to import session: {error}"))?
}

#[tauri::command]
pub async fn rename_tool_session(
    state: tauri::State<'_, SqliteDbState>,
    tool: String,
    source_path: String,
    title: String,
) -> Result<(), String> {
    let session_tool = SessionTool::parse(tool.trim())?;
    let contexts = resolve_session_contexts(&state.db(), session_tool).await?;

    tauri::async_runtime::spawn_blocking(move || {
        rename_session_blocking(contexts, tool, source_path, title)
    })
    .await
    .map_err(|error| format!("Failed to rename session: {error}"))?
}

#[derive(Debug, Clone)]
struct SessionWithContext {
    context_index: usize,
    meta: SessionMeta,
}

fn collect_sessions_with_context(
    contexts: &SessionContextSet,
    source_mode: SessionSourceMode,
    force_refresh: bool,
) -> Vec<SessionWithContext> {
    let mut sessions = Vec::new();

    for (context_index, entry) in contexts.entries.iter().enumerate() {
        if !source_mode.accepts(entry.source) {
            continue;
        }

        let scanned_sessions = get_cached_sessions(&entry.context, force_refresh);
        sessions.extend(
            scanned_sessions
                .into_iter()
                .map(|session| SessionWithContext {
                    context_index,
                    meta: annotate_session_source(session, entry),
                }),
        );
    }

    sessions
}

fn collect_recent_sessions_with_context(
    contexts: &SessionContextSet,
    source_mode: SessionSourceMode,
    limit: usize,
) -> Vec<SessionWithContext> {
    let mut sessions = Vec::new();

    for (context_index, entry) in contexts.entries.iter().enumerate() {
        if !source_mode.accepts(entry.source) {
            continue;
        }

        let recent_sessions = scan_recent_sessions(&entry.context, limit);
        sessions.extend(
            recent_sessions
                .into_iter()
                .map(|session| SessionWithContext {
                    context_index,
                    meta: annotate_session_source(session, entry),
                }),
        );
    }

    sessions
}

fn collect_fresh_cached_sessions_with_context(
    contexts: &SessionContextSet,
    source_mode: SessionSourceMode,
) -> Option<Vec<SessionWithContext>> {
    let mut sessions = Vec::new();

    for (context_index, entry) in contexts.entries.iter().enumerate() {
        if !source_mode.accepts(entry.source) {
            continue;
        }

        let cached_sessions = get_fresh_cached_sessions(&entry.context)?;
        sessions.extend(
            cached_sessions
                .into_iter()
                .map(|session| SessionWithContext {
                    context_index,
                    meta: annotate_session_source(session, entry),
                }),
        );
    }

    Some(sessions)
}

fn collect_any_cached_sessions_with_context(
    contexts: &SessionContextSet,
    source_mode: SessionSourceMode,
) -> (Vec<SessionWithContext>, bool, SessionListCacheState) {
    let mut sessions = Vec::new();
    let mut cache_state = SessionListCacheState::Fresh;
    let mut accepted_context_count = 0usize;
    let mut missing_context_count = 0usize;

    for (context_index, entry) in contexts.entries.iter().enumerate() {
        if !source_mode.accepts(entry.source) {
            continue;
        }
        accepted_context_count += 1;

        let Some((cached_sessions, context_cache_state)) = get_any_cached_sessions(&entry.context)
        else {
            missing_context_count += 1;
            continue;
        };
        if context_cache_state == SessionListCacheState::Stale {
            cache_state = SessionListCacheState::Stale;
        }
        sessions.extend(
            cached_sessions
                .into_iter()
                .map(|session| SessionWithContext {
                    context_index,
                    meta: annotate_session_source(session, entry),
                }),
        );
    }

    if accepted_context_count == 0 {
        return (sessions, false, SessionListCacheState::None);
    }

    if missing_context_count > 0 {
        cache_state = SessionListCacheState::Quick;
    }

    (sessions, missing_context_count > 0, cache_state)
}

fn collect_quick_local_sessions_with_context(
    contexts: &SessionContextSet,
    source_mode: SessionSourceMode,
    limit: usize,
) -> Vec<SessionWithContext> {
    let mut sessions = Vec::new();

    for (context_index, entry) in contexts.entries.iter().enumerate() {
        if !source_mode.accepts(entry.source) || entry.source != SessionRuntimeSource::Local {
            continue;
        }

        let recent_sessions = scan_recent_sessions(&entry.context, limit);
        sessions.extend(
            recent_sessions
                .into_iter()
                .map(|session| SessionWithContext {
                    context_index,
                    meta: annotate_session_source(session, entry),
                }),
        );
    }

    sessions
}

fn annotate_session_source(mut session: SessionMeta, entry: &SessionContextEntry) -> SessionMeta {
    session.runtime_source = Some(entry.source.as_str().to_string());
    session.runtime_distro = entry.distro.clone();
    session
}

fn find_session_with_context(
    contexts: &SessionContextSet,
    source_path: &str,
    force_refresh: bool,
) -> Result<(SessionContextEntry, SessionMeta), String> {
    for entry in &contexts.entries {
        if let Some(session) = get_cached_sessions(&entry.context, force_refresh)
            .into_iter()
            .find(|session| session.source_path == source_path)
        {
            return Ok((entry.clone(), annotate_session_source(session, entry)));
        }
    }

    Err("Session not found".to_string())
}

fn build_session_paths_from_contexts(sessions: &[SessionWithContext], limit: usize) -> Vec<String> {
    let metas: Vec<SessionMeta> = sessions
        .iter()
        .map(|session| session.meta.clone())
        .collect();
    build_session_paths(&metas, limit)
}

fn filter_sessions_by_path_with_context(
    sessions: Vec<SessionWithContext>,
    path_filter: &str,
) -> Vec<SessionWithContext> {
    let path_filter_lower = path_filter.to_ascii_lowercase();

    sessions
        .into_iter()
        .filter(|session| {
            session
                .meta
                .project_dir
                .as_deref()
                .map(|value| contains_query(value, &path_filter_lower))
                .unwrap_or(false)
        })
        .collect()
}

fn filter_sessions_by_query_with_context(
    contexts: &SessionContextSet,
    sessions: Vec<SessionWithContext>,
    query: &str,
    include_message_content: bool,
) -> (Vec<SessionWithContext>, bool) {
    let query_lower = query.to_lowercase();
    let exact_session_id_matches: Vec<SessionWithContext> = sessions
        .iter()
        .filter(|session| session_id_exact_matches_query(&session.meta, &query_lower))
        .cloned()
        .collect();
    if !exact_session_id_matches.is_empty() {
        return (exact_session_id_matches, true);
    }

    let filtered_sessions = sessions
        .into_iter()
        .filter(|session| {
            if meta_matches_query(&session.meta, &query_lower) {
                return true;
            }

            if !include_message_content {
                return false;
            }

            contexts
                .entries
                .get(session.context_index)
                .map(|entry| {
                    scan_session_content_for_query(
                        &entry.context,
                        &session.meta.source_path,
                        &query_lower,
                    )
                    .unwrap_or(false)
                })
                .unwrap_or(false)
        })
        .collect();

    (filtered_sessions, false)
}

fn list_sessions_blocking(
    contexts: SessionContextSet,
    source_mode: SessionSourceMode,
    query: Option<String>,
    path_filter: Option<String>,
    page: usize,
    page_size: usize,
    force_refresh: bool,
    load_mode: SessionListLoadMode,
) -> Result<SessionListPage, String> {
    let use_quick_initial_page =
        page == 1 && page_size <= 10 && query.is_none() && path_filter.is_none() && !force_refresh;
    let (mut sessions, partial, cache_state, meta_complete) = match load_mode {
        SessionListLoadMode::CacheFirst => {
            let (mut cached_sessions, cache_partial, cache_state) =
                collect_any_cached_sessions_with_context(&contexts, source_mode);
            if cached_sessions.is_empty() && cache_partial {
                cached_sessions =
                    collect_quick_local_sessions_with_context(&contexts, source_mode, page_size);
            }
            (cached_sessions, cache_partial, cache_state, !cache_partial)
        }
        SessionListLoadMode::Full | SessionListLoadMode::Refresh => (
            collect_sessions_with_context(
                &contexts,
                source_mode,
                force_refresh || load_mode == SessionListLoadMode::Refresh,
            ),
            false,
            SessionListCacheState::Fresh,
            true,
        ),
        SessionListLoadMode::Auto => {
            if use_quick_initial_page {
                match collect_fresh_cached_sessions_with_context(&contexts, source_mode) {
                    Some(cached_sessions) => {
                        (cached_sessions, false, SessionListCacheState::Fresh, true)
                    }
                    None => (
                        collect_recent_sessions_with_context(&contexts, source_mode, page_size),
                        true,
                        SessionListCacheState::Quick,
                        false,
                    ),
                }
            } else {
                (
                    collect_sessions_with_context(&contexts, source_mode, force_refresh),
                    false,
                    SessionListCacheState::Fresh,
                    true,
                )
            }
        }
    };
    let include_message_content = query.is_some()
        && matches!(
            load_mode,
            SessionListLoadMode::Auto | SessionListLoadMode::Full | SessionListLoadMode::Refresh
        );

    sessions.sort_by(|left, right| {
        let left_ts = left
            .meta
            .last_active_at
            .or(left.meta.created_at)
            .unwrap_or(0);
        let right_ts = right
            .meta
            .last_active_at
            .or(right.meta.created_at)
            .unwrap_or(0);
        right_ts.cmp(&left_ts)
    });

    let available_paths = build_session_paths_from_contexts(&sessions, DEFAULT_SESSION_PATH_LIMIT);
    let path_filtered_sessions = if let Some(path_filter_text) = path_filter.as_deref() {
        filter_sessions_by_path_with_context(sessions, path_filter_text)
    } else {
        sessions
    };
    let (filtered_sessions, exact_session_id_match) = if let Some(query_text) = query.as_deref() {
        filter_sessions_by_query_with_context(
            &contexts,
            path_filtered_sessions,
            query_text,
            include_message_content,
        )
    } else {
        (path_filtered_sessions, false)
    };
    let message_search_complete =
        query.is_none() || include_message_content || exact_session_id_match;

    let total = filtered_sessions.len();
    let items = filtered_sessions
        .iter()
        .map(|session| session.meta.clone())
        .collect();
    Ok(SessionListPage {
        items,
        page: page as u32,
        page_size: page_size as u32,
        total,
        has_more: false,
        partial,
        cache_state: Some(cache_state.as_str().to_string()),
        meta_complete,
        message_search_complete,
        available_paths: Some(available_paths),
        available_sources: contexts.available_sources,
    })
}

fn get_session_detail_blocking(
    contexts: SessionContextSet,
    source_path: String,
) -> Result<SessionDetail, String> {
    let (entry, meta) = find_session_with_context(&contexts, &source_path, false)?;
    let messages = load_messages(&entry.context, &meta.source_path)?;

    Ok(SessionDetail { meta, messages })
}

fn list_session_subagents_blocking(
    contexts: SessionContextSet,
    source_path: String,
) -> Result<Vec<SessionSubagentMeta>, String> {
    let (entry, meta) = find_session_with_context(&contexts, &source_path, false)?;
    let subagents = list_subagent_sessions(&entry.context, &meta.source_path);
    Ok(subagents)
}

fn get_subagent_session_detail_blocking(
    contexts: SessionContextSet,
    parent_source_path: String,
    subagent_source_path: String,
) -> Result<SessionDetail, String> {
    let (entry, parent) = find_session_with_context(&contexts, &parent_source_path, false)?;
    let subagent = list_subagent_sessions(&entry.context, &parent.source_path)
        .into_iter()
        .find(|item| item.source_path == subagent_source_path)
        .ok_or_else(|| "SubAgent session not found".to_string())?;

    let messages = load_messages(&entry.context, &subagent.source_path)?;
    let meta = SessionMeta {
        provider_id: parent.provider_id,
        session_id: subagent.id.clone(),
        title: Some(subagent.title),
        summary: subagent.summary,
        project_dir: parent.project_dir,
        created_at: subagent.first_message_time,
        last_active_at: subagent.last_message_time,
        source_path: subagent.source_path,
        resume_command: None,
        runtime_source: parent.runtime_source,
        runtime_distro: parent.runtime_distro,
    };

    Ok(SessionDetail { meta, messages })
}

fn list_session_paths_blocking(
    context: ToolSessionContext,
    limit: usize,
    force_refresh: bool,
) -> Result<Vec<String>, String> {
    let sessions = get_cached_sessions(&context, force_refresh);
    Ok(build_session_paths(&sessions, limit))
}

fn delete_session_blocking(contexts: SessionContextSet, source_path: String) -> Result<(), String> {
    find_session_with_context(&contexts, &source_path, true)
        .map(|(entry, session)| {
            delete_session_from_meta(&entry.context, &session)?;
            invalidate_cache(&entry.context);
            Ok(())
        })
        .unwrap_or_else(|error| Err(error))
}

fn delete_session_from_meta(
    context: &ToolSessionContext,
    session: &SessionMeta,
) -> Result<(), String> {
    match context {
        ToolSessionContext::Pi { .. } => {
            pi::delete_session(Path::new(&session.source_path))?;
        }
    }

    Ok(())
}

fn delete_sessions_blocking(
    contexts: SessionContextSet,
    source_paths: Vec<String>,
) -> DeleteToolSessionsResult {
    let mut deleted_count = 0usize;
    let mut failed_items = Vec::new();
    let mut seen_paths = HashSet::new();

    for source_path in source_paths {
        let trimmed_source_path = source_path.trim();
        if trimmed_source_path.is_empty() {
            continue;
        }

        let (entry, session) = match find_session_with_context(&contexts, trimmed_source_path, true)
        {
            Ok(found) => found,
            Err(error) => {
                failed_items.push(DeleteSessionFailure {
                    source_path: trimmed_source_path.to_string(),
                    error,
                });
                continue;
            }
        };

        let dedupe_key = format!(
            "{}:{}",
            entry.context.cache_key(),
            session.source_path.to_ascii_lowercase()
        );
        if !seen_paths.insert(dedupe_key) {
            continue;
        }

        match delete_session_from_meta(&entry.context, &session) {
            Ok(()) => {
                deleted_count += 1;
                invalidate_cache(&entry.context);
            }
            Err(error) => {
                failed_items.push(DeleteSessionFailure {
                    source_path: trimmed_source_path.to_string(),
                    error,
                });
            }
        }
    }

    DeleteToolSessionsResult {
        deleted_count,
        failed_items,
    }
}

fn build_session_paths(sessions: &[SessionMeta], limit: usize) -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for session in sessions {
        let Some(project_dir) = session.project_dir.as_deref() else {
            continue;
        };
        let normalized = project_dir.trim();
        if normalized.is_empty() {
            continue;
        }

        let dedupe_key = normalized.to_ascii_lowercase();
        if seen_paths.insert(dedupe_key) {
            paths.push(normalized.to_string());
        }

        if paths.len() >= limit {
            break;
        }
    }

    paths
}

fn export_session_blocking(
    contexts: SessionContextSet,
    tool: String,
    source_path: String,
    export_path: String,
    export_format: String,
) -> Result<(), String> {
    let (entry, meta) = find_session_with_context(&contexts, &source_path, false)?;
    export_session_to_path(
        &entry.context,
        &tool,
        &meta,
        &export_format,
        Path::new(&export_path),
    )
}

fn export_sessions_blocking(
    contexts: SessionContextSet,
    tool: String,
    source_paths: Vec<String>,
    export_dir: String,
    export_format: String,
) -> Result<ExportToolSessionsResult, String> {
    let export_dir_ref = Path::new(&export_dir);
    std::fs::create_dir_all(export_dir_ref).map_err(|error| {
        format!(
            "Failed to create export directory {}: {error}",
            export_dir_ref.display()
        )
    })?;

    let mut exported_items = Vec::new();
    let mut failed_items = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut used_file_names = HashSet::new();

    for source_path in source_paths {
        let trimmed_source_path = source_path.trim();
        if trimmed_source_path.is_empty() {
            continue;
        }

        let (entry, session) =
            match find_session_with_context(&contexts, trimmed_source_path, false) {
                Ok(found) => found,
                Err(error) => {
                    failed_items.push(ExportSessionFailure {
                        source_path: trimmed_source_path.to_string(),
                        error,
                    });
                    continue;
                }
            };

        let dedupe_key = format!(
            "{}:{}",
            entry.context.cache_key(),
            session.source_path.to_ascii_lowercase()
        );
        if !seen_paths.insert(dedupe_key) {
            continue;
        }

        let result = (|| -> Result<String, String> {
            let extension = export_file_extension(&export_format)?;
            let file_name = build_unique_export_file_name(
                &session,
                &tool,
                exported_items.len() + 1,
                &mut used_file_names,
                extension,
            );
            let export_path = export_dir_ref.join(file_name);
            export_session_to_path(
                &entry.context,
                &tool,
                &session,
                &export_format,
                &export_path,
            )?;
            Ok(export_path.to_string_lossy().to_string())
        })();

        match result {
            Ok(export_path) => exported_items.push(ExportSessionItem {
                source_path: session.source_path.clone(),
                export_path,
            }),
            Err(error) => failed_items.push(ExportSessionFailure {
                source_path: trimmed_source_path.to_string(),
                error,
            }),
        }
    }

    Ok(ExportToolSessionsResult {
        exported_count: exported_items.len(),
        exported_items,
        failed_items,
    })
}

fn build_exported_session_file(
    context: &ToolSessionContext,
    tool: String,
    session_detail: SessionDetail,
) -> Result<ExportedSessionFile, String> {
    let native_snapshot = build_native_snapshot(&session_detail.meta.source_path, context)?;
    Ok(ExportedSessionFile {
        version: EXPORT_SCHEMA_VERSION,
        schema: EXPORT_SCHEMA_NAME.to_string(),
        tool,
        exported_at: Utc::now().to_rfc3339(),
        meta: session_detail.meta,
        normalized_messages: session_detail.messages,
        native_snapshot,
    })
}

fn export_file_extension<'a>(export_format: &'a str) -> Result<&'a str, String> {
    match export_format {
        "ai_toolbox" => Ok("json"),
        _ => Err(format!(
            "Unsupported session export format: {export_format}"
        )),
    }
}

fn export_session_to_path(
    context: &ToolSessionContext,
    tool: &str,
    meta: &SessionMeta,
    export_format: &str,
    export_path: &Path,
) -> Result<(), String> {
    export_file_extension(export_format)?;
    match export_format {
        "ai_toolbox" => {
            let messages = load_messages(context, &meta.source_path)?;
            let session_detail = SessionDetail {
                meta: meta.clone(),
                messages,
            };
            let exported_file =
                build_exported_session_file(context, tool.to_string(), session_detail)?;
            write_exported_session_file(&exported_file, export_path)
        }
        _ => Err(format!(
            "Unsupported session export format: {export_format}"
        )),
    }
}

fn write_exported_session_file(
    exported_file: &ExportedSessionFile,
    export_path_ref: &Path,
) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(&exported_file)
        .map_err(|error| format!("Failed to serialize session export: {error}"))?;

    if let Some(parent_dir) = export_path_ref.parent() {
        std::fs::create_dir_all(parent_dir).map_err(|error| {
            format!(
                "Failed to create export directory {}: {error}",
                parent_dir.display()
            )
        })?;
    }

    std::fs::write(export_path_ref, serialized).map_err(|error| {
        format!(
            "Failed to write exported session file {}: {error}",
            export_path_ref.display()
        )
    })?;

    Ok(())
}

fn build_unique_export_file_name(
    meta: &SessionMeta,
    tool: &str,
    index: usize,
    used_file_names: &mut HashSet<String>,
    extension: &str,
) -> String {
    let title = meta
        .title
        .as_deref()
        .or(meta.summary.as_deref())
        .map(sanitize_export_file_component)
        .filter(|value| !value.is_empty());
    let session_id = sanitize_export_file_component(&meta.session_id);
    let base_name = match title {
        Some(title) => format!("{index:03}-{tool}-{title}-{session_id}"),
        None => format!("{index:03}-{tool}-{session_id}"),
    };
    let mut file_name = format!("{base_name}.{extension}");
    let mut suffix = 2usize;
    while !used_file_names.insert(file_name.to_ascii_lowercase()) {
        file_name = format!("{base_name}-{suffix}.{extension}");
        suffix += 1;
    }
    file_name
}

fn sanitize_export_file_component(value: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_separator = false;

    for character in value.chars() {
        let next = if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            last_was_separator = false;
            Some(character)
        } else if character.is_whitespace()
            || matches!(
                character,
                '.' | '/'
                    | '\\'
                    | ':'
                    | '*'
                    | '?'
                    | '"'
                    | '<'
                    | '>'
                    | '|'
                    | '['
                    | ']'
                    | '('
                    | ')'
                    | '{'
                    | '}'
            )
        {
            if last_was_separator {
                None
            } else {
                last_was_separator = true;
                Some('-')
            }
        } else if character.is_alphanumeric() {
            last_was_separator = false;
            Some(character)
        } else if last_was_separator {
            None
        } else {
            last_was_separator = true;
            Some('-')
        };

        if let Some(character) = next {
            sanitized.push(character);
        }

        if sanitized.len() >= 80 {
            break;
        }
    }

    sanitized.trim_matches('-').to_string()
}

fn import_session_blocking(
    context: ToolSessionContext,
    tool: String,
    import_path: String,
) -> Result<(), String> {
    let exported_file = read_exported_session_file(&import_path)?;
    validate_exported_session_file(&exported_file, &tool)?;

    let duplicate_exists = get_cached_sessions(&context, true)
        .into_iter()
        .any(|session| session.session_id == exported_file.meta.session_id);
    if duplicate_exists {
        return Err(format!(
            "Session {} already exists for {}",
            exported_file.meta.session_id, tool
        ));
    }

    match &context {
        ToolSessionContext::Pi { sessions_root } => {
            ensure_snapshot_format(&exported_file.native_snapshot, SNAPSHOT_FORMAT_PI)?;
            pi::import_native_snapshot(
                sessions_root,
                &exported_file.meta.session_id,
                &exported_file.native_snapshot.payload,
            )?;
        }
    }

    invalidate_cache(&context);
    Ok(())
}

fn rename_session_blocking(
    contexts: SessionContextSet,
    _tool: String,
    source_path: String,
    title: String,
) -> Result<(), String> {
    let (entry, session) = find_session_with_context(&contexts, &source_path, true)?;
    let context = entry.context;
    match &context {
        ToolSessionContext::Pi { .. } => {
            pi::rename_session(&session.source_path, &title)?;
            invalidate_cache(&context);
            Ok(())
        }
    }
}

fn build_native_snapshot(
    source_path: &str,
    context: &ToolSessionContext,
) -> Result<NativeSnapshot, String> {
    match context {
        ToolSessionContext::Pi { sessions_root } => Ok(NativeSnapshot {
            format: SNAPSHOT_FORMAT_PI.to_string(),
            payload: pi::export_native_snapshot(sessions_root, Path::new(source_path))?,
        }),
    }
}

fn read_exported_session_file(import_path: &str) -> Result<ExportedSessionFile, String> {
    let import_path_ref = Path::new(import_path);
    let data = std::fs::read_to_string(import_path_ref).map_err(|error| {
        format!(
            "Failed to read imported session file {}: {error}",
            import_path_ref.display()
        )
    })?;

    serde_json::from_str::<ExportedSessionFile>(&data).map_err(|error| {
        format!(
            "Invalid session export file {}: {error}",
            import_path_ref.display()
        )
    })
}

fn validate_exported_session_file(
    exported_file: &ExportedSessionFile,
    tool: &str,
) -> Result<(), String> {
    if exported_file.version != EXPORT_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported session export version: {}",
            exported_file.version
        ));
    }

    if exported_file.schema.trim() != EXPORT_SCHEMA_NAME {
        return Err(format!(
            "Unsupported session export schema: {}",
            exported_file.schema
        ));
    }

    let exported_tool = SessionTool::parse(exported_file.tool.trim())?
        .as_str()
        .to_string();

    if exported_tool != tool {
        return Err(format!(
            "Session export belongs to {}, but current tool is {}",
            exported_tool, tool
        ));
    }

    if exported_file.meta.session_id.trim().is_empty() {
        return Err("Session export is missing sessionId".to_string());
    }

    Ok(())
}

fn ensure_snapshot_format(snapshot: &NativeSnapshot, expected: &str) -> Result<(), String> {
    if snapshot.format == expected {
        return Ok(());
    }

    Err(format!(
        "Unexpected native snapshot format: expected {}, got {}",
        expected, snapshot.format
    ))
}

fn scan_sessions(context: &ToolSessionContext) -> Vec<SessionMeta> {
    let mut sessions = match context {
        ToolSessionContext::Pi { sessions_root } => pi::scan_sessions(sessions_root),
    };

    sessions.sort_by(|left, right| {
        let left_ts = left.last_active_at.or(left.created_at).unwrap_or(0);
        let right_ts = right.last_active_at.or(right.created_at).unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    sessions
}

fn scan_recent_sessions(context: &ToolSessionContext, limit: usize) -> Vec<SessionMeta> {
    let mut sessions = match context {
        ToolSessionContext::Pi { sessions_root } => pi::scan_recent_sessions(sessions_root, limit),
    };

    sessions.sort_by(|left, right| {
        let left_ts = left.last_active_at.or(left.created_at).unwrap_or(0);
        let right_ts = right.last_active_at.or(right.created_at).unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    sessions.truncate(limit);
    sessions
}

fn load_messages(
    context: &ToolSessionContext,
    source_path: &str,
) -> Result<Vec<SessionMessage>, String> {
    match context {
        ToolSessionContext::Pi { .. } => pi::load_messages(Path::new(source_path)),
    }
}

fn list_subagent_sessions(
    _context: &ToolSessionContext,
    _source_path: &str,
) -> Vec<SessionSubagentMeta> {
    // Pi does not support subagent sessions at this time
    Vec::new()
}

fn get_cached_sessions(context: &ToolSessionContext, force_refresh: bool) -> Vec<SessionMeta> {
    let cache_key = context.cache_key();

    if let Ok(mut cache) = SESSION_LIST_CACHE.lock() {
        if force_refresh {
            cache.remove(&cache_key);
        } else if let Some(entry) = cache.get(&cache_key) {
            if entry.created_at.elapsed() <= SESSION_CACHE_TTL {
                return entry.sessions.clone();
            }

            cache.remove(&cache_key);
        }
    }

    let sessions = scan_sessions(context);

    if let Ok(mut cache) = SESSION_LIST_CACHE.lock() {
        if cache.len() >= MAX_SESSION_CACHE_ENTRIES {
            let oldest_key = cache
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(key, _)| key.clone());
            if let Some(oldest_key) = oldest_key {
                cache.remove(&oldest_key);
            }
        }

        cache.insert(
            cache_key,
            SessionCacheEntry {
                created_at: Instant::now(),
                sessions: sessions.clone(),
            },
        );
    }

    sessions
}

fn get_fresh_cached_sessions(context: &ToolSessionContext) -> Option<Vec<SessionMeta>> {
    let cache_key = context.cache_key();

    let Ok(cache) = SESSION_LIST_CACHE.lock() else {
        return None;
    };

    if let Some(entry) = cache.get(&cache_key) {
        if entry.created_at.elapsed() <= SESSION_CACHE_TTL {
            return Some(entry.sessions.clone());
        }
    }

    None
}

fn get_any_cached_sessions(
    context: &ToolSessionContext,
) -> Option<(Vec<SessionMeta>, SessionListCacheState)> {
    let cache_key = context.cache_key();

    let Ok(cache) = SESSION_LIST_CACHE.lock() else {
        return None;
    };

    let entry = cache.get(&cache_key)?;
    let cache_state = if entry.created_at.elapsed() <= SESSION_CACHE_TTL {
        SessionListCacheState::Fresh
    } else {
        SessionListCacheState::Stale
    };

    Some((entry.sessions.clone(), cache_state))
}

fn invalidate_cache(context: &ToolSessionContext) {
    let cache_key = context.cache_key();
    if let Ok(mut cache) = SESSION_LIST_CACHE.lock() {
        cache.remove(&cache_key);
    }
}

fn scan_session_content_for_query(
    context: &ToolSessionContext,
    source_path: &str,
    query_lower: &str,
) -> Result<bool, String> {
    match context {
        ToolSessionContext::Pi { .. } => {
            pi::scan_messages_for_query(Path::new(source_path), query_lower)
        }
    }
}

fn meta_matches_query(session: &SessionMeta, query_lower: &str) -> bool {
    contains_query(&session.session_id, query_lower)
        || contains_query(&session.source_path, query_lower)
        || session
            .title
            .as_deref()
            .map(|value| contains_query(value, query_lower))
            .unwrap_or(false)
        || session
            .summary
            .as_deref()
            .map(|value| contains_query(value, query_lower))
            .unwrap_or(false)
        || session
            .project_dir
            .as_deref()
            .map(|value| contains_query(value, query_lower))
            .unwrap_or(false)
        || session
            .runtime_source
            .as_deref()
            .map(|value| contains_query(value, query_lower))
            .unwrap_or(false)
        || session
            .runtime_distro
            .as_deref()
            .map(|value| contains_query(value, query_lower))
            .unwrap_or(false)
}

fn session_id_exact_matches_query(session: &SessionMeta, query_lower: &str) -> bool {
    session.session_id.to_lowercase() == query_lower
}

fn contains_query(value: &str, query_lower: &str) -> bool {
    value.to_lowercase().contains(query_lower)
}

fn normalize_query(query: Option<String>) -> Option<String> {
    query
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn resolve_session_contexts(
    db: &crate::db::SqliteDbState,
    tool: SessionTool,
) -> Result<SessionContextSet, String> {
    let primary_context = resolve_context(db, tool).await?;
    let primary_entry = session_context_entry(primary_context);

    let entries = vec![primary_entry];

    Ok(session_context_set(entries))
}

fn session_context_entry(context: ToolSessionContext) -> SessionContextEntry {
    if let Some(wsl) = context_wsl_info(&context) {
        return SessionContextEntry {
            context,
            source: SessionRuntimeSource::Wsl,
            distro: Some(wsl.distro),
        };
    }

    SessionContextEntry {
        context,
        source: SessionRuntimeSource::Local,
        distro: None,
    }
}

fn context_wsl_info(context: &ToolSessionContext) -> Option<WslLocationInfo> {
    match context {
        ToolSessionContext::Pi { sessions_root } => path_wsl_info(sessions_root),
    }
}

fn path_wsl_info(path: &Path) -> Option<WslLocationInfo> {
    path.to_str()
        .and_then(crate::coding::runtime_location::parse_wsl_unc_path)
}

fn build_available_sources(entries: &[SessionContextEntry]) -> Vec<SessionSourceOption> {
    let mut sources = Vec::new();
    let mut seen = HashSet::new();

    for source in [SessionRuntimeSource::Local, SessionRuntimeSource::Wsl] {
        let Some(entry) = entries.iter().find(|entry| entry.source == source) else {
            continue;
        };

        if seen.insert(source.as_str()) {
            sources.push(SessionSourceOption {
                source: source.as_str().to_string(),
                distro: entry.distro.clone(),
            });
        }
    }

    sources
}

fn session_context_set(entries: Vec<SessionContextEntry>) -> SessionContextSet {
    let available_sources = build_available_sources(&entries);
    SessionContextSet {
        entries,
        available_sources,
    }
}

async fn resolve_context(
    db: &crate::db::SqliteDbState,
    tool: SessionTool,
) -> Result<ToolSessionContext, String> {
    match tool {
        SessionTool::Pi => {
            let runtime_location = get_pi_runtime_location_async(db).await?;
            let sessions_root = resolve_pi_sessions_root(&runtime_location)?;
            Ok(ToolSessionContext::Pi { sessions_root })
        }
    }
}

/// Resolve the Pi sessions root for other modules (e.g. token stats).
/// Shares the same runtime-location + settings.json sessionDir resolution
/// as the session manager so all session-file consumers scan the same directory.
pub(crate) async fn resolve_pi_sessions_root_with_db(
    db: &crate::db::SqliteDbState,
) -> Result<PathBuf, String> {
    let runtime_location = get_pi_runtime_location_async(db).await?;
    resolve_pi_sessions_root(&runtime_location)
}

fn resolve_pi_sessions_root(location: &RuntimeLocationInfo) -> Result<PathBuf, String> {
    const SESSION_DIR_ENV_KEY: &str = "PI_CODING_AGENT_SESSION_DIR";

    if let Ok(session_dir) = std::env::var(SESSION_DIR_ENV_KEY) {
        if !session_dir.trim().is_empty() {
            return resolve_pi_session_dir_value(location, session_dir.trim());
        }
    }

    let settings_path = location.host_path.join("settings.json");
    if let Ok(content) = std::fs::read_to_string(&settings_path) {
        if !content.trim().is_empty() {
            let settings: Value = serde_json::from_str(&content).map_err(|error| {
                format!(
                    "Failed to parse Pi settings for sessionDir {}: {error}",
                    settings_path.display()
                )
            })?;
            if let Some(session_dir) = settings
                .get("sessionDir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return resolve_pi_session_dir_value(location, session_dir);
            }
        }
    }

    Ok(location.host_path.join("sessions"))
}

fn resolve_pi_session_dir_value(
    location: &RuntimeLocationInfo,
    session_dir: &str,
) -> Result<PathBuf, String> {
    if let Some(wsl) = &location.wsl {
        if is_windows_style_path(session_dir) {
            return Err(format!(
                "Pi sessionDir '{}' is a Windows-style path but the current Pi runtime is WSL Direct. Use a Linux path such as ~/.pi/agent/sessions or /home/<user>/sessions.",
                session_dir
            ));
        }

        let linux_session_dir = session_dir.replace('\\', "/");
        if linux_session_dir == "~" || linux_session_dir.starts_with("~/") {
            let linux_path =
                expand_home_from_user_root(wsl.linux_user_root.as_deref(), &linux_session_dir);
            return Ok(crate::coding::runtime_location::build_windows_unc_path(
                &wsl.distro,
                &linux_path,
            ));
        }
        if linux_session_dir.starts_with('/') {
            return Ok(crate::coding::runtime_location::build_windows_unc_path(
                &wsl.distro,
                &linux_session_dir,
            ));
        }

        let linux_path = format!(
            "{}/{}",
            wsl.linux_path.trim_end_matches('/'),
            linux_session_dir.trim_start_matches('/')
        );
        return Ok(crate::coding::runtime_location::build_windows_unc_path(
            &wsl.distro,
            &linux_path,
        ));
    }

    if session_dir == "~" || session_dir.starts_with("~/") || session_dir.starts_with("~\\") {
        let home = get_home_dir()?;
        let rest = session_dir
            .trim_start_matches('~')
            .trim_start_matches(['/', '\\']);
        return Ok(if rest.is_empty() {
            home
        } else {
            home.join(rest)
        });
    }

    let path = PathBuf::from(session_dir);
    if path.is_absolute() {
        return Ok(path);
    }

    Ok(location.host_path.join(path))
}

fn expand_home_from_user_root(user_root: Option<&str>, path: &str) -> String {
    let user_root = user_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("/root");
    let rest = path.trim_start_matches('~').trim_start_matches('/');
    if rest.is_empty() {
        user_root.to_string()
    } else {
        format!(
            "{}/{}",
            user_root.trim_end_matches('/'),
            rest.trim_start_matches('/')
        )
    }
}

fn is_windows_style_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with("\\\\")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

fn get_home_dir() -> Result<PathBuf, String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| "Failed to get home directory".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    use serde_json::json;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ai-toolbox-session-manager-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&path).expect("failed to create test directory");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn pi_wsl_location() -> RuntimeLocationInfo {
        RuntimeLocationInfo {
            mode: crate::coding::runtime_location::RuntimeLocationMode::WslDirect,
            source: "test".to_string(),
            host_path: PathBuf::from(r"\\wsl.localhost\Ubuntu\home\tester\.pi\agent"),
            wsl: Some(crate::coding::runtime_location::WslLocationInfo {
                distro: "Ubuntu".to_string(),
                linux_path: "/home/tester/.pi/agent".to_string(),
                linux_user_root: Some("/home/tester".to_string()),
            }),
        }
    }

    #[test]
    fn resolve_pi_session_dir_value_wsl_expands_backslash_tilde() {
        let resolved =
            resolve_pi_session_dir_value(&pi_wsl_location(), r"~\sessions").expect("resolve");

        assert_eq!(
            resolved.to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\tester\sessions"
        );
    }

    #[test]
    fn resolve_pi_session_dir_value_wsl_rejects_windows_drive_path() {
        let error = resolve_pi_session_dir_value(&pi_wsl_location(), r"D:\sessions")
            .expect_err("windows path should be rejected in WSL Direct");

        assert!(error.contains("Windows-style path"));
    }

    #[test]
    fn query_filter_short_circuits_exact_session_id_before_content_scan() {
        let test_root = TestDir::new("exact-session-id-query");
        let exact_session_id = "exact-session-id";
        let content_match_path = test_root.path().join("content-match.jsonl");
        fs::write(
            &content_match_path,
            json!({
                "type": "session",
                "id": "content-match-session",
                "timestamp": "2026-06-21T09:00:00.000Z",
                "cwd": "/tmp/project"
            })
            .to_string(),
        )
        .expect("write content match session");

        let contexts = SessionContextSet {
            entries: vec![SessionContextEntry {
                context: ToolSessionContext::Pi {
                    sessions_root: test_root.path().to_path_buf(),
                },
                source: SessionRuntimeSource::Local,
                distro: None,
            }],
            available_sources: Vec::new(),
        };
        let sessions = vec![
            SessionWithContext {
                context_index: 0,
                meta: SessionMeta {
                    provider_id: "pi".to_string(),
                    session_id: exact_session_id.to_string(),
                    title: None,
                    summary: None,
                    project_dir: None,
                    created_at: None,
                    last_active_at: None,
                    source_path: test_root
                        .path()
                        .join("missing-exact-session.jsonl")
                        .to_string_lossy()
                        .to_string(),
                    resume_command: None,
                    runtime_source: None,
                    runtime_distro: None,
                },
            },
            SessionWithContext {
                context_index: 0,
                meta: SessionMeta {
                    provider_id: "pi".to_string(),
                    session_id: "content-match-session".to_string(),
                    title: None,
                    summary: None,
                    project_dir: None,
                    created_at: None,
                    last_active_at: None,
                    source_path: content_match_path.to_string_lossy().to_string(),
                    resume_command: None,
                    runtime_source: None,
                    runtime_distro: None,
                },
            },
        ];

        let (filtered, exact_session_id_match) =
            filter_sessions_by_query_with_context(&contexts, sessions, exact_session_id, true);

        assert!(exact_session_id_match);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].meta.session_id, exact_session_id);
    }

    #[test]
    fn cache_first_skips_uncached_wsl_context_for_initial_page() {
        let test_root = TestDir::new("cache-first-skips-uncached-wsl");
        let local_root = test_root.path().join("local").join("sessions");
        let wsl_root = test_root.path().join("wsl").join("sessions");
        let local_project_dir = test_root.path().join("local-project");
        let wsl_project_dir = test_root.path().join("wsl-project");

        write_text_file(
            &local_root
                .join("2026")
                .join("07")
                .join("04")
                .join("rollout-2026-07-04T08-00-00-local-session.jsonl"),
            &json!({
                "type": "session",
                "id": "local-session",
                "timestamp": "2026-07-04T08:00:00Z",
                "cwd": local_project_dir.to_string_lossy().to_string(),
            })
            .to_string(),
        );
        write_text_file(
            &wsl_root
                .join("2026")
                .join("07")
                .join("04")
                .join("rollout-2026-07-04T08-01-00-wsl-session.jsonl"),
            &json!({
                "type": "session",
                "id": "wsl-session",
                "timestamp": "2026-07-04T08:01:00Z",
                "cwd": wsl_project_dir.to_string_lossy().to_string(),
            })
            .to_string(),
        );

        let contexts = SessionContextSet {
            entries: vec![
                SessionContextEntry {
                    context: ToolSessionContext::Pi {
                        sessions_root: local_root.clone(),
                    },
                    source: SessionRuntimeSource::Local,
                    distro: None,
                },
                SessionContextEntry {
                    context: ToolSessionContext::Pi {
                        sessions_root: wsl_root.clone(),
                    },
                    source: SessionRuntimeSource::Wsl,
                    distro: Some("Debian".to_string()),
                },
            ],
            available_sources: Vec::new(),
        };
        let full_contexts = SessionContextSet {
            entries: vec![
                SessionContextEntry {
                    context: ToolSessionContext::Pi {
                        sessions_root: local_root,
                    },
                    source: SessionRuntimeSource::Local,
                    distro: None,
                },
                SessionContextEntry {
                    context: ToolSessionContext::Pi {
                        sessions_root: wsl_root,
                    },
                    source: SessionRuntimeSource::Wsl,
                    distro: Some("Debian".to_string()),
                },
            ],
            available_sources: Vec::new(),
        };

        let result = list_sessions_blocking(
            contexts,
            SessionSourceMode::All,
            None,
            None,
            1,
            10,
            false,
            SessionListLoadMode::CacheFirst,
        )
        .expect("cache-first list should succeed");

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].session_id, "local-session");
        assert_eq!(result.items[0].runtime_source.as_deref(), Some("local"));
        assert!(result.partial);
        assert_eq!(result.cache_state.as_deref(), Some("quick"));
        assert!(!result.has_more);
        assert!(!result.meta_complete);
        assert!(result.message_search_complete);

        let full_result = list_sessions_blocking(
            full_contexts,
            SessionSourceMode::All,
            None,
            None,
            1,
            10,
            false,
            SessionListLoadMode::Full,
        )
        .expect("full list should succeed");

        let full_session_ids: Vec<&str> = full_result
            .items
            .iter()
            .map(|session| session.session_id.as_str())
            .collect();
        // sort is by last_active_at desc, both sessions have no last_active_at,
        // so they sort by created_at (both None) → falls back to 0, order
        // depends on scan order which is mixed; just verify both are present.
        assert_eq!(full_session_ids.len(), 2);
        assert!(full_session_ids.contains(&"local-session"));
        assert!(full_session_ids.contains(&"wsl-session"));
        assert!(!full_result.partial);
        assert!(!full_result.has_more);
        assert!(full_result.meta_complete);
    }

    #[test]
    fn validate_exported_session_file_rejects_tool_mismatch() {
        let exported_file = ExportedSessionFile {
            version: EXPORT_SCHEMA_VERSION,
            schema: EXPORT_SCHEMA_NAME.to_string(),
            tool: "pi".to_string(),
            exported_at: "2026-03-31T00:00:00Z".to_string(),
            meta: SessionMeta {
                provider_id: "pi".to_string(),
                session_id: "session-1".to_string(),
                title: None,
                summary: None,
                project_dir: None,
                created_at: None,
                last_active_at: None,
                source_path: "/tmp/session.jsonl".to_string(),
                resume_command: None,
                runtime_source: None,
                runtime_distro: None,
            },
            normalized_messages: Vec::new(),
            native_snapshot: NativeSnapshot {
                format: SNAPSHOT_FORMAT_PI.to_string(),
                payload: json!({}),
            },
        };

        // Pi export should pass for "pi" tool
        let result = validate_exported_session_file(&exported_file, "pi");
        assert!(result.is_ok());

        // But "pi" export should fail for a non-existent tool
        let bad_file = ExportedSessionFile {
            tool: "unknown_tool".to_string(),
            ..exported_file.clone()
        };
        let result = validate_exported_session_file(&bad_file, "pi");
        assert!(result.is_err());
    }

    fn write_text_file(path: &Path, content: &str) {
        if let Some(parent_dir) = path.parent() {
            fs::create_dir_all(parent_dir).expect("failed to create parent directory");
        }
        fs::write(path, content).expect("failed to write test file");
    }
}
