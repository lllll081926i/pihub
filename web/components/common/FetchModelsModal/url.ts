/**
 * Build the model-list endpoint URL shown in FetchModelsModal.
 *
 * Path suffixes must stay in sync with the backend
 * `tauri/src/coding/pi/models_fetch.rs` (build_models_endpoint), including its
 * idempotency: a base that already carries the `/models` path (or the
 * provider-specific version segment) is used as-is instead of appending a
 * duplicate suffix. A query string, when present, is re-appended after the
 * path suffix so it never lands in the middle of the URL.
 * - OpenAI compatible -> `<base>/models`
 * - Anthropic native  -> `<base>/v1/models`
 * - Google native     -> `<base>/v1beta/models?key=<key>`
 */

/** Version segment such as `/v1`, `/v1beta`, `/api/v1`, `/v1.5` (case-insensitive). */
const VERSION_SEGMENT_RE = /(?:^|\/)v\d+(?:\.\d+)?(?:beta)?$/i;

export const buildFetchModelsUrl = (
  baseUrl: string,
  apiType: 'native' | 'openai_compat',
  sdkType?: string,
  apiKey?: string,
): string => {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return '';
  }

  // Keep any query string out of the path so it cannot end up mid-URL.
  const [pathPart, ...queryParts] = trimmed.split('?');
  const base = (pathPart ?? '').replace(/\/+$/, '');
  if (!base) {
    return '';
  }
  const query = queryParts.length > 0 ? queryParts.join('?') : '';
  const pathHasModels = base.endsWith('/models');
  const pathHasVersion = VERSION_SEGMENT_RE.test(base);

  let path: string;
  if (apiType === 'native' && sdkType === '@ai-sdk/google') {
    if (pathHasModels) {
      path = base;
    } else if (pathHasVersion) {
      path = `${base}/models`;
    } else {
      path = `${base}/v1beta/models`;
    }
  } else if (apiType === 'native' && sdkType === '@ai-sdk/anthropic') {
    if (base.endsWith('/v1/models')) {
      path = base;
    } else if (base.endsWith('/v1') || pathHasVersion) {
      path = `${base}/models`;
    } else {
      path = `${base}/v1/models`;
    }
  } else if (pathHasModels) {
    path = base;
  } else {
    path = `${base}/models`;
  }

  let url = query ? `${path}?${query}` : path;
  if (apiType === 'native' && sdkType === '@ai-sdk/google' && apiKey) {
    url = url.includes('?') ? `${url}&key=${apiKey}` : `${url}?key=${apiKey}`;
  }
  return url;
};
