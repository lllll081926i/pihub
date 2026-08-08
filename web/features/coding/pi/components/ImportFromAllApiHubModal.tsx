import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ExternalProviderDisplayItem } from '@/components/common/ImportExternalProvidersModal/types';
import ImportFromAllApiHubModalBase from '@/features/coding/shared/allApiHub/ImportFromAllApiHubModal';
import type { AllApiHubProviderModelsState } from '@/features/coding/shared/allApiHubModelsCache';
import {
  listAllApiHubProviders,
  resolveAllApiHubProviders,
  type AllApiHubProviderCandidate,
} from '@/services/providerApi';
import type { OpenCodeProvider } from '@/types/opencode';

interface Props {
  open: boolean;
  existingProviderIds: string[];
  onClose: () => void;
  onImport: (providers: AllApiHubProviderCandidate[]) => void;
}

const buildProviderConfig = (provider: AllApiHubProviderCandidate): OpenCodeProvider => ({
  npm: provider.npm,
  name: provider.name,
  options: {
    baseURL: provider.baseUrl || '',
    ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
  },
  models: {},
});

const ImportFromAllApiHubModal: React.FC<Props> = ({
  open,
  existingProviderIds,
  onClose,
  onImport,
}) => {
  const { t } = useTranslation();

  const texts = React.useMemo(
    () => ({
      title: t('pi.provider.importAllApiHubModalTitle'),
      noProvidersText: t('pi.provider.noAllApiHubProviders'),
      cancelText: t('common.cancel'),
      importButtonText: t('pi.provider.importSelected'),
      selectAllText: t('pi.provider.selectAllProviders'),
      deselectAllText: t('pi.provider.deselectAllProviders'),
      existingTagText: t('pi.provider.providerExists'),
      noApiKeyTagText: t('pi.provider.apiKeyMissing'),
      disabledTagText: t('pi.provider.disabled'),
      balanceLabelText: t('pi.provider.balance'),
      modelsLabelText: t('pi.provider.models'),
      loadingModelsText: t('pi.provider.loadingModels'),
      emptyModelsText: t('pi.provider.emptyModels'),
      modelsErrorText: t('pi.provider.modelsLoadFailed'),
      unsupportedModelsText: t('pi.provider.unsupportedModels'),
      expandModelsText: t('pi.provider.expandModels'),
      collapseModelsText: t('pi.provider.collapseModels'),
      profileLabel: t('pi.provider.sourceProfile'),
      siteTypeLabel: t('pi.provider.siteType'),
      loadingTokenText: t('pi.provider.loadingApiKey'),
      tokenResolvedText: t('pi.provider.apiKeyReady'),
      retryResolveText: t('pi.provider.retryResolve'),
      searchPlaceholder: t('pi.provider.searchPlaceholder'),
      confirmTitle: t('pi.provider.importAllApiHubOpenAiCompatTitle'),
      confirmOkText: t('pi.provider.importAllApiHubReviewConfirm'),
    }),
    [t],
  );

  const mapProviderToItem = React.useCallback(
    (
      provider: AllApiHubProviderCandidate,
      modelState?: AllApiHubProviderModelsState,
    ): ExternalProviderDisplayItem<OpenCodeProvider> => ({
      providerId: provider.providerId,
      name: provider.name,
      baseUrl: provider.baseUrl || undefined,
      accountLabel: provider.accountLabel,
      siteName: provider.siteName || undefined,
      siteType: provider.siteType || undefined,
      sourceProfileName: provider.sourceProfileName,
      sourceExtensionId: provider.sourceExtensionId,
      requiresBrowserOpen: provider.requiresBrowserOpen,
      isDisabled: provider.isDisabled,
      hasApiKey: provider.hasApiKey,
      apiKeyPreview: provider.apiKeyPreview ?? undefined,
      balanceUsd: provider.balanceUsd ?? undefined,
      balanceCny: provider.balanceCny ?? undefined,
      models: modelState?.models || [],
      modelsStatus: modelState?.status || 'idle',
      modelsError: modelState?.error,
      config: buildProviderConfig(provider),
      secondaryLabel: provider.npm,
    }),
    [],
  );

  const getConfirmSections = React.useCallback(
    (providers: AllApiHubProviderCandidate[]) =>
      [
        providers.filter((provider) => provider.npm === '@ai-sdk/openai-compatible').length > 0
          ? {
              description: t('pi.provider.importAllApiHubOpenAiCompatDesc'),
              providerNames: providers
                .filter((provider) => provider.npm === '@ai-sdk/openai-compatible')
                .map((provider) => provider.name),
            }
          : null,
        providers.filter((provider) => !provider.hasApiKey).length > 0
          ? {
              description: t('pi.provider.importAllApiHubMissingApiKeyDesc'),
              providerNames: providers
                .filter((provider) => !provider.hasApiKey)
                .map((provider) => provider.name),
            }
          : null,
      ].filter((section): section is { description: string; providerNames: string[] } => !!section),
    [t],
  );

  return (
    <ImportFromAllApiHubModalBase
      open={open}
      existingProviderIds={existingProviderIds}
      listProviders={async () => {
        const result = await listAllApiHubProviders();
        return { ...result, message: result.message ?? undefined };
      }}
      resolveProviders={resolveAllApiHubProviders}
      onCancel={onClose}
      onImport={onImport}
      texts={texts}
      getProviderId={(provider) => provider.providerId}
      mapProviderToItem={mapProviderToItem}
      getConfirmSections={getConfirmSections}
    />
  );
};

export default ImportFromAllApiHubModal;
