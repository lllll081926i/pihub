import React from 'react';
import { ConfigProvider, Spin, App, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { emit, listen } from '@tauri-apps/api/event';
import { TRAY_CONFIG_REFRESH_EVENT } from '@/constants/configEvents';
import { useAppStore } from '@/stores';
import { useThemeStore } from '@/stores/themeStore';
import { useUpdateManager, type UpdateDownloadProgress, type UpdateInfo } from '@/hooks/useUpdateManager';
import {
  setWindowBackgroundColor,
  setWindowTheme,
  loadCachedPresetModels,
  fetchRemotePresetModels,
} from '@/services';
import i18n, { loadLanguageResources } from '@/i18n';

interface ProvidersProps {
  children: React.ReactNode;
}

const antdLocales = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/**
 * Global bridge for backend events that need an app-wide response:
 * - `config-changed` (tray): reload active pages so they resync to disk state.
 * - `update-available` / `update-download-progress`: surface the startup
 *   auto-update check and in-place download progress via a non-intrusive
 *   notification instead of a blocking dialog.
 */
const AppInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showUpdatePrompt, showInstallProgress } = useUpdateManager();

  // Keep a global fallback for tray-driven config changes so inactive pages and
  // subpanels that do not maintain their own listeners still resync to disk state.
  React.useEffect(() => {
    let unlistenConfig: (() => void) | undefined;
    let unlistenUpdate: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        unlistenConfig = await listen<string>('config-changed', async (event) => {
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

      try {
        unlistenUpdate = await listen<UpdateInfo>('update-available', (event) => {
          showUpdatePrompt(event.payload);
        });
      } catch (error) {
        console.error('Failed to setup update listener:', error);
      }

      try {
        unlistenProgress = await listen<UpdateDownloadProgress>(
          'update-download-progress',
          (event) => {
            showInstallProgress(event.payload);
          },
        );
      } catch (error) {
        console.error('Failed to setup update progress listener:', error);
      }
    };

    void setupListeners();

    return () => {
      unlistenConfig?.();
      unlistenUpdate?.();
      unlistenProgress?.();
    };
  }, [showInstallProgress, showUpdatePrompt]);

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
      colorPrimary: '#1677ff',
      colorInfo: '#1677ff',
      borderRadius: 6,
      // Align Ant Design surfaces with the App.css design tokens so antd
      // components (Card/Modal/Table/Select) share the same layered palette.
      ...(resolvedTheme === 'dark' ? {
        colorBgLayout: '#0e1013',
        colorBgContainer: '#171b21',
        colorBgElevated: '#1e242c',
        colorBorder: 'rgba(255, 255, 255, 0.18)',
        colorBorderSecondary: 'rgba(255, 255, 255, 0.1)',
      } : {
        colorBgLayout: '#f4f5f7',
        colorBgContainer: '#ffffff',
        colorBgElevated: '#fafbfc',
      }),
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

  // Set window background color for macOS titlebar and sync native title bar theme
  React.useEffect(() => {
    if (themeInitialized) {
      // Light theme: #ffffff, Dark theme: #0e1013 (matches --color-bg-base)
      const bgColor = resolvedTheme === 'dark' ? { r: 14, g: 16, b: 19 } : { r: 255, g: 255, b: 255 };
      setWindowBackgroundColor(bgColor.r, bgColor.g, bgColor.b).catch(console.error);
      // Windows native title bar follows the app theme via DWM immersive dark mode.
      setWindowTheme(resolvedTheme).catch(console.error);
    }
  }, [resolvedTheme, themeInitialized]);

  // Sync i18n language when app language changes (locale bundle loads on demand)
  React.useEffect(() => {
    if (appInitialized && i18n.language !== language) {
      void loadLanguageResources(language).then(() => {
        void i18n.changeLanguage(language);
      });
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
