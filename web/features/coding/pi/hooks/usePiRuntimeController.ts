import React from 'react';
import { Form, message } from 'antd';
import { useTranslation } from 'react-i18next';

import { TRAY_CONFIG_REFRESH_EVENT } from '@/constants/configEvents';
import useRootDirectoryConfig from '@/features/coding/shared/useRootDirectoryConfig';
import { refreshTrayMenu } from '@/services/appApi';
import {
  getPiSettingsConfig,
  readPiRuntimeConfig,
  savePiSettingsConfig,
} from '@/services/piApi';
import type { PiRuntimeConfig } from '@/types/pi';

interface PiRuntimeController {
  runtimeConfig: PiRuntimeConfig | null;
  modelForm: ReturnType<typeof Form.useForm>[0];
  loading: boolean;
  loadConfig: (silent?: boolean) => Promise<void>;
  handleConfigUpdated: (config: PiRuntimeConfig) => void;
  handleOpenRootFolder: () => Promise<void>;
  handleRefreshConfig: () => void;
  rootDirectoryModalOpen: boolean;
  setRootDirectoryModalOpen: (open: boolean) => void;
  getRootDirectoryModalProps: ReturnType<typeof useRootDirectoryConfig>['getRootDirectoryModalProps'];
  handleSaveRootDirectory: ReturnType<typeof useRootDirectoryConfig>['handleSaveRootDirectory'];
  handleResetRootDirectory: ReturnType<typeof useRootDirectoryConfig>['handleResetRootDirectory'];
}

/**
 * 共享的 Pi 运行时配置控制器，供 Pi 各子页面（配置/扩展/其它）复用。
 * 负责加载 runtime config、监听托盘刷新事件、根目录弹窗状态。
 */
export const usePiRuntimeController = (): PiRuntimeController => {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(true);
  const [runtimeConfig, setRuntimeConfig] = React.useState<PiRuntimeConfig | null>(null);
  const [modelForm] = Form.useForm();

  const loadConfig = React.useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const config = await readPiRuntimeConfig();
      setRuntimeConfig(config);
      modelForm.setFieldsValue({
        defaultProvider: config.modelSettings.providerKey || undefined,
        defaultModel: config.modelSettings.modelId || undefined,
        defaultThinkingLevel: config.modelSettings.thinkingLevel || undefined,
      });
    } catch (error) {
      console.error('Failed to load Pi runtime config:', error);
      message.error(t('common.error'));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [modelForm, t]);

  React.useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  React.useEffect(() => {
    const handleTrayConfigRefresh = (event: Event) => {
      event.preventDefault();
      void loadConfig(true);
    };

    window.addEventListener(TRAY_CONFIG_REFRESH_EVENT, handleTrayConfigRefresh);
    return () => {
      window.removeEventListener(TRAY_CONFIG_REFRESH_EVENT, handleTrayConfigRefresh);
    };
  }, [loadConfig]);

  const handleConfigUpdated = React.useCallback((config: PiRuntimeConfig) => {
    setRuntimeConfig(config);
  }, []);

  const rootDirectoryConfig = useRootDirectoryConfig({
    t,
    translationKeyPrefix: 'pi',
    defaultConfig: '{}',
    loadConfig,
    getCommonConfig: getPiSettingsConfig,
    saveCommonConfig: savePiSettingsConfig,
  });

  const handleOpenRootFolder = async () => {
    if (runtimeConfig?.rootPathInfo.path) {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(runtimeConfig.rootPathInfo.path);
    }
  };

  const handleRefreshConfig = () => {
    void loadConfig(true);
    void refreshTrayMenu();
  };

  return {
    runtimeConfig,
    modelForm,
    loading,
    loadConfig,
    handleConfigUpdated,
    handleOpenRootFolder,
    handleRefreshConfig,
    rootDirectoryModalOpen: rootDirectoryConfig.rootDirectoryModalOpen,
    setRootDirectoryModalOpen: rootDirectoryConfig.setRootDirectoryModalOpen,
    getRootDirectoryModalProps: rootDirectoryConfig.getRootDirectoryModalProps,
    handleSaveRootDirectory: rootDirectoryConfig.handleSaveRootDirectory,
    handleResetRootDirectory: rootDirectoryConfig.handleResetRootDirectory,
  };
};
