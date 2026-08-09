import React from 'react';
import { App, Button, Progress, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { checkForUpdates, installUpdate, type UpdateInfo } from '@/services/appApi';

export type { UpdateInfo };

export const UPDATE_NOTIFICATION_KEY = 'pi-hub-update';

interface UpdateDownloadProgress {
  status: 'started' | 'downloading' | 'installing';
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
}

/** Shared across all callers so auto + manual checks never double-prompt. */
let updatePromptShown = false;

interface UpdateManagerValue {
  /** Show the "new version available" notification with install / later actions. */
  showUpdatePrompt: (info: UpdateInfo) => void;
  /** Render download/install progress into the update notification. */
  showInstallProgress: (payload: UpdateDownloadProgress) => void;
  /** Run a manual update check; returns true when a newer version exists. */
  checkNow: () => Promise<boolean>;
  /** Download + install the pending update, reporting progress in a notification. */
  install: () => Promise<void>;
  checking: boolean;
  installing: boolean;
}

/**
 * Centralizes the update-check UI (manual + auto) and the download/install
 * progress reporting. Uses the app-context `notification` instance so the
 * toasts follow the active theme and locale.
 */
export const useUpdateManager = (): UpdateManagerValue => {
  const { t } = useTranslation();
  const { notification } = App.useApp();
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);

  const showInstallProgress = React.useCallback((payload: UpdateDownloadProgress) => {
    const percent = Math.min(100, Math.max(0, payload.progress ?? 0));
    notification.open({
      key: UPDATE_NOTIFICATION_KEY,
      message: payload.status === 'installing'
        ? t('update.installing')
        : t('update.downloading', { percent }),
      description: <Progress percent={percent} showInfo={false} status="active" size="small" />,
      duration: 0,
    });
  }, [notification, t]);

  const install = React.useCallback(async () => {
    setInstalling(true);
    notification.destroy(UPDATE_NOTIFICATION_KEY);
    notification.open({
      key: UPDATE_NOTIFICATION_KEY,
      message: t('update.downloading', { percent: 0 }),
      description: <Progress percent={0} showInfo={false} status="active" size="small" />,
      duration: 0,
    });
    try {
      await installUpdate();
      notification.success({
        key: UPDATE_NOTIFICATION_KEY,
        message: t('update.installSuccess'),
        duration: 3,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notification.error({
        key: UPDATE_NOTIFICATION_KEY,
        message: t('update.installFailed', { error: errorMessage }),
        duration: 6,
      });
    } finally {
      setInstalling(false);
    }
  }, [notification, t]);

  const showUpdatePrompt = React.useCallback((info: UpdateInfo, force = false) => {
    if (!info?.hasUpdate || (updatePromptShown && !force)) {
      return;
    }
    updatePromptShown = true;

    notification.open({
      key: UPDATE_NOTIFICATION_KEY,
      message: t('update.title'),
      description: t('update.description', {
        current: info.currentVersion,
        latest: info.latestVersion,
      }),
      duration: 0,
      btn: (
        <Space>
          <Button size="small" type="primary" onClick={() => void install()}>
            {t('update.downloadAndInstall')}
          </Button>
          <Button
            size="small"
            type="text"
            onClick={() => notification.destroy(UPDATE_NOTIFICATION_KEY)}
          >
            {t('update.later')}
          </Button>
        </Space>
      ),
    });
  }, [install, notification, t]);

  const checkNow = React.useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      const info = await checkForUpdates();
      if (!info.hasUpdate) {
        notification.success({
          message: t('update.noUpdate'),
          duration: 3,
        });
        return false;
      }
      showUpdatePrompt(info, true);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notification.error({
        message: t('update.checkFailed', { error: errorMessage }),
        duration: 6,
      });
      return false;
    } finally {
      setChecking(false);
    }
  }, [notification, showUpdatePrompt, t]);

  return {
    showUpdatePrompt,
    showInstallProgress,
    checkNow,
    install,
    checking,
    installing,
  };
};

export type { UpdateDownloadProgress };
