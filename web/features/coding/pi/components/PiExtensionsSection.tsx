import React from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreAddOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';

import { MagicContextSettings } from '@/features/coding/shared/magicContext';
import {
  installPiExtension,
  listPiExtensions,
  uninstallPiExtension,
  updatePiExtensions,
} from '@/services/piApi';
import type {
  PiExtensionCommandResult,
  PiExtensionListResult,
  PiExtensionSummary,
} from '@/types/pi';

import styles from './PiExtensionsSection.module.less';

const { Text, Paragraph } = Typography;
const PI_PACKAGES_URL = 'https://pi.dev/packages';

interface PiExtensionsSectionProps {
  refreshKey?: number;
}

/**
 * Module-level cache so switching away from the extensions page and back
 * does not re-fetch from scratch; the first render shows the cached list
 * and a background refresh keeps it current.
 */
let EXTENSIONS_CACHE: PiExtensionListResult | null = null;
const normalizeSource = (source: string): string => source.trim().toLowerCase();

const getSourceDisplayName = (source: string): string => (
  source.replace(/^(?:npm|file|github|git):/i, '')
);

const isMagicContextInstalled = (extensions: PiExtensionSummary[]): boolean => (
  extensions.some((extension) => {
    const normalizedSource = normalizeSource(extension.source);
    return normalizedSource === 'npm:@cortexkit/pi-magic-context'
      || normalizedSource === '@cortexkit/pi-magic-context';
  })
);

