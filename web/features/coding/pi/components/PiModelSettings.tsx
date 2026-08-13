import React from 'react';
import { Form, Select, Typography, message } from 'antd';
import type { FormInstance } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { refreshTrayMenu } from '@/services/appApi';
import { savePiModelSettings } from '@/services/piApi';
import type { PiRuntimeConfig } from '@/types/pi';
import {
  getPiModelThinkingLevelOptions,
  getProviderModelRecords,
  isPiThinkingLevelSupported,
} from '../utils/piProviderConfig';
import styles from '../pages/PiPage.module.less';

const { Title } = Typography;

interface PiModelSettingsProps {
  form: FormInstance;
  runtimeConfig: PiRuntimeConfig | null;
  onConfigUpdated: (config: PiRuntimeConfig) => void;
}

const PiModelSettings: React.FC<PiModelSettingsProps> = ({
  form,
  runtimeConfig,
  onConfigUpdated,
}) => {
  const { t } = useTranslation();
  const saveSeqRef = React.useRef(0);

  const providerOptions = React.useMemo(() => {
    const options = new Map<string, string>();
    runtimeConfig?.providers.forEach((provider) => {
      options.set(provider.providerKey, `${provider.displayName} (${provider.providerKey})`);
    });
    runtimeConfig?.builtinProviders.forEach((provider) => {
      if (!options.has(provider.key)) {
        options.set(provider.key, `${provider.name} (${provider.key})`);
      }
    });
    const current = runtimeConfig?.modelSettings.providerKey;
    if (current && !options.has(current)) {
      options.set(current, current);
    }
    return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
  }, [runtimeConfig]);

  const selectedProviderKey = Form.useWatch('defaultProvider', form);
  const selectedDefaultModel = Form.useWatch('defaultModel', form);
  const selectedProvider = runtimeConfig?.providers.find(
    (provider) => provider.providerKey === selectedProviderKey,
  );
  const selectedModelRecord = React.useMemo(() => {
    if (!selectedProvider || !selectedDefaultModel) {
      return undefined;
    }
    return getProviderModelRecords(selectedProvider.modelsProvider).find(
      (entry) => entry.id === selectedDefaultModel,
    )?.model;
  }, [selectedDefaultModel, selectedProvider]);
  const thinkingLevelOptions = React.useMemo(
    () => getPiModelThinkingLevelOptions(selectedModelRecord),
    [selectedModelRecord],
  );
  const modelOptions = React.useMemo(() => {
    const options = new Set<string>();
    selectedProvider?.modelIds?.forEach((modelId) => options.add(modelId));
    const current = selectedDefaultModel || runtimeConfig?.modelSettings.modelId;
    if (current) {
      options.add(current);
    }
    return Array.from(options).map((modelId) => ({ value: modelId, label: modelId }));
  }, [runtimeConfig?.modelSettings.modelId, selectedDefaultModel, selectedProvider?.modelIds]);

  const handleModelSettingsChange = async (
    changedValues: Record<string, unknown>,
    allValues: {
      defaultProvider?: string;
      defaultModel?: string;
      defaultThinkingLevel?: string;
    },
  ) => {
    if (!runtimeConfig) {
      return;
    }

    const nextValues = { ...allValues };
    const nextProvider = runtimeConfig.providers.find(
      (provider) => provider.providerKey === nextValues.defaultProvider,
    );
    if (Object.prototype.hasOwnProperty.call(changedValues, 'defaultProvider')) {
      if (
        nextValues.defaultModel
        && nextProvider?.modelIds?.length
        && !nextProvider.modelIds.includes(nextValues.defaultModel)
      ) {
        nextValues.defaultModel = undefined;
        form.setFieldValue('defaultModel', undefined);
      }
    }
    const nextModel = nextProvider && nextValues.defaultModel
      ? getProviderModelRecords(nextProvider.modelsProvider).find(
        (entry) => entry.id === nextValues.defaultModel,
      )?.model
      : undefined;
    if (
      nextValues.defaultThinkingLevel
      && !isPiThinkingLevelSupported(nextValues.defaultThinkingLevel, nextModel)
    ) {
      nextValues.defaultThinkingLevel = undefined;
      form.setFieldValue('defaultThinkingLevel', undefined);
    }

    const currentSettings = runtimeConfig.modelSettings;
    const nextDefaultProvider = nextValues.defaultProvider ?? '';
    const nextDefaultModel = nextValues.defaultModel ?? '';
    const nextDefaultThinkingLevel = nextValues.defaultThinkingLevel ?? '';
    if (
      (currentSettings.providerKey ?? '') === nextDefaultProvider
      && (currentSettings.modelId ?? '') === nextDefaultModel
      && (currentSettings.thinkingLevel ?? '') === nextDefaultThinkingLevel
    ) {
      return;
    }

    const saveSeq = saveSeqRef.current + 1;
    saveSeqRef.current = saveSeq;
    try {
      const nextConfig = await savePiModelSettings({
        defaultProvider: nextDefaultProvider,
        defaultModel: nextDefaultModel,
        defaultThinkingLevel: nextDefaultThinkingLevel,
      });
      if (saveSeqRef.current === saveSeq) {
        onConfigUpdated(nextConfig);
      }
      await refreshTrayMenu();
    } catch (error) {
      console.error('Failed to save Pi model settings:', error);
      if (saveSeqRef.current === saveSeq) {
        message.error(t('common.error'));
      }
    }
  };

  return (
    <div className={styles.modelCard}>
      <Title level={5} className={styles.modelCardTitle}>
        <RobotOutlined style={{ marginRight: 8 }} />
        {t('pi.modelSettings.title')}
      </Title>
      <div className={styles.modelCardContent}>
        <Form
          form={form}
          autoComplete="off"
          layout="vertical"
          onValuesChange={handleModelSettingsChange}
        >
          <div className={styles.modelSettingsGrid}>
            <Form.Item label={t('pi.modelSettings.defaultProvider')} name="defaultProvider">
              <Select
                allowClear
                showSearch
                options={providerOptions}
                placeholder={t('pi.modelSettings.defaultProviderPlaceholder')}
              />
            </Form.Item>
            <Form.Item label={t('pi.modelSettings.defaultModel')} name="defaultModel">
              <Select
                allowClear
                showSearch
                options={modelOptions}
                placeholder={t('pi.modelSettings.defaultModelPlaceholder')}
              />
            </Form.Item>
            {thinkingLevelOptions.length > 0 ? (
              <Form.Item label={t('pi.modelSettings.thinkingLevel')} name="defaultThinkingLevel">
                <Select
                  allowClear
                  options={thinkingLevelOptions}
                  placeholder={t('pi.modelSettings.thinkingLevelPlaceholder')}
                />
              </Form.Item>
            ) : null}
          </div>
        </Form>
      </div>
    </div>
  );
};

export default PiModelSettings;
