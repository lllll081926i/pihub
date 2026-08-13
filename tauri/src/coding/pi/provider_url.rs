//! Provider base URL normalization (api-aware, idempotent).
//!
//! Single source of truth for the "auto suffix" behavior. Mirrors the frontend
//! `normalizeProviderBaseUrl` (`web/features/coding/pi/utils/piProviderConfig.ts`)
//! — keep both implementations in sync.
//!
//! Rules:
//! - OpenAI-compatible APIs (`openai-completions` / `openai-responses` /
//!   `openai-chat`, or unset) get `/v1` appended.
//! - `anthropic-messages` gets `/v1`; `google-generative-ai` / `google-vertex`
//!   get `/v1beta`.
//! - Idempotent: a base that already carries a version segment (`/v1`,
//!   `/v1beta`, `/api/v1`, `/v1.5`, ...) or a full `/models` path is used as-is.
//! - Query strings are preserved after the path suffix; non-http(s) and empty
//!   values are returned unchanged.

/// Version segment such as `/v1`, `/v1beta`, `/api/v1`, `/v1.5` (case-insensitive).
fn path_has_version_segment(path: &str) -> bool {
    static VERSION_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = VERSION_RE.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:^|/)v\d+(?:\.\d+)?(?:beta)?$")
            .expect("static version-segment regex is valid")
    });
    re.is_match(path)
}

fn default_version_suffix(api: Option<&str>) -> &'static str {
    match api {
        Some("google-generative-ai") | Some("google-vertex") => "/v1beta",
        // OpenAI-compatible + anthropic-messages both serve under /v1
        _ => "/v1",
    }
}

/// Whether the api type is one of the suffix-normalized set. Used by the
/// checkup probe to avoid testing providers we would never normalize.
pub(crate) fn api_supports_normalization(api: Option<&str>) -> bool {
    matches!(
        api,
        None | Some("openai-completions")
            | Some("openai-responses")
            | Some("openai-chat")
            | Some("anthropic-messages")
            | Some("google-generative-ai")
            | Some("google-vertex")
    )
}

/// Normalize a provider base URL by appending the api-appropriate version
/// suffix when missing. Returns the input unchanged when no rule applies.
pub fn normalize_provider_base_url(base_url: &str, api: Option<&str>) -> String {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    let is_supported_api = api_supports_normalization(api);
    if !is_supported_api {
        return trimmed.to_string();
    }
    if !trimmed.to_ascii_lowercase().starts_with("http://")
        && !trimmed.to_ascii_lowercase().starts_with("https://")
    {
        return trimmed.to_string();
    }

    // Split off query/fragment first so the suffix never lands after them.
    let (without_fragment, fragment) = match trimmed.split_once('#') {
        Some((head, fragment)) => (head, Some(fragment)),
        None => (trimmed, None),
    };
    let (path_part, query) = match without_fragment.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (without_fragment, None),
    };
    let path = path_part.trim_end_matches('/');
    let tail = match (query, fragment) {
        (Some(query), Some(fragment)) => format!("?{query}#{fragment}"),
        (Some(query), None) => format!("?{query}"),
        (None, Some(fragment)) => format!("#{fragment}"),
        (None, None) => String::new(),
    };

    // Already versioned or already a full /models endpoint: treat as explicit.
    if path_has_version_segment(path) || path.to_ascii_lowercase().ends_with("/models") {
        return format!("{path}{tail}");
    }

    let suffix = default_version_suffix(api);
    format!("{path}{suffix}{tail}")
}

/// Map a Pi provider `api` string to the fetch-models target used by
/// `models_fetch::build_models_endpoint` (`api_type`, `sdk_type`).
pub fn pi_api_to_fetch_target(api: Option<&str>) -> (&'static str, &'static str) {
    match api {
        Some("anthropic-messages") => ("native", "@ai-sdk/anthropic"),
        Some("google-generative-ai") | Some("google-vertex") => ("native", "@ai-sdk/google"),
        _ => ("openai_compat", "@ai-sdk/openai-compatible"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_compat_appends_v1() {
        assert_eq!(
            normalize_provider_base_url("https://api.example.com", None),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_provider_base_url("https://api.example.com/", Some("openai-completions")),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_provider_base_url("https://openrouter.ai/api", Some("openai-responses")),
            "https://openrouter.ai/api/v1"
        );
    }

    #[test]
    fn anthropic_appends_v1() {
        assert_eq!(
            normalize_provider_base_url("https://api.anthropic.com", Some("anthropic-messages")),
            "https://api.anthropic.com/v1"
        );
    }

    #[test]
    fn google_appends_v1beta() {
        assert_eq!(
            normalize_provider_base_url(
                "https://generativelanguage.googleapis.com",
                Some("google-generative-ai")
            ),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            normalize_provider_base_url("https://example.com", Some("google-vertex")),
            "https://example.com/v1beta"
        );
    }

    #[test]
    fn idempotent_for_versioned_or_models_paths() {
        for (input, api) in [
            ("https://api.example.com/v1", None),
            ("https://api.example.com/v1/", None),
            ("https://api.example.com/api/v1", None),
            ("https://api.example.com/v1.5", None),
            ("https://api.anthropic.com/v1", Some("anthropic-messages")),
            ("https://example.com/v1beta", Some("google-generative-ai")),
            ("https://api.example.com/v1/models", None),
        ] {
            assert_eq!(normalize_provider_base_url(input, api), input.trim_end_matches('/'));
        }
    }

    #[test]
    fn preserves_query_after_suffix() {
        assert_eq!(
            normalize_provider_base_url("https://api.example.com?token=x", None),
            "https://api.example.com/v1?token=x"
        );
        assert_eq!(
            normalize_provider_base_url("https://api.example.com/v1?token=x", None),
            "https://api.example.com/v1?token=x"
        );
    }

    #[test]
    fn fragment_stays_after_suffix() {
        assert_eq!(
            normalize_provider_base_url("https://api.example.com#frag", None),
            "https://api.example.com/v1#frag"
        );
        assert_eq!(
            normalize_provider_base_url("https://api.example.com/v1?token=x#frag", None),
            "https://api.example.com/v1?token=x#frag"
        );
    }

    #[test]
    fn unsupported_api_and_non_http_are_untouched() {
        assert_eq!(
            normalize_provider_base_url("https://api.example.com", Some("azure-openai")),
            "https://api.example.com"
        );
        assert_eq!(
            normalize_provider_base_url("localhost:8317", None),
            "localhost:8317"
        );
        assert_eq!(normalize_provider_base_url("", None), "");
        assert_eq!(normalize_provider_base_url("   ", None), "");
    }
}