const PiExtensionsSection: React.FC<PiExtensionsSectionProps> = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [data, setData] = React.useState<PiExtensionListResult | null>(() => EXTENSIONS_CACHE);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [customSource, setCustomSource] = React.useState('');
  const [installingSources, setInstallingSources] = React.useState<Set<string>>(() => new Set());
  const [uninstallingSource, setUninstallingSource] = React.useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = React.useState<PiExtensionSummary | null>(null);
  const [updating, setUpdating] = React.useState(false);
  const [updatingSource, setUpdatingSource] = React.useState<string | null>(null);
  const [commandResult, setCommandResult] = React.useState<PiExtensionCommandResult | null>(null);

  const loadExtensions = React.useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await listPiExtensions();
      setData(result);
      EXTENSIONS_CACHE = result;
    } catch (loadError) {
      const messageText = loadError instanceof Error ? loadError.message : String(loadError);
      if (!data) {
        setError(messageText);
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [data]);

  React.useEffect(() => {
    // Background refresh: show cached data first, then silently refresh
    void loadExtensions(true);
  }, [loadExtensions]);

  const extensions = data?.extensions ?? [];
  const updateAvailableCount = extensions.filter((extension) => extension.updateAvailable).length;
  const magicContextInstalled = isMagicContextInstalled(extensions);

  const handleInstall = async (source: string) => {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      void message.warning(t('pi.extensions.sourceRequired'));
      return;
    }

    setInstallingSources((current) => new Set(current).add(normalizedSource));
    try {
      await installPiExtension({ source: normalizedSource });
      void message.success(t('pi.extensions.installSuccess'));
      setCustomSource('');
      await loadExtensions(true);
    } catch (installError) {
      void message.error(
        installError instanceof Error ? installError.message : String(installError),
      );
    } finally {
      setInstallingSources((current) => {
        const next = new Set(current);
        next.delete(normalizedSource);
        return next;
      });
    }
  };

  const handleConfirmUninstall = async () => {
    if (!pendingUninstall) {
      return;
    }
    const extension = pendingUninstall;
    setUninstallingSource(extension.source);
    try {
      await uninstallPiExtension({
        source: extension.source,
        scope: extension.scope,
        kind: extension.kind,
        path: extension.path,
      });
      void message.success(
        extension.kind === 'package'
          ? t('pi.extensions.uninstallSuccess')
          : t('pi.extensions.deleteSuccess'),
      );
      setPendingUninstall(null);
      await loadExtensions(true);
    } catch (uninstallError) {
      void message.error(
        uninstallError instanceof Error ? uninstallError.message : String(uninstallError),
      );
    } finally {
      setUninstallingSource(null);
    }
  };

  const handleUpdateAll = async () => {
    setUpdating(true);
    try {
      const result = await updatePiExtensions();
      setCommandResult(result);
      await loadExtensions(true);
    } catch (updateError) {
      void message.error(
        updateError instanceof Error ? updateError.message : String(updateError),
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateOne = async (source: string) => {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      return;
    }
    setUpdatingSource(normalizedSource);
    try {
      const result = await updatePiExtensions({ source: normalizedSource });
      setCommandResult(result);
      await loadExtensions(true);
    } catch (updateError) {
      void message.error(
        updateError instanceof Error ? updateError.message : String(updateError),
      );
    } finally {
      setUpdatingSource(null);
    }
  };

  const handleOpenExtensionsFolder = async () => {
    if (!data?.extensionsPath) {
      return;
    }
    try {
      await invoke('open_folder', { path: data.extensionsPath });
    } catch (openError) {
      void message.error(openError instanceof Error ? openError.message : String(openError));
    }
  };

  const handleOpenPackagesFolder = async () => {
    if (!data?.packagesPath) {
      return;
    }
    try {
      await invoke('open_folder', { path: data.packagesPath });
    } catch (openError) {
      void message.error(openError instanceof Error ? openError.message : String(openError));
    }
  };

  const renderInstalledExtension = (extension: PiExtensionSummary) => {
    const isPackage = extension.kind === 'package';
    const actionText = isPackage ? t('pi.extensions.uninstall') : t('pi.extensions.deleteLocal');
    const versionLabel = extension.updateAvailable
      && extension.currentVersion
      && extension.latestVersion
      ? `${extension.currentVersion} → ${extension.latestVersion}`
      : extension.currentVersion;
    const isUpdatingThis = updatingSource === extension.source;

    return (
      <div key={extension.id} className={styles.extensionItem}>
        <div className={styles.extensionContent}>
          <div className={styles.extensionTitleRow}>
            <Space size={6} wrap>
              <Text strong>{getSourceDisplayName(extension.source)}</Text>
              {versionLabel && (
                <Text code className={styles.inlineMetaText}>
                  {versionLabel}
                </Text>
              )}
              {extension.updateAvailable && (
                <Button
                  type="link"
                  size="small"
                  className={styles.updateAvailableButton}
                  icon={<SyncOutlined />}
                  loading={isUpdatingThis}
                  disabled={updating || Boolean(updatingSource && !isUpdatingThis)}
                  onClick={() => {
                    void handleUpdateOne(extension.source);
                  }}
                >
                  {t('pi.extensions.updateAvailable')}
                </Button>
              )}
              {extension.builtIn && <Tag color="blue">{t('pi.extensions.builtIn')}</Tag>}
            </Space>
          </div>
          <Text
            type="secondary"
            className={styles.extensionSecondary}
            title={extension.path || extension.source}
          >
            {extension.source}
          </Text>
        </div>
        <Space size={6} className={styles.itemActions}>
          {!extension.builtIn && (
            <Tooltip title={actionText}>
              <Button
                danger
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                loading={uninstallingSource === extension.source}
                onClick={() => setPendingUninstall(extension)}
              />
            </Tooltip>
          )}
        </Space>
      </div>
    );
  };

  return (
    <>
      <div className={styles.sectionTitle}>
        <AppstoreAddOutlined />
        <Text strong>{t('pi.extensions.title')}</Text>
        <div className={styles.sectionTitleRight}>
          <Button
            type="link"
            size="small"
            icon={<FolderOpenOutlined />}
            disabled={!data?.extensionsPath}
            onClick={handleOpenExtensionsFolder}
          >
            {t('pi.extensions.openDirectory')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<FolderOpenOutlined />}
            disabled={!data?.packagesPath}
            onClick={handleOpenPackagesFolder}
          >
            {t('pi.extensions.openPackagesDirectory')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => loadExtensions()}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className={styles.content}>
        {error && (
          <Alert
            type="error"
            showIcon
            message={t('pi.extensions.loadFailed')}
            description={error}
          />
        )}
        <div className={styles.metaRow}>
          <Text type="secondary">{t('pi.extensions.cliPathLabel')}</Text>
          <Text code className={styles.pathText}>
            {data?.cliPath || '-'}
          </Text>
          {data?.cliVersion && (
            <>
              <Text type="secondary">{t('pi.extensions.cliVersionLabel')}</Text>
              <Text code className={styles.pathText}>
                {data.cliVersion}
              </Text>
            </>
          )}
          <Text type="secondary">{t('pi.extensions.pathLabel')}</Text>
          <Text code className={styles.pathText}>
            {data?.extensionsPath || '-'}
          </Text>
          <Text type="secondary">{t('pi.extensions.packagesPathLabel')}</Text>
          <Text code className={styles.pathText}>
            {data?.packagesPath || '-'}
          </Text>
          <Text type="secondary">{t('pi.extensions.restartHint')}</Text>
        </div>

        <div className={styles.customInstallRow}>
          <Input
            value={customSource}
            onChange={(event) => setCustomSource(event.target.value)}
            onPressEnter={() => {
              void handleInstall(customSource);
            }}
            placeholder={t('pi.extensions.sourcePlaceholder')}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={installingSources.has(customSource.trim())}
            onClick={() => {
              void handleInstall(customSource);
            }}
          >
            {t('pi.extensions.install')}
          </Button>
          <Button
            type="text"
            icon={<LinkOutlined />}
            onClick={() => {
              void openUrl(PI_PACKAGES_URL);
            }}
          >
            {t('pi.extensions.officialPackages')}
          </Button>
        </div>

        <Collapse
          className={styles.innerCollapse}
          size="small"
          bordered={false}
          defaultActiveKey={['installed']}
          items={[
            {
              key: 'installed',
              label: (
                <Space>
                  <Text strong>{t('pi.extensions.installedTitle')}</Text>
                  <Text type="secondary">
                    {t('pi.extensions.count', { count: extensions.length })}
                  </Text>
                  {updateAvailableCount > 0 && (
                    <Text type="warning">
                      {t('pi.extensions.updateAvailableCount', {
                        count: updateAvailableCount,
                      })}
                    </Text>
                  )}
                </Space>
              ),
              extra: (
                <Button
                  type="link"
                  size="small"
                  icon={<SyncOutlined />}
                  loading={updating}
                  disabled={Boolean(updatingSource)}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleUpdateAll();
                  }}
                >
                  {updateAvailableCount > 0
                    ? t('pi.extensions.updateAllWithCount', {
                        count: updateAvailableCount,
                      })
                    : t('pi.extensions.updateAll')}
                </Button>
              ),
              children: loading && !data ? (
                <div className={styles.loadingText}>{t('pi.extensions.loading')}</div>
              ) : extensions.length > 0 ? (
                <div className={styles.installedList}>
                  {extensions.map(renderInstalledExtension)}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('pi.extensions.emptyInstalled')}
                />
              ),
            },
          ]}
        />

        {magicContextInstalled && (
          <MagicContextSettings harness="pi" />
        )}
      </div>

      <Modal
        title={pendingUninstall?.kind === 'package'
          ? t('pi.extensions.confirmUninstallTitle')
          : t('pi.extensions.confirmDeleteTitle')}
        open={!!pendingUninstall}
        okText={pendingUninstall?.kind === 'package'
          ? t('pi.extensions.uninstall')
          : t('pi.extensions.deleteLocal')}
        okButtonProps={{
          danger: true,
          loading: Boolean(pendingUninstall && uninstallingSource === pendingUninstall.source),
        }}
        cancelText={t('common.cancel')}
        onOk={handleConfirmUninstall}
        onCancel={() => setPendingUninstall(null)}
        destroyOnHidden
      >
        {pendingUninstall && (
          <div className={styles.confirmContent}>
            <Paragraph>
              {pendingUninstall.kind === 'package'
                ? t('pi.extensions.confirmUninstallContent')
                : t('pi.extensions.confirmDeleteContent')}
            </Paragraph>
            <Text code>{pendingUninstall.source}</Text>
            {pendingUninstall.path && (
              <Text type="secondary" className={styles.pathText}>
                {pendingUninstall.path}
              </Text>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={t('pi.extensions.updateResultTitle')}
        open={!!commandResult}
        footer={[
          <Button key="close" type="primary" onClick={() => setCommandResult(null)}>
            {t('common.close')}
          </Button>,
        ]}
        onCancel={() => setCommandResult(null)}
        destroyOnHidden
      >
        {commandResult && (
          <pre className={styles.commandOutput}>
            {`${commandResult.command}\n${commandResult.output || t('pi.extensions.emptyCommandOutput')}`}
          </pre>
        )}
      </Modal>
    </>
  );
};

export default PiExtensionsSection;