import React from 'react';
import {
  Button,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  BgColorsOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  PoweroffOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import {
  getSettings,
  saveSettings,
  getAutoLaunchStatus,
  setAutoLaunch,
  restartApp,
  testProxyConnection,
  type AppSettings,
} from '@/services/settingsApi';
import { clearTokenStatsCache } from '@/services/tokenStatsApi';
import { exportDatabaseBackup, importDatabaseBackup } from '@/services/backupApi';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores';
import { useThemeStore } from '@/stores/themeStore';
import { useUpdateManager } from '@/hooks/useUpdateManager';
import pkg from '../../../package.json';
import styles from './SettingsPage.module.less';

const { Title, Text } = Typography;

type SettingsCategory = 'app' | 'appearance' | 'network' | 'startup' | 'storage';

interface CategoryItem {
  key: SettingsCategory;
  labelKey: string;
  icon: React.ReactNode;
}

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { initSettings } = useSettingsStore();
  const { setMode } = useThemeStore();
  const { checkNow, checking } = useUpdateManager();
  const [loading, setLoading] = React.useState(false);
  const [initLoading, setInitLoading] = React.useState(true);
  const [autoLaunchStatus, setAutoLaunchStatus] = React.useState<boolean | null>(null);
  const [activeCategory, setActiveCategory] = React.useState<SettingsCategory>('app');
  const appVersion = pkg.version;
  const [appDataDir, setAppDataDir] = React.useState('');
  const [testingProxy, setTestingProxy] = React.useState(false);
  const [clearingCache, setClearingCache] = React.useState(false);
  const loadedSettingsRef = React.useRef<AppSettings | null>(null);
  const [appSettings, setAppSettings] = React.useState({
    language: 'zh-CN',
    theme: 'system' as 'light' | 'dark' | 'system',
    proxyMode: 'system' as 'direct' | 'custom' | 'system',
    proxyUrl: '',
    launchOnStartup: true,
    minimizeToTray: true,
    startMinimized: false,
    autoCheckUpdate: true,
  });

  const categories: CategoryItem[] = [
    { key: 'app', labelKey: 'settings.categoryApp', icon: <InfoCircleOutlined /> },
    { key: 'appearance', labelKey: 'settings.categoryAppearance', icon: <BgColorsOutlined /> },
    { key: 'network', labelKey: 'settings.categoryNetwork', icon: <GlobalOutlined /> },
    { key: 'startup', labelKey: 'settings.categoryStartup', icon: <RocketOutlined /> },
    { key: 'storage', labelKey: 'settings.categoryStorage', icon: <DatabaseOutlined /> },
  ];

  React.useEffect(() => {
    const load = async () => {
      try {
        const [s, autoStatus, dataDir] = await Promise.all([
          getSettings(),
          getAutoLaunchStatus().catch(() => null),
          import('@tauri-apps/api/core').then(({ invoke }) =>
            invoke<string>('get_app_data_dir').catch(() => '')
          ),
        ]);
        setAppSettings({
          language: s.language || 'zh-CN',
          theme: (s.theme as 'light' | 'dark' | 'system') || 'system',
          proxyMode: (s.proxy_mode as 'direct' | 'custom' | 'system') || 'system',
          proxyUrl: s.proxy_url || '',
          launchOnStartup: s.launch_on_startup ?? true,
          minimizeToTray: s.minimize_to_tray_on_close ?? true,
          startMinimized: s.start_minimized ?? false,
          autoCheckUpdate: s.auto_check_update ?? true,
        });
        setAutoLaunchStatus(autoStatus);
        setAppDataDir(dataDir || '');
        // Keep the full loaded record so a later save preserves fields this page
        // does not manage (legacy current_module/current_sub_tab/visible_tabs/
        // sidebar_hidden_by_page) instead of overwriting them with defaults.
        loadedSettingsRef.current = s;
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setInitLoading(false);
      }
    };
    void load();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const loaded = loadedSettingsRef.current;
      await saveSettings({
        // Fields this page manages.
        language: appSettings.language,
        proxy_mode: appSettings.proxyMode,
        proxy_url: appSettings.proxyUrl,
        theme: appSettings.theme,
        launch_on_startup: appSettings.launchOnStartup,
        minimize_to_tray_on_close: appSettings.minimizeToTray,
        start_minimized: appSettings.startMinimized,
        auto_check_update: appSettings.autoCheckUpdate,
        // Legacy fields this page does not manage: preserve whatever is stored
        // instead of clobbering it with hardcoded defaults.
        current_module: loaded?.current_module ?? 'coding',
        current_sub_tab: loaded?.current_sub_tab ?? 'pi',
        visible_tabs: loaded?.visible_tabs?.length
          ? loaded.visible_tabs
          : ['pi', 'skills', 'mcp'],
        sidebar_hidden_by_page: loaded?.sidebar_hidden_by_page ?? { pi: false },
      });
      setMode(appSettings.theme);
      await initSettings();
      message.success(t('common.success'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleTestProxy = async () => {
    if (!appSettings.proxyUrl) {
      message.warning(t('settings.proxyUrlEmpty'));
      return;
    }
    setTestingProxy(true);
    try {
      await testProxyConnection(appSettings.proxyUrl);
      message.success(t('settings.proxyTestSuccess'));
    } catch {
      message.error(t('settings.proxyTestFailed'));
    } finally {
      setTestingProxy(false);
    }
  };

  const handleRestart = async () => {
    try {
      await restartApp();
    } catch {
      message.error(t('common.error'));
    }
  };

  const handleAutoLaunchToggle = async (checked: boolean) => {
    setAutoLaunchStatus(checked);
    // Keep the DB field in sync so a later save does not overwrite it with a stale value.
    setAppSettings((settings) => ({ ...settings, launchOnStartup: checked }));
    try {
      await setAutoLaunch(checked);
    } catch {
      setAutoLaunchStatus(!checked);
      setAppSettings((settings) => ({ ...settings, launchOnStartup: !checked }));
      message.error(t('common.error'));
    }
  };

  const renderAppSection = () => (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <AppstoreOutlined />
        {t('settings.appInfo')}
      </h3>
      <div className={styles.sectionContent}>
        <div className={styles.infoRow}>
          <Text className={styles.infoLabel}>{t('settings.version')}</Text>
          <Text className={styles.infoValue}>{appVersion}</Text>
        </div>
        <div className={styles.infoRow}>
          <Text className={styles.infoLabel}>{t('settings.dataDir')}</Text>
          <Text code className={styles.infoValue} style={{ fontSize: 12 }}>
            {appDataDir || t('common.loading')}
          </Text>
        </div>
        <div className={styles.infoRow}>
          <Text className={styles.infoLabel}>{t('settings.updateCheck')}</Text>
          <Button onClick={() => void checkNow()} loading={checking}>
            {t('settings.checkForUpdates')}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderAppearanceSection = () => (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <BgColorsOutlined />
        {t('settings.categoryAppearance')}
      </h3>
      <div className={styles.sectionContent}>
        <div className={styles.formItem}>
          <Text className={styles.formLabel}>{t('settings.language')}</Text>
          <Select
            value={appSettings.language}
            onChange={(v) => setAppSettings(s => ({ ...s, language: v }))}
            className={styles.formControl}
            options={[
              { value: 'zh-CN', label: '中文' },
              { value: 'en-US', label: 'English' },
            ]}
          />
        </div>
        <div className={styles.formItem}>
          <Text className={styles.formLabel}>{t('settings.theme')}</Text>
          <Radio.Group
            value={appSettings.theme}
            onChange={(e) => setAppSettings(s => ({ ...s, theme: e.target.value }))}
          >
            <Radio value="system">{t('settings.themeSystem')}</Radio>
            <Radio value="light">{t('settings.themeLight')}</Radio>
            <Radio value="dark">{t('settings.themeDark')}</Radio>
          </Radio.Group>
        </div>
      </div>
    </div>
  );

  const renderNetworkSection = () => (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <GlobalOutlined />
        {t('settings.categoryNetwork')}
      </h3>
      <div className={styles.sectionContent}>
        <div className={styles.formItem}>
          <Text className={styles.formLabel}>{t('settings.proxyMode')}</Text>
          <Radio.Group
            value={appSettings.proxyMode}
            onChange={(e) => setAppSettings(s => ({ ...s, proxyMode: e.target.value }))}
          >
            <Radio value="system">{t('settings.proxySystem')}</Radio>
            <Radio value="direct">{t('settings.proxyDirect')}</Radio>
            <Radio value="custom">{t('settings.proxyCustom')}</Radio>
          </Radio.Group>
        </div>
        {appSettings.proxyMode === 'custom' && (
          <div className={styles.formItem}>
            <Text className={styles.formLabel}>{t('settings.proxyUrl')}</Text>
            <Space direction="vertical" style={{ width: '100%', maxWidth: 400 }}>
              <Input
                value={appSettings.proxyUrl}
                onChange={(e) => setAppSettings(s => ({ ...s, proxyUrl: e.target.value }))}
                placeholder="http://user:pass@proxy:8080"
              />
              <Text className={styles.formHint}>{t('settings.proxyUrlHint')}</Text>
              <Space>
                <Button size="small" onClick={handleTestProxy} loading={testingProxy}>
                  {t('settings.testProxy')}
                </Button>
              </Space>
            </Space>
          </div>
        )}
      </div>
    </div>
  );

  const renderStartupSection = () => (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <PoweroffOutlined />
        {t('settings.categoryStartup')}
      </h3>
      <div className={styles.sectionContent}>
        <div className={styles.switchRow}>
          <div className={styles.switchLabel}>
            <Text className={styles.switchTitle}>{t('settings.launchOnStartup')}</Text>
            <Text className={styles.switchHint}>{t('settings.launchOnStartupHint')}</Text>
          </div>
          <Switch
            checked={autoLaunchStatus ?? appSettings.launchOnStartup}
            onChange={handleAutoLaunchToggle}
          />
        </div>
        <div className={styles.switchRow}>
          <div className={styles.switchLabel}>
            <Text className={styles.switchTitle}>{t('settings.minimizeToTray')}</Text>
            <Text className={styles.switchHint}>{t('settings.minimizeToTrayHint')}</Text>
          </div>
          <Switch
            checked={appSettings.minimizeToTray}
            onChange={(v) => setAppSettings(s => ({
              ...s,
              minimizeToTray: v,
              // startMinimized only makes sense while minimize-to-tray is enabled
              startMinimized: v ? s.startMinimized : false,
            }))}
          />
        </div>
        {appSettings.minimizeToTray && (
          <div className={styles.switchRow}>
            <div className={styles.switchLabel}>
              <Text className={styles.switchTitle}>{t('settings.startMinimized')}</Text>
              <Text className={styles.switchHint}>{t('settings.startMinimizedHint')}</Text>
            </div>
            <Switch
              checked={appSettings.startMinimized}
              onChange={(v) => setAppSettings(s => ({ ...s, startMinimized: v }))}
            />
          </div>
        )}
        <div className={styles.switchRow}>
          <div className={styles.switchLabel}>
            <Text className={styles.switchTitle}>{t('settings.autoCheckUpdate')}</Text>
            <Text className={styles.switchHint}>{t('settings.autoCheckUpdateHint')}</Text>
          </div>
          <Switch
            checked={appSettings.autoCheckUpdate}
            onChange={(v) => setAppSettings(s => ({ ...s, autoCheckUpdate: v }))}
          />
        </div>
        <div className={styles.formItem} style={{ marginTop: 'var(--space-md)' }}>
          <Text className={styles.formLabel}>{t('settings.actions')}</Text>
          <Button onClick={handleRestart}>{t('settings.restartApp')}</Button>
        </div>
      </div>
    </div>
  );

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await clearTokenStatsCache();
      message.success(t('settings.clearCacheSuccess'));
    } catch (error) {
      console.error('Failed to clear cache:', error);
    } finally {
      setClearingCache(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      await exportDatabaseBackup(selected);
      message.success(t('settings.backupExportSuccess'));
    } catch (error) {
      console.error('Failed to export backup:', error);
      message.error(t('common.error'));
    }
  };

  const handleImportBackup = async () => {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      await importDatabaseBackup(selected);
      Modal.confirm({
        title: t('settings.backupImportTitle'),
        content: t('settings.backupImportContent'),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        onOk: () => void handleRestart(),
      });
    } catch (error) {
      console.error('Failed to import backup:', error);
      message.error(t('common.error'));
    }
  };

  const renderStorageSection = () => (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <DatabaseOutlined />
        {t('settings.categoryStorage')}
      </h3>
      <div className={styles.sectionContent}>
        <div className={styles.switchRow}>
          <div className={styles.switchLabel}>
            <Text className={styles.switchTitle}>{t('settings.cacheTitle')}</Text>
            <Text className={styles.switchHint}>{t('settings.cacheHint')}</Text>
          </div>
          <Button onClick={handleClearCache} loading={clearingCache}>
            {t('settings.clearCache')}
          </Button>
        </div>
        <div className={styles.switchRow}>
          <div className={styles.switchLabel}>
            <Text className={styles.switchTitle}>{t('settings.backupTitle')}</Text>
            <Text className={styles.switchHint}>{t('settings.backupHint')}</Text>
          </div>
          <Space>
            <Button onClick={() => void handleExportBackup()}>
              {t('settings.backupExport')}
            </Button>
            <Button onClick={() => void handleImportBackup()}>
              {t('settings.backupImport')}
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeCategory) {
      case 'app':
        return renderAppSection();
      case 'appearance':
        return renderAppearanceSection();
      case 'network':
        return renderNetworkSection();
      case 'startup':
        return renderStartupSection();
      case 'storage':
        return renderStorageSection();
      default:
        return null;
    }
  };

  return (
    <Spin spinning={initLoading}>
      <div className={styles.page}>
        {/* 左侧导航 */}
        <div className={styles.sidebar}>
          {categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`${styles.sidebarItem} ${activeCategory === cat.key ? styles.active : ''}`}
              onClick={() => setActiveCategory(cat.key)}
            >
              <span className={styles.sidebarIcon}>{cat.icon}</span>
              <span>{t(cat.labelKey)}</span>
            </button>
          ))}
        </div>

        {/* 右侧内容 */}
        <div className={styles.content}>
          <div className={styles.header}>
            <Title level={4} className={styles.title}>{t('settings.title')}</Title>
          </div>
          {renderContent()}
          <div className={styles.footer}>
            <Button type="primary" onClick={handleSave} loading={loading}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Spin>
  );
};

export default SettingsPage;
