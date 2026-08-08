import type { AllApiHubProviderCandidate } from '../../../../services/providerApi';
import type { OpenCodeModel, OpenCodeProvider } from '../../../../types/opencode';
import {
  PI_INPUT_TYPES,
  PI_THINKING_LEVEL_KEYS,
  PI_THINKING_LEVEL_OPTIONS,
  buildPiThinkingLevelMapFromPreset,
  isPiThinkingLevelMapEntrySupported,
} from '../../../../utils/piModelMetadata';

export const PI_API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
].map((value) => ({ value, label: value }));

// API 类型短标签：卡片上只显示协议名，省略 provider 前缀
const PI_API_SHORT_LABELS: Record<string, string> = {
  'openai-completions': 'completions',
  'openai-responses': 'responses',
  'anthropic-messages': 'messages',
  'google-generative-ai': 'generative-ai',
};

export const shortPiApiLabel = (api: string): string => PI_API_SHORT_LABELS[api] ?? api;

export const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

export const getStringField = (value: Record<string, unknown>, key: string): string => {
  const fieldValue = value[key];
  return typeof fieldValue === 'string' ? fieldValue : '';
};

export const getNumberField = (value: Record<string, unknown>, key: string): number | undefined => {
  const fieldValue = value[key];
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : undefined;
};

export const stringifyRecordField = (value: unknown): string | undefined => {
  const record = asRecord(value);
  return isRecordEmpty(record) ? undefined : JSON.stringify(record, null, 2);
};

export const stringifyStringArrayField = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length > 0 ? JSON.stringify(strings) : undefined;
};

export const parseJsonRecord = (value: string | undefined): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
};

export const parseStringArray = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
};

export const getProviderModelRecords = (
  providerConfig: Record<string, unknown> | undefined,
): Array<{ id: string; model: Record<string, unknown> }> => {
  if (!providerConfig) {
    return [];
  }
  const models = providerConfig.models;
  if (!Array.isArray(models)) {
    return [];
  }
  return models
    .map((model) => {
      if (typeof model === 'string') {
        return { id: model, model: { id: model } };
      }
      if (model && typeof model === 'object' && typeof (model as Record<string, unknown>).id === 'string') {
        return {
          id: (model as Record<string, string>).id,
          model: model as Record<string, unknown>,
        };
      }
      return null;
    })
    .filter((entry): entry is { id: string; model: Record<string, unknown> } => !!entry);
};

export const setOptionalStringField = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (typeof value === 'string' && value.trim()) {
    target[key] = value.trim();
  } else {
    delete target[key];
  }
};

/**
 * 自动补全供应商服务地址：OpenAI 兼容接口的 baseUrl 缺少 `/v1` 后缀时自动追加。
 *
 * - 仅对 `openai-completions` / `openai-chat` 这类 OpenAI 兼容 API 生效；
 * - 地址为空、已含 `/v1`（路径尾）、已含版本段（如 `/v1beta`、`/api/v1`）或非 http(s) 地址时不改写；
 * - 同时处理尾斜杠，避免写成 `https://host/v1/`。
 */
