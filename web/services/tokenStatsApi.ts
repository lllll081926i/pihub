import { invoke } from '@tauri-apps/api/core';

export interface TokenDayBucket {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  messageCount: number;
}

export interface TokenModelBucket {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  messageCount: number;
}

export interface TokenStatsResult {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheWriteTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  totalMessages: number;
  sessionCount: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
  cacheSavingsUsd: number;
  days: TokenDayBucket[];
  models: TokenModelBucket[];
}

export const getTokenStats = async (): Promise<TokenStatsResult> => {
  return await invoke<TokenStatsResult>('get_token_stats');
};

/** 后台静默重扫：扫描会话文件、更新 SQLite 缓存并返回最新统计。 */
export const refreshTokenStats = async (): Promise<TokenStatsResult> => {
  return await invoke<TokenStatsResult>('refresh_token_stats');
};

/** 清理 Token 统计缓存（设置页“清理缓存”）。 */
export const clearTokenStatsCache = async (): Promise<void> => {
  return await invoke<void>('clear_token_stats_cache');
};
