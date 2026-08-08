/**
 * Provider API Service
 *
 * Provider management for Pi: favorite providers, All API Hub integration.
 */

import { invoke } from '@tauri-apps/api/core';

// ---- All API Hub ----

export interface AllApiHubProviderCandidate {
  providerId: string;
  name: string;
  baseUrl: string | null;
  apiKey: string | null;
  isDisabled: boolean;
  npm: string;
  apiProtocol: string;
  siteName: string | null;
  siteType: string | null;
  accountLabel: string;
  sourceProfileName: string;
  sourceExtensionId: string;
  balanceUsd: number | null;
  balanceCny: number | null;
  requiresBrowserOpen: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
}

export interface AllApiHubDiscovery {
  found: boolean;
  profiles: { profileName: string; extensionId: string; path: string }[];
  providers: AllApiHubProviderCandidate[];
  message: string | null;
}

export interface AllApiHubProviderModelsResult {
  providerId: string;
  models: string[];
  status: 'loaded' | 'error' | 'unsupported';
  error?: string;
}

export const listAllApiHubProviders = async (): Promise<AllApiHubDiscovery> => {
  return await invoke<AllApiHubDiscovery>('list_all_api_hub_providers');
};

export const resolveAllApiHubProviders = async (
  providerIds: string[],
): Promise<AllApiHubProviderCandidate[]> => {
  return await invoke<AllApiHubProviderCandidate[]>('resolve_all_api_hub_providers', {
    providerIds,
  });
};

export const getAllApiHubProviderModels = async (
  providerIds: string[],
): Promise<AllApiHubProviderModelsResult[]> => {
  return await invoke<AllApiHubProviderModelsResult[]>('get_all_api_hub_provider_models', {
    request: { providerIds },
  });
};