export const normalizeProviderBaseUrl = (baseUrl: string, api?: string): string => {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  const isOpenAiCompat = !api || api === 'openai-completions' || api === 'openai-chat';
  if (!isOpenAiCompat || !/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  // 已含 v1（含 v1beta / api/v1 / v1.5 等版本段）时视为用户已显式指定，不再补全
  if (/(^|\/)+v\d+(?:beta)?$/i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}/v1`;
};

export const isRecordEmpty = (value: Record<string, unknown>): boolean => Object.keys(value).length === 0;

export const createDefaultProviderConfig = (): Record<string, unknown> => ({
  api: 'openai-completions',
  baseUrl: '',
  models: [],
});

export const hasProviderConfigContent = (providerConfig: Record<string, unknown>): boolean => (
  Object.values(providerConfig).some((value) => {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim() !== '';
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === 'object') {
      return !isRecordEmpty(asRecord(value));
    }
    return true;
  })
);

const buildPiThinkingLevelOptionLabel = (levelKey: string, mappedValue: unknown): string => {
  if (typeof mappedValue === 'string' && mappedValue.trim() && mappedValue !== levelKey) {
    return `${levelKey} (${mappedValue})`;
  }
  return levelKey;
};

export const getPiModelThinkingLevelOptions = (
  model: Record<string, unknown> | undefined,
): Array<{ value: string; label: string }> => {
  if (!model || model.reasoning === false) {
    return [];
  }

  const thinkingLevelMap = asRecord(model.thinkingLevelMap);
  if (!isRecordEmpty(thinkingLevelMap)) {
    return PI_THINKING_LEVEL_KEYS
      .filter((levelKey) => isPiThinkingLevelMapEntrySupported(levelKey, thinkingLevelMap))
      .map((levelKey) => ({
        value: levelKey,
        label: buildPiThinkingLevelOptionLabel(levelKey, thinkingLevelMap[levelKey]),
      }));
  }

  return model.reasoning === true ? PI_THINKING_LEVEL_OPTIONS : [];
};

export const isPiThinkingLevelSupported = (
  thinkingLevel: string | undefined,
  model: Record<string, unknown> | undefined,
): boolean => {
  if (!thinkingLevel) {
    return true;
  }
  return getPiModelThinkingLevelOptions(model).some((option) => option.value === thinkingLevel);
};

export const asStringRecord = (value: unknown): Record<string, string> => {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
};

const sdkNameToPiApi = (sdkName?: string): string => {
  switch (sdkName) {
    case '@ai-sdk/anthropic':
      return 'anthropic-messages';
    case '@ai-sdk/google':
      return 'google-generative-ai';
    default:
      return 'openai-completions';
  }
};

const buildPiModelFromOpenCodeModel = (
  modelId: string,
  model: OpenCodeModel,
): Record<string, unknown> => {
  const inputTypes = (model.modalities?.input ?? []).filter((inputType) => PI_INPUT_TYPES.has(inputType));
  const thinkingLevelMap = buildPiThinkingLevelMapFromPreset(model.variants);

  return {
    id: model.id || modelId,
    name: model.name || modelId,
    ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
    ...(inputTypes.length > 0 ? { input: inputTypes } : {}),
    ...(typeof model.limit?.context === 'number' ? { contextWindow: model.limit.context } : {}),
    ...(typeof model.limit?.output === 'number' ? { maxTokens: model.limit.output } : {}),
    ...(!isRecordEmpty(thinkingLevelMap) ? { thinkingLevelMap } : {}),
  };
};

export const buildPiModelsProviderFromOpenCodeProvider = (
  provider: OpenCodeProvider,
): Record<string, unknown> => {
  const options = provider.options ?? {};
  const headers = asStringRecord(options.headers);
  const models = Object.entries(provider.models || {}).map(([modelId, model]) =>
    buildPiModelFromOpenCodeModel(modelId, model),
  );

  return {
    ...(provider.name ? { name: provider.name } : {}),
    api: sdkNameToPiApi(provider.npm),
    ...(options.baseURL ? { baseUrl: options.baseURL } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(!isRecordEmpty(headers) ? { headers } : {}),
    models,
  };
};

/**
 * Build a Pi models provider config from an All API Hub candidate.
 * The candidate carries npm/baseUrl/apiKey; model entries are empty and
 * managed separately through Pi model management.
 */
export const buildOpenCodeProviderFromAllApiHubCandidate = (
  candidate: AllApiHubProviderCandidate,
): OpenCodeProvider => ({
  npm: candidate.npm,
  name: candidate.name,
  options: {
    baseURL: candidate.baseUrl || '',
    ...(candidate.apiKey ? { apiKey: candidate.apiKey } : {}),
  },
  models: {},
});
