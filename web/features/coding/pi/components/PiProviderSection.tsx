import React from 'react';
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { FormInstance } from 'antd';
import {
  ApiOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import AllApiHubIcon from '@/components/common/AllApiHubIcon';
import FetchModelsModal from '@/components/common/FetchModelsModal';
import type { FetchModelsApplyResult } from '@/components/common/FetchModelsModal/types';
import JsonEditor from '@/components/common/JsonEditor';
import ModelFormModal from '@/components/common/ModelFormModal';
import type { ModelFormValues } from '@/components/common/ModelFormModal';
import ProviderCard from '@/components/common/ProviderCard';
import type {
  ModelDisplayData,
  ProviderDisplayData,
} from '@/components/common/ProviderCard/types';
import { findPresetModelById } from '@/constants/presetModels';
import { hasAllApiHubExtension, refreshTrayMenu } from '@/services/appApi';
import type { AllApiHubProviderCandidate } from '@/services/providerApi';
import {
  deletePiRuntimeProvider,
  savePiAuthProvider,
  savePiModelSettings,
  savePiModelsProvider,
} from '@/services/piApi';
import type {
  PiDeleteScope,
  PiRuntimeConfig,
  PiRuntimeProviderView,
} from '@/types/pi';

import { buildFetchedPiModel, piApiToSdkName } from '../utils/piFetchedModels';
import {
  PI_API_OPTIONS,
  asRecord,
  asStringRecord,
  buildOpenCodeProviderFromAllApiHubCandidate,
  buildPiModelsProviderFromOpenCodeProvider,
  createDefaultProviderConfig,
  getNumberField,
  getProviderModelRecords,
  getStringField,
  hasProviderConfigContent,
  isPiThinkingLevelSupported,
  isRecordEmpty,
  normalizeProviderBaseUrl,
  parseJsonRecord,
  parseStringArray,
  setOptionalStringField,
  shortPiApiLabel,
  stringifyRecordField,
  stringifyStringArrayField,
} from '../utils/piProviderConfig';
import ImportFromAllApiHubModal from './ImportFromAllApiHubModal';
import styles from '../pages/PiPage.module.less';

const { Text } = Typography;

interface ProviderJsonModalState {
  provider?: PiRuntimeProviderView;
}

interface PiModelModalState {
  provider: PiRuntimeProviderView;
  modelId?: string;
  model?: Record<string, unknown>;
}

interface PiProviderSectionProps {
  runtimeConfig: PiRuntimeConfig | null;
  modelForm: FormInstance;
  onConfigUpdated: (config: PiRuntimeConfig) => void;
}

const maskCredential = (credential: unknown): string => {
  if (!credential || typeof credential !== 'object') {
    return '';
  }
  const key = (credential as Record<string, unknown>).key;
  if (typeof key !== 'string' || key.trim() === '') {
    return '';
  }
  if (key.startsWith('$') || key.startsWith('!')) {
    return key;
  }
  if (key.length <= 10) {
    return '********';
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
};

const PiProviderSection: React.FC<PiProviderSectionProps> = ({
  runtimeConfig,
  modelForm,
  onConfigUpdated,
}) => {
  const { t } = useTranslation();
  const [saving, setSaving] = React.useState(false);
  const [providerModal, setProviderModal] = React.useState<ProviderJsonModalState | null>(null);
  const [providerModalForm] = Form.useForm();
  const [credentialJson, setCredentialJson] = React.useState<Record<string, unknown>>({});
  const [providerConfigJson, setProviderConfigJson] = React.useState<Record<string, unknown>>({});
  const [providerHeadersJson, setProviderHeadersJson] = React.useState<Record<string, unknown>>({});
  const [providerCompatJson, setProviderCompatJson] = React.useState<Record<string, unknown>>({});
  const [providerModelOverridesJson, setProviderModelOverridesJson] = React.useState<Record<string, unknown>>({});
  const [credentialJsonValid, setCredentialJsonValid] = React.useState(true);
  const [providerConfigJsonValid, setProviderConfigJsonValid] = React.useState(true);
  const [providerHeadersJsonValid, setProviderHeadersJsonValid] = React.useState(true);
  const [providerCompatJsonValid, setProviderCompatJsonValid] = React.useState(true);
  const [providerModelOverridesJsonValid, setProviderModelOverridesJsonValid] = React.useState(true);
  const [providerAdvancedExpanded, setProviderAdvancedExpanded] = React.useState(false);
  const [piModelModal, setPiModelModal] = React.useState<PiModelModalState | null>(null);
  const [batchDeleteProviderId, setBatchDeleteProviderId] = React.useState<string | null>(null);
  const [selectedModelIdsByProvider, setSelectedModelIdsByProvider] = React.useState<Record<string, string[]>>({});
  const [fetchModelsProviderId, setFetchModelsProviderId] = React.useState<string | null>(null);
  const [fetchModelsModalOpen, setFetchModelsModalOpen] = React.useState(false);
  const [allApiHubImportModalOpen, setAllApiHubImportModalOpen] = React.useState(false);
  const [allApiHubAvailable, setAllApiHubAvailable] = React.useState(false);
  const [deleteScopeProvider, setDeleteScopeProvider] = React.useState<PiRuntimeProviderView | null>(null);

  React.useEffect(() => {
    const checkAllApiHubAvailability = async () => {
      try {
        const available = await hasAllApiHubExtension();
        setAllApiHubAvailable(available);
      } catch (error) {
        console.error('Failed to check All API Hub availability:', error);
        setAllApiHubAvailable(false);
      }
    };

    checkAllApiHubAvailability();
  }, []);

  const piProviders = React.useMemo(
    () => runtimeConfig?.providers ?? [],
    [runtimeConfig?.providers],
  );
  const existingProviderIds = React.useMemo(
    () => piProviders.map((provider) => provider.providerKey),
    [piProviders],
  );

  const fetchModelsProviderInfo = React.useMemo(() => {
    if (!fetchModelsProviderId) {
      return null;
    }
    const provider = piProviders.find((item) => item.providerKey === fetchModelsProviderId);
    if (!provider) {
      return null;
    }
    const providerConfig = provider.modelsProvider ?? {};
    const api = getStringField(providerConfig, 'api');
    return {
      providerId: provider.providerKey,
      name: provider.displayName,
      baseUrl: getStringField(providerConfig, 'baseUrl'),
      apiKey: getStringField(providerConfig, 'apiKey'),
      headers: asStringRecord(providerConfig.headers),
      sdkName: piApiToSdkName(api),
      existingModelIds: getProviderModelRecords(provider.modelsProvider).map((entry) => entry.id),
    };
  }, [fetchModelsProviderId, piProviders]);

  const translateRuntimeLabel = React.useCallback((prefix: string, value: string): string => (
    t(`${prefix}.${value}`, { defaultValue: value })
  ), [t]);

  const openProviderModal = (
    provider?: PiRuntimeProviderView,
    options?: { copy?: boolean },
  ) => {
    const nextCredentialJson = provider?.credential
      ? asRecord(provider.credential)
      : {};
    const isCopy = options?.copy === true;
    const isExistingProviderEdit = !!provider && !isCopy;
    const nextProviderConfigJson = provider?.modelsProvider
      ? asRecord(provider.modelsProvider)
      : isExistingProviderEdit
        ? {}
        : createDefaultProviderConfig();

    setProviderModal({ provider: isCopy ? undefined : provider });
    setCredentialJson(nextCredentialJson);
    setProviderConfigJson(nextProviderConfigJson);
    setProviderHeadersJson(asRecord(nextProviderConfigJson.headers));
    setProviderCompatJson(asRecord(nextProviderConfigJson.compat));
    setProviderModelOverridesJson(asRecord(nextProviderConfigJson.modelOverrides));
    setCredentialJsonValid(true);
    setProviderConfigJsonValid(true);
    setProviderHeadersJsonValid(true);
    setProviderCompatJsonValid(true);
    setProviderModelOverridesJsonValid(true);
    setProviderAdvancedExpanded(false);
    providerModalForm.setFieldsValue({
      providerKey: isCopy && provider ? `${provider.providerKey}_copy` : provider?.providerKey,
      displayName: getStringField(nextProviderConfigJson, 'name'),
      api: getStringField(nextProviderConfigJson, 'api') || undefined,
      baseUrl: getStringField(nextProviderConfigJson, 'baseUrl'),
      providerApiKey: getStringField(nextProviderConfigJson, 'apiKey'),
      authHeader: typeof nextProviderConfigJson.authHeader === 'boolean'
        ? nextProviderConfigJson.authHeader
        : undefined,
    });
  };

  const handleSaveProviderModal = async () => {
    if (
      !providerModal
      || !credentialJsonValid
      || !providerConfigJsonValid
      || !providerHeadersJsonValid
      || !providerCompatJsonValid
      || !providerModelOverridesJsonValid
    ) {
      return;
    }
    const values = await providerModalForm.validateFields();
    const providerKey = values.providerKey?.trim();
    if (!providerKey) {
      message.error(t('pi.provider.providerKeyRequired'));
      return;
    }

    setSaving(true);
    try {
      let nextConfig: PiRuntimeConfig | null = null;
      const shouldSaveCredential = Object.keys(credentialJson).length > 0;
      if (shouldSaveCredential) {
        const nextCredentialJson = { ...credentialJson };
        nextConfig = await savePiAuthProvider({ providerKey, credential: nextCredentialJson });
      }
      const nextProviderConfigJson = { ...providerConfigJson };
      setOptionalStringField(nextProviderConfigJson, 'name', values.displayName);
      setOptionalStringField(nextProviderConfigJson, 'api', values.api);
      setOptionalStringField(
        nextProviderConfigJson,
        'baseUrl',
        typeof values.baseUrl === 'string'
          ? normalizeProviderBaseUrl(values.baseUrl, values.api)
          : values.baseUrl,
      );
      setOptionalStringField(nextProviderConfigJson, 'apiKey', values.providerApiKey);
      if (
        typeof values.authHeader === 'boolean'
        && (
          values.authHeader
          || Object.prototype.hasOwnProperty.call(providerConfigJson, 'authHeader')
        )
      ) {
        nextProviderConfigJson.authHeader = values.authHeader;
      } else {
        delete nextProviderConfigJson.authHeader;
      }
      if (isRecordEmpty(providerHeadersJson)) {
        delete nextProviderConfigJson.headers;
      } else {
        nextProviderConfigJson.headers = providerHeadersJson;
      }
      if (isRecordEmpty(providerCompatJson)) {
        delete nextProviderConfigJson.compat;
      } else {
        nextProviderConfigJson.compat = providerCompatJson;
      }
      if (isRecordEmpty(providerModelOverridesJson)) {
        delete nextProviderConfigJson.modelOverrides;
      } else {
        nextProviderConfigJson.modelOverrides = providerModelOverridesJson;
      }
      const shouldSaveProviderConfig = !providerModal.provider
        || providerModal.provider.sources.includes('models_json')
        || hasProviderConfigContent(nextProviderConfigJson);
      if (shouldSaveProviderConfig) {
        nextConfig = await savePiModelsProvider({ providerKey, provider: nextProviderConfigJson });
      }
      if (!shouldSaveCredential && !shouldSaveProviderConfig) {
        message.error(t('pi.provider.selectAtLeastOneSection'));
        return;
      }
      if (!nextConfig) {
        return;
      }
      onConfigUpdated(nextConfig);
      setProviderModal(null);
      await refreshTrayMenu();
      message.success(t('common.success'));
    } catch (error) {
      console.error('Failed to save Pi provider:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const openPiModelModal = (
    provider: PiRuntimeProviderView,
    modelId?: string,
    options?: { copy?: boolean },
  ) => {
    const model = modelId
      ? getProviderModelRecords(provider.modelsProvider).find((entry) => entry.id === modelId)?.model
      : undefined;
    const isCopy = options?.copy === true;
    const nextModel = model ? { ...model } : undefined;
    if (isCopy && nextModel && modelId) {
      nextModel.id = `${modelId}_copy`;
    }

    setPiModelModal({ provider, modelId: isCopy ? undefined : modelId, model: nextModel });
  };

  const handleSavePiModel = async (values: ModelFormValues) => {
    if (!piModelModal) {
      return;
    }
    const modelId = values.id?.trim();
    if (!modelId) {
      message.error(t('pi.model.idRequired'));
      return;
    }

    const currentProvider = runtimeConfig?.providers.find(
      (provider) => provider.providerKey === piModelModal.provider.providerKey,
    ) ?? piModelModal.provider;
    const existingModels = getProviderModelRecords(currentProvider.modelsProvider);
    const duplicateModel = existingModels.some((entry) => (
      entry.id === modelId && entry.id !== piModelModal.modelId
    ));
    if (duplicateModel) {
      message.error(t('pi.model.idExists'));
      return;
    }

    const nextModel = { ...(piModelModal.model ?? {}) };
    setOptionalStringField(nextModel, 'id', modelId);
    setOptionalStringField(nextModel, 'name', values.name);
    if (typeof values.contextLimit === 'number') {
      nextModel.contextWindow = values.contextLimit;
    } else {
      delete nextModel.contextWindow;
    }
    if (typeof values.outputLimit === 'number') {
      nextModel.maxTokens = values.outputLimit;
    } else {
      delete nextModel.maxTokens;
    }
    if (typeof values.reasoning === 'boolean') {
      nextModel.reasoning = values.reasoning;
    } else {
      delete nextModel.reasoning;
    }
    setOptionalStringField(nextModel, 'api', values.api);
    const inputTypes = parseStringArray(values.inputTypes);
    if (inputTypes.length > 0) {
      nextModel.input = inputTypes;
    } else {
      delete nextModel.input;
    }
    const thinkingLevelMap = parseJsonRecord(values.thinkingLevelMap);
    if (!isRecordEmpty(thinkingLevelMap)) {
      nextModel.thinkingLevelMap = thinkingLevelMap;
    } else {
      delete nextModel.thinkingLevelMap;
    }
    const compat = parseJsonRecord(values.compat);
    if (!isRecordEmpty(compat)) {
      nextModel.compat = compat;
    } else {
      delete nextModel.compat;
    }
    const nextCost = asRecord(nextModel.cost);
    const costFields: Array<[string, number | undefined]> = [
      ['input', values.costInput],
      ['output', values.costOutput],
      ['cacheRead', values.costCacheRead],
      ['cacheWrite', values.costCacheWrite],
    ];
    costFields.forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        nextCost[key] = value;
      } else {
        delete nextCost[key];
      }
    });
    if (!isRecordEmpty(nextCost)) {
      nextModel.cost = nextCost;
    } else {
      delete nextModel.cost;
    }

    let modelWasReplaced = false;
    const nextModels = existingModels.map((entry) => {
      if (entry.id === piModelModal.modelId) {
        modelWasReplaced = true;
        return nextModel;
      }
      return entry.model;
    });
    if (!modelWasReplaced) {
      nextModels.push(nextModel);
    }

    setSaving(true);
    try {
      const nextProviderConfig = {
        ...(currentProvider.modelsProvider ?? {}),
        models: nextModels,
      };
      const nextConfig = await savePiModelsProvider({
        providerKey: currentProvider.providerKey,
        provider: nextProviderConfig,
      });
      onConfigUpdated(nextConfig);
      setPiModelModal(null);
      await refreshTrayMenu();
      message.success(t('common.success'));
    } catch (error) {
      console.error('Failed to save Pi model:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const clearBatchDeleteState = React.useCallback((providerId?: string) => {
    if (providerId) {
      setSelectedModelIdsByProvider((previousState) => {
        if (!previousState[providerId]) {
          return previousState;
        }
        const nextState = { ...previousState };
        delete nextState[providerId];
        return nextState;
      });
      setBatchDeleteProviderId((currentProviderId) => (
        currentProviderId === providerId ? null : currentProviderId
      ));
      return;
    }

    setSelectedModelIdsByProvider({});
    setBatchDeleteProviderId(null);
  }, []);

  const saveProviderModels = async (
    provider: PiRuntimeProviderView,
    nextModels: Record<string, unknown>[],
  ) => {
    const nextProviderConfig = {
      ...(provider.modelsProvider ?? {}),
      models: nextModels,
    };
    const nextConfig = await savePiModelsProvider({
      providerKey: provider.providerKey,
      provider: nextProviderConfig,
    });
    onConfigUpdated(nextConfig);
    await refreshTrayMenu();
    return nextConfig;
  };

  const handleToggleBatchDeleteMode = (providerKey: string) => {
    if (batchDeleteProviderId === providerKey) {
      clearBatchDeleteState(providerKey);
      return;
    }
    setSelectedModelIdsByProvider({});
    setBatchDeleteProviderId(providerKey);
  };

  const handleToggleModelSelection = (providerKey: string, modelId: string, selected: boolean) => {
    setSelectedModelIdsByProvider((previousState) => {
      const currentModelIds = previousState[providerKey] ?? [];
      const nextModelIds = selected
        ? Array.from(new Set([...currentModelIds, modelId]))
        : currentModelIds.filter((id) => id !== modelId);

      if (nextModelIds.length === 0) {
        const nextState = { ...previousState };
        delete nextState[providerKey];
        return nextState;
      }

      return {
        ...previousState,
        [providerKey]: nextModelIds,
      };
    });
  };

  const handleBatchDeleteModels = async (provider: PiRuntimeProviderView) => {
    const selectedModelIds = selectedModelIdsByProvider[provider.providerKey] ?? [];
    if (selectedModelIds.length === 0) {
      return;
    }

    setSaving(true);
    try {
      const selectedModelIdSet = new Set(selectedModelIds);
      const nextModels = getProviderModelRecords(provider.modelsProvider)
        .filter((entry) => !selectedModelIdSet.has(entry.id))
        .map((entry) => entry.model);
      const nextConfig = await saveProviderModels(provider, nextModels);
      if (
        provider.isDefault
        && nextConfig.modelSettings.modelId
        && selectedModelIdSet.has(nextConfig.modelSettings.modelId)
      ) {
        const updatedConfig = await savePiModelSettings({
          defaultProvider: nextConfig.modelSettings.providerKey ?? provider.providerKey,
          defaultModel: '',
          defaultThinkingLevel: '',
        });
        onConfigUpdated(updatedConfig);
        modelForm.setFieldValue('defaultModel', undefined);
        await refreshTrayMenu();
      }
      clearBatchDeleteState(provider.providerKey);
      message.success(t('pi.model.batchDeleteSuccess', { count: selectedModelIds.length }));
    } catch (error) {
      console.error('Failed to batch delete Pi models:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleReorderModels = async (provider: PiRuntimeProviderView, modelIds: string[]) => {
    const currentModelMap = new Map(
      getProviderModelRecords(provider.modelsProvider).map((entry) => [entry.id, entry.model]),
    );
    const nextModels = modelIds
      .map((modelId) => currentModelMap.get(modelId))
      .filter((model): model is Record<string, unknown> => !!model);

    setSaving(true);
    try {
      await saveProviderModels(provider, nextModels);
    } catch (error) {
      console.error('Failed to reorder Pi models:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimaryModel = async (provider: PiRuntimeProviderView, modelId: string) => {
    const nextModel = getProviderModelRecords(provider.modelsProvider).find(
      (entry) => entry.id === modelId,
    )?.model;
    const nextThinkingLevel = isPiThinkingLevelSupported(
      runtimeConfig?.modelSettings.thinkingLevel ?? undefined,
      nextModel,
    ) ? runtimeConfig?.modelSettings.thinkingLevel ?? '' : '';
    setSaving(true);
    try {
      const nextConfig = await savePiModelSettings({
        defaultProvider: provider.providerKey,
        defaultModel: modelId,
        defaultThinkingLevel: nextThinkingLevel,
      });
      onConfigUpdated(nextConfig);
      modelForm.setFieldsValue({
        defaultProvider: provider.providerKey,
        defaultModel: modelId,
        defaultThinkingLevel: nextConfig.modelSettings.thinkingLevel || undefined,
      });
      await refreshTrayMenu();
      message.success(t('pi.model.setAsPrimarySuccess', { name: modelId }));
    } catch (error) {
      console.error('Failed to set Pi default model:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenFetchModels = (providerKey: string) => {
    setFetchModelsProviderId(providerKey);
    setFetchModelsModalOpen(true);
  };

  const handleFetchModelsSuccess = async ({ selectedModels, removedModelIds }: FetchModelsApplyResult) => {
    if (!fetchModelsProviderId) {
      return;
    }
    const provider = piProviders.find((item) => item.providerKey === fetchModelsProviderId);
    if (!provider) {
      return;
    }

    const removedModelIdSet = new Set(removedModelIds);
    const currentModels = getProviderModelRecords(provider.modelsProvider)
      .filter((entry) => !removedModelIdSet.has(entry.id))
      .map((entry) => entry.model);
    const currentModelIds = new Set(currentModels.map((model) => getStringField(model, 'id')));
    const providerApi = getStringField(provider.modelsProvider ?? {}, 'api');
    selectedModels.forEach((model) => {
      if (!currentModelIds.has(model.id)) {
        const matchedPresetModel = findPresetModelById(model.id, piApiToSdkName(providerApi));
        currentModels.push(buildFetchedPiModel(model, matchedPresetModel));
      }
    });

    setSaving(true);
    try {
      await saveProviderModels(provider, currentModels);
      clearBatchDeleteState(provider.providerKey);
      setFetchModelsModalOpen(false);
      message.success(t('pi.fetchModels.applySuccess', {
        addCount: selectedModels.length,
        removeCount: removedModelIds.length,
      }));
    } catch (error) {
      console.error('Failed to apply fetched Pi models:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const saveImportedPiProviders = async (
    providers: Array<{
      providerKey: string;
      modelsProvider: Record<string, unknown>;
      credential?: Record<string, unknown>;
      displayName?: string;
    }>,
  ) => {
    const existingProviderIdSet = new Set(existingProviderIds);
    let nextConfig: PiRuntimeConfig | null = null;
    let importedCount = 0;

    setSaving(true);
    try {
      for (const provider of providers) {
        if (!provider.providerKey || existingProviderIdSet.has(provider.providerKey)) {
          continue;
        }

        if (provider.credential && !isRecordEmpty(provider.credential)) {
          nextConfig = await savePiAuthProvider({
            providerKey: provider.providerKey,
            credential: provider.credential,
          });
        }
        nextConfig = await savePiModelsProvider({
          providerKey: provider.providerKey,
          provider: provider.modelsProvider,
        });
        existingProviderIdSet.add(provider.providerKey);
        importedCount += 1;
      }

      if (nextConfig) {
        onConfigUpdated(nextConfig);
      }
      if (importedCount > 0) {
        await refreshTrayMenu();
      }
      message.success(t('pi.provider.importSuccess', { count: importedCount }));
      return importedCount;
    } catch (error) {
      console.error('Failed to import Pi providers:', error);
      message.error(t('common.error'));
      return 0;
    } finally {
      setSaving(false);
    }
  };

  const handleImportAllApiHubProviders = async (providers: AllApiHubProviderCandidate[]) => {
    const importedCount = await saveImportedPiProviders(
      providers.map((provider) => ({
        providerKey: provider.providerId,
        modelsProvider: buildPiModelsProviderFromOpenCodeProvider(
          buildOpenCodeProviderFromAllApiHubCandidate(provider),
        ),
        displayName: provider.name,
      })),
    );
    if (importedCount > 0) {
      setAllApiHubImportModalOpen(false);
    }
  };

  const handleDeletePiModel = async (provider: PiRuntimeProviderView, modelId: string) => {
    setSaving(true);
    try {
      const nextModels = getProviderModelRecords(provider.modelsProvider)
        .filter((entry) => entry.id !== modelId)
        .map((entry) => entry.model);
      const nextConfig = await saveProviderModels(provider, nextModels);
      if (provider.isDefault && nextConfig.modelSettings.modelId === modelId) {
        const updatedConfig = await savePiModelSettings({
          defaultProvider: nextConfig.modelSettings.providerKey ?? provider.providerKey,
          defaultModel: '',
          defaultThinkingLevel: '',
        });
        onConfigUpdated(updatedConfig);
        modelForm.setFieldValue('defaultModel', undefined);
        await refreshTrayMenu();
      }
      clearBatchDeleteState(provider.providerKey);
      message.success(t('common.success'));
    } catch (error) {
      console.error('Failed to delete Pi model:', error);
      message.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = (provider: PiRuntimeProviderView, scope: PiDeleteScope) => {
    Modal.confirm({
      title: t('pi.provider.deleteConfirmTitle'),
      content: t('pi.provider.deleteConfirmContent', {
        providerKey: provider.providerKey,
        scope: t(`pi.provider.deleteScope.${scope}`),
      }),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(true);
        try {
          const nextConfig = await deletePiRuntimeProvider(provider.providerKey, scope);
          onConfigUpdated(nextConfig);
          await refreshTrayMenu();
          message.success(t('common.success'));
        } catch (error) {
          console.error('Failed to delete Pi provider:', error);
          message.error(t('common.error'));
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleDeleteSupplier = (provider: PiRuntimeProviderView) => {
    const hasCredential = provider.sources.includes('auth_json');
    const hasProviderConfig = provider.sources.includes('models_json');
    if (hasCredential && hasProviderConfig) {
      setDeleteScopeProvider(provider);
      return;
    }
    const scope: PiDeleteScope = hasCredential ? 'credential' : 'provider_config';
    handleDeleteProvider(provider, scope);
  };

  const handleDeleteScopeSelect = (scope: PiDeleteScope) => {
    const provider = deleteScopeProvider;
    setDeleteScopeProvider(null);
    if (provider) {
      handleDeleteProvider(provider, scope);
    }
  };

  const renderProvider = (provider: PiRuntimeProviderView) => {
    const credentialPreview = maskCredential(provider.credential);
    const hasCredential = provider.sources.includes('auth_json');
    const hasProviderConfig = provider.sources.includes('models_json');
    const providerConfig = provider.modelsProvider ?? {};
    const isBatchDeleteMode = batchDeleteProviderId === provider.providerKey;
    const selectedModelIds = selectedModelIdsByProvider[provider.providerKey] ?? [];
    const selectedModelCount = selectedModelIds.length;
    const providerBaseUrl = getStringField(providerConfig, 'baseUrl');
    const hasModelIds = getProviderModelRecords(provider.modelsProvider).length > 0;
    const connectivityTooltip = !providerBaseUrl
      ? t('common.baseUrlMissing')
      : !hasModelIds
        ? t('common.modelMissing')
        : '';
    const fetchModelsTooltip = !providerBaseUrl ? t('common.baseUrlMissing') : '';
    const providerDisplay: ProviderDisplayData = {
      id: provider.providerKey,
      name: provider.displayName,
      sdkName: shortPiApiLabel(getStringField(providerConfig, 'api'))
        || provider.categories.join(', ')
        || 'pi',
      baseUrl: providerBaseUrl
        || credentialPreview
        || provider.sources.map((source) => translateRuntimeLabel('pi.sourceLabels', source)).join(' / ')
        || t('pi.provider.builtinHint'),
    };
    const modelDisplayList: ModelDisplayData[] = getProviderModelRecords(provider.modelsProvider).map((entry) => ({
      id: entry.id,
      name: getStringField(entry.model, 'name') || entry.id,
      isPrimary: provider.isDefault && runtimeConfig?.modelSettings.modelId === entry.id,
    }));

    return (
      <ProviderCard
        key={provider.providerKey}
        provider={providerDisplay}
        models={modelDisplayList}
        onEdit={() => openProviderModal(provider)}
        onCopy={() => openProviderModal(provider, { copy: true })}
        onDelete={(hasCredential || hasProviderConfig) ? () => handleDeleteSupplier(provider) : undefined}
        deleteConfirm={false}
        extraActions={
          <Space size={0}>
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              style={{ fontSize: 12 }}
              onClick={() => handleToggleBatchDeleteMode(provider.providerKey)}
            >
              {isBatchDeleteMode
                ? t('pi.model.cancelBatchDelete')
                : t('pi.model.batchDelete')}
            </Button>
            {isBatchDeleteMode && (
              <Button
                size="small"
                type="text"
                danger
                style={{ fontSize: 12 }}
                disabled={selectedModelCount === 0}
                onClick={() => {
                  Modal.confirm({
                    title: t('pi.model.batchDeleteConfirmTitle'),
                    content: t('pi.model.batchDeleteConfirmContent', { count: selectedModelCount }),
                    okText: t('common.confirm'),
                    cancelText: t('common.cancel'),
                    onOk: async () => {
                      await handleBatchDeleteModels(provider);
                    },
                  });
                }}
              >
                {t('pi.model.deleteSelected', { count: selectedModelCount })}
              </Button>
            )}
            <Tooltip title={connectivityTooltip}>
              <span>
                <Button
                  size="small"
                  type="text"
                  style={{ fontSize: 12 }}
                  disabled={!providerBaseUrl || !hasModelIds}
                >
                  <ApiOutlined style={{ marginRight: 4 }} />
                  {t('pi.connectivity.button')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={fetchModelsTooltip}>
              <span>
                <Button
                  size="small"
                  type="text"
                  style={{ fontSize: 12 }}
                  onClick={() => handleOpenFetchModels(provider.providerKey)}
                  disabled={!providerBaseUrl}
                >
                  <CloudDownloadOutlined style={{ marginRight: 4 }} />
                  {t('pi.fetchModels.button')}
                </Button>
              </span>
            </Tooltip>
          </Space>
        }
        onAddModel={() => openPiModelModal(provider)}
        onEditModel={(modelId) => openPiModelModal(provider, modelId)}
        onCopyModel={(modelId) => openPiModelModal(provider, modelId, { copy: true })}
        onDeleteModel={(modelId) => handleDeletePiModel(provider, modelId)}
        onSetPrimaryModel={(modelId) => handleSetPrimaryModel(provider, modelId)}
        modelSelectionMode={isBatchDeleteMode}
        selectedModelIds={selectedModelIds}
        onToggleModelSelection={(modelId, selected) => handleToggleModelSelection(provider.providerKey, modelId, selected)}
        modelsDraggable={!isBatchDeleteMode}
        onReorderModels={(modelIds) => handleReorderModels(provider, modelIds)}
        i18nPrefix="pi"
      />
    );
  };

  return (
    <div>
      <div className={styles.sectionTitle}>
        <ApiOutlined />
        <Text strong>{t('pi.provider.title')}</Text>
        <div className={styles.sectionTitleRight}>
          <Button
            type="link"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openProviderModal()}
          >
            {t('pi.provider.addSupplier')}
          </Button>
        </div>
      </div>

      <div>
        {runtimeConfig?.providers.length ? (
          <div className={styles.providerList}>
            {runtimeConfig.providers.map(renderProvider)}
          </div>
        ) : (
          <Empty description={t('pi.provider.emptyText')} />
        )}
        <div className={styles.providerActions}>
          <Space wrap>
            {allApiHubAvailable && (
              <Button
                type="dashed"
                icon={<AllApiHubIcon />}
                onClick={() => setAllApiHubImportModalOpen(true)}
              >
                {t('pi.provider.importAllApiHub')}
              </Button>
            )}
          </Space>
        </div>
      </div>

      <Modal
        title={providerModal?.provider
          ? t('pi.provider.editSupplierTitle', { name: providerModal.provider.displayName })
          : t('pi.provider.addSupplierTitle')}
        open={!!providerModal}
        width={860}
        confirmLoading={saving}
        onCancel={() => setProviderModal(null)}
        onOk={handleSaveProviderModal}
        destroyOnHidden
      >
        <Form form={providerModalForm} layout="vertical" className={styles.providerForm}>
          <div className={styles.modalSection}>
            <Text strong>{t('pi.provider.basicSection')}</Text>
            <div className={styles.modalGrid}>
              <Form.Item
                label={t('pi.provider.providerKey')}
                name="providerKey"
                rules={[{ required: true, message: t('pi.provider.providerKeyRequired') }]}
              >
                <Input
                  disabled={!!providerModal?.provider}
                  placeholder={t('pi.provider.providerKeyPlaceholder')}
                />
              </Form.Item>
              <Form.Item label={t('pi.provider.displayName')} name="displayName">
                <Input placeholder={t('pi.provider.displayNamePlaceholder')} />
              </Form.Item>
            </div>
          </div>

          <div className={styles.modalSection}>
            <Text strong>{t('pi.provider.configSection')}</Text>
            <div className={styles.modalGrid}>
              <Form.Item label={t('pi.provider.apiType')} name="api">
                <Select
                  allowClear
                  showSearch
                  options={PI_API_OPTIONS}
                  placeholder={t('pi.provider.apiTypePlaceholder')}
                />
              </Form.Item>
              <Form.Item label={t('pi.provider.baseUrl')} name="baseUrl">
                <Input placeholder="https://api.example.com/v1" />
              </Form.Item>
              <Form.Item label={t('pi.provider.providerApiKey')} name="providerApiKey">
                <Input.Password autoComplete="off" />
              </Form.Item>
              <Form.Item
                label={(
                  <Space size={4}>
                    <span>{t('pi.provider.authHeader')}</span>
                    <Tooltip title={t('pi.provider.authHeaderHint')}>
                      <QuestionCircleOutlined style={{ color: 'var(--color-text-tertiary)' }} />
                    </Tooltip>
                  </Space>
                )}
                name="authHeader"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </div>
          </div>

          <div className={styles.advancedToggle}>
            <Button
              type="link"
              onClick={() => setProviderAdvancedExpanded(!providerAdvancedExpanded)}
              className={styles.advancedToggleButton}
            >
              {providerAdvancedExpanded ? <DownOutlined /> : <RightOutlined />}
              <span>{t('common.advancedSettings')}</span>
            </Button>
          </div>
          {providerAdvancedExpanded && (
            <div className={styles.modalSection}>
              <div className={styles.advancedEditor}>
                <Text type="secondary">{t('pi.provider.credentialAdvancedJson')}</Text>
                <JsonEditor
                  value={isRecordEmpty(credentialJson) ? undefined : credentialJson}
                  height={180}
                  onChange={(value, isValid) => {
                    if (isValid) {
                      setCredentialJson(asRecord(value));
                    }
                    setCredentialJsonValid(isValid);
                  }}
                />
              </div>
              <div className={styles.advancedEditor}>
                <Text type="secondary">{t('pi.provider.headersJson')}</Text>
                <JsonEditor
                  value={isRecordEmpty(providerHeadersJson) ? undefined : providerHeadersJson}
                  height={160}
                  onChange={(value, isValid) => {
                    if (isValid) {
                      setProviderHeadersJson(asRecord(value));
                    }
                    setProviderHeadersJsonValid(isValid);
                  }}
                />
              </div>
              <div className={styles.advancedEditor}>
                <Text type="secondary">{t('pi.provider.compatJson')}</Text>
                <JsonEditor
                  value={isRecordEmpty(providerCompatJson) ? undefined : providerCompatJson}
                  height={180}
                  onChange={(value, isValid) => {
                    if (isValid) {
                      setProviderCompatJson(asRecord(value));
                    }
                    setProviderCompatJsonValid(isValid);
                  }}
                />
              </div>
              <div className={styles.advancedEditor}>
                <Text type="secondary">{t('pi.provider.modelOverridesJson')}</Text>
                <JsonEditor
                  value={isRecordEmpty(providerModelOverridesJson) ? undefined : providerModelOverridesJson}
                  height={200}
                  onChange={(value, isValid) => {
                    if (isValid) {
                      setProviderModelOverridesJson(asRecord(value));
                    }
                    setProviderModelOverridesJsonValid(isValid);
                  }}
                />
              </div>
              <div className={styles.advancedEditor}>
                <Text type="secondary">{t('pi.provider.configAdvancedJson')}</Text>
                <JsonEditor
                  value={providerConfigJson}
                  height={220}
                  onChange={(value, isValid) => {
                    setProviderConfigJson(asRecord(value));
                    setProviderConfigJsonValid(isValid);
                  }}
                />
              </div>
            </div>
          )}
        </Form>
      </Modal>

      <Modal
        title={t('pi.provider.deleteScopeModalTitle')}
        open={!!deleteScopeProvider}
        onCancel={() => setDeleteScopeProvider(null)}
        footer={deleteScopeProvider ? [
          <Button key="cancel" onClick={() => setDeleteScopeProvider(null)}>
            {t('common.cancel')}
          </Button>,
          <Button
            key="provider-config"
            danger
            onClick={() => handleDeleteScopeSelect('provider_config')}
          >
            {t('pi.provider.deleteProviderConfig')}
          </Button>,
          <Button
            key="credential"
            danger
            onClick={() => handleDeleteScopeSelect('credential')}
          >
            {t('pi.provider.deleteCredential')}
          </Button>,
          <Button
            key="both"
            danger
            type="primary"
            onClick={() => handleDeleteScopeSelect('both')}
          >
            {t('pi.provider.deleteBoth')}
          </Button>,
        ] : null}
        destroyOnHidden
      >
        <Text>
          {t('pi.provider.deleteScopeModalContent', {
            providerKey: deleteScopeProvider?.providerKey,
          })}
        </Text>
      </Modal>

      <ModelFormModal
        open={!!piModelModal}
        width={700}
        isEdit={!!piModelModal?.modelId}
        initialValues={piModelModal ? {
          id: piModelModal.modelId ?? getStringField(piModelModal.model ?? {}, 'id'),
          name: getStringField(piModelModal.model ?? {}, 'name'),
          api: getStringField(piModelModal.model ?? {}, 'api'),
          reasoning: typeof piModelModal.model?.reasoning === 'boolean'
            ? piModelModal.model.reasoning
            : undefined,
          inputTypes: stringifyStringArrayField(piModelModal.model?.input),
          thinkingLevelMap: stringifyRecordField(piModelModal.model?.thinkingLevelMap),
          compat: stringifyRecordField(piModelModal.model?.compat),
          contextLimit: typeof piModelModal.model?.contextWindow === 'number'
            ? piModelModal.model.contextWindow
            : undefined,
          outputLimit: typeof piModelModal.model?.maxTokens === 'number'
            ? piModelModal.model.maxTokens
            : undefined,
          costInput: getNumberField(asRecord(piModelModal.model?.cost), 'input'),
          costOutput: getNumberField(asRecord(piModelModal.model?.cost), 'output'),
          costCacheRead: getNumberField(asRecord(piModelModal.model?.cost), 'cacheRead'),
          costCacheWrite: getNumberField(asRecord(piModelModal.model?.cost), 'cacheWrite'),
        } : undefined}
        existingIds={piModelModal && !piModelModal.modelId
          ? getProviderModelRecords(piModelModal.provider.modelsProvider).map((entry) => entry.id)
          : []}
        showOptions={false}
        showVariants={false}
        showModalities={false}
        showInputTypes
        showApi
        apiOptions={PI_API_OPTIONS}
        showReasoning
        showThinkingLevelMap
        showCompat
        showCost
        limitRequired={false}
        nameRequired={false}
        npmType={piModelModal
          ? piApiToSdkName(getStringField(piModelModal.provider.modelsProvider ?? {}, 'api'))
          : undefined}
        onCancel={() => setPiModelModal(null)}
        onSuccess={handleSavePiModel}
        onDuplicateId={() => message.error(t('pi.model.idExists'))}
        i18nPrefix="pi"
      />

      {fetchModelsProviderInfo && (
        <FetchModelsModal
          open={fetchModelsModalOpen}
          providerId={fetchModelsProviderInfo.providerId}
          providerName={fetchModelsProviderInfo.name}
          baseUrl={fetchModelsProviderInfo.baseUrl}
          apiKey={fetchModelsProviderInfo.apiKey}
          headers={fetchModelsProviderInfo.headers}
          sdkType={fetchModelsProviderInfo.sdkName}
          existingModelIds={fetchModelsProviderInfo.existingModelIds}
          onCancel={() => setFetchModelsModalOpen(false)}
          onSuccess={handleFetchModelsSuccess}
        />
      )}

      {allApiHubAvailable && (
        <ImportFromAllApiHubModal
          open={allApiHubImportModalOpen}
          onClose={() => setAllApiHubImportModalOpen(false)}
          onImport={handleImportAllApiHubProviders}
          existingProviderIds={existingProviderIds}
        />
      )}
    </div>
  );
};

export default PiProviderSection;
