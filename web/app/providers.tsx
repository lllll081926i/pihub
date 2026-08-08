import React from 'react';
import { ConfigProvider, Spin, App, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { emit, listen } from '@tauri-apps/api/event';
import { TRAY_CONFIG_REFRESH_EVENT } from '@/constants/configEvents';
import { useAppStore } from '@/stores';
import { useThemeStore } from '@/stores/themeStore';
import {
  setWindowBackgroundColor,
  loadCachedPresetModels,
  fetchRemotePresetModels,
} from '@/services';
import i18n from '@/i18n';

interface ProvidersProps {
  children: React.ReactNode;
}

const antdLocales = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/**
 * Inner component that uses App.useApp() to get theme-aware notification
 */
/**
 * Globally-mounted deep-link import dialog: listens for `deep-link-import` /
 * `deep-link-error` events from the backend and shows a confirmation modal
 * (with a masked API key) before persisting via `import_from_deeplink_unified`.
 * The hook marks the frontend listener ready and drains a cold-start pending
 * request after the listeners are attached.
 */
const AppInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {


  // Keep a global fallback for tray-driven config changes so inactive pages and
  // subpanels that do not maintain their own listeners still resync to disk state.
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<string>('config-changed', async (event) => {
          if (event.payload === 'tray') {
            const refreshEvent = new CustomEvent(TRAY_CONFIG_REFRESH_EVENT, {
              cancelable: true,
            });
            window.dispatchEvent(refreshEvent);

            if (!refreshEvent.defaultPrevented) {
              window.location.reload();
            }
          }
        });
      } catch (error) {
        console.error('Failed to setup config change listener:', error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return (
    <>
      {children}
    </>
  );
};

export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  const { language, isInitialized: appInitialized, initApp } = useAppStore();
    const { mode, resolvedTheme, isInitialized: themeInitialized, initTheme, updateResolvedTheme } = useThemeStore();

  const isLoading = !appInitialized || !themeInitialized;
  const antdLocale = antdLocales[language];
  const modalConfig = React.useMemo(() => ({
    centered: true,
  }), []);
  const antdThemeConfig = React.useMemo(() => ({
    algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#1890ff',
    },
  }), [resolvedTheme]);

  React.useEffect(() => {
    let cancelled = false;

    const sendReady = () => {
      emit('frontend-ready').catch(() => {});
    };

    // Emit twice to avoid missing the backend listener during early startup.
    sendReady();
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        sendReady();
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Initialize app, settings and theme on mount
  React.useEffect(() => {
    const init = async () => {
      await initApp();
      await initTheme();
      // Load preset models: local cache first (fast), then remote (background)
      await loadCachedPresetModels();
      fetchRemotePresetModels();
    };
    init();
  }, [initApp, initTheme]);

  // Listen for system theme changes
  React.useEffect(() => {
    if (!themeInitialized) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      if (mode === 'system') {
        updateResolvedTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mode, themeInitialized, updateResolvedTheme]);

  // Apply data-theme attribute to document
  React.useEffect(() => {
    if (themeInitialized) {
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    }
  }, [resolvedTheme, themeInitialized]);

  // Set window background color for macOS titlebar
  React.useEffect(() => {
    if (themeInitialized) {
      // Light theme: #ffffff, Dark theme: #1f1f1f
      const bgColor = resolvedTheme === 'dark' ? { r: 31, g: 31, b: 31 } : { r: 255, g: 255, b: 255 };
      setWindowBackgroundColor(bgColor.r, bgColor.g, bgColor.b).catch(console.error);
    }
  }, [resolvedTheme, themeInitialized]);

  // Sync i18n language when app language changes
  React.useEffect(() => {
    if (appInitialized && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, appInitialized]);

  React.useEffect(() => {
    ConfigProvider.config({
      holderRender: (modalChildren) => (
        <ConfigProvider
          locale={antdLocale}
          modal={modalConfig}
          theme={antdThemeConfig}
        >
          {modalChildren}
        </ConfigProvider>
      ),
    });

    return () => {
      ConfigProvider.config({ holderRender: undefined });
    };
  }, [antdLocale, antdThemeConfig, modalConfig]);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          width: '100vw',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ConfigProvider
      locale={antdLocale}
      modal={modalConfig}
      theme={antdThemeConfig}
    >
      <App>
        <AppInitializer>
          {children}
        </AppInitializer>
      </App>
    </ConfigProvider>
  );
};
