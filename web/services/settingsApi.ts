/**
 * Settings API Service
 *
 * Handles all settings-related communication with the Tauri backend.
 */

import { invoke } from '@tauri-apps/api/core';

export const SIDEBAR_PAGE_KEYS = ['pi'] as const;

export type SidebarPageKey = typeof SIDEBAR_PAGE_KEYS[number];

export type SidebarHiddenByPage = Record<SidebarPageKey, boolean>;

export type ProxyMode = 'direct' | 'custom' | 'system';

export const createDefaultSidebarHiddenByPage = (): SidebarHiddenByPage => ({
  pi: false,
});

export const normalizeSidebarHiddenByPage = (
  value?: Partial<Record<SidebarPageKey, boolean | { hidden?: boolean }>> | null
): SidebarHiddenByPage => {
  const normalizedValue = createDefaultSidebarHiddenByPage();

  for (const pageKey of SIDEBAR_PAGE_KEYS) {
    const pageValue = value?.[pageKey];
    if (!pageValue) continue;

    if (typeof pageValue === 'boolean') {
      normalizedValue[pageKey] = pageValue;
      continue;
    }

    normalizedValue[pageKey] = pageValue.hidden ?? false;
  }

  return normalizedValue;
};

export interface AppSettings {
  language: string;
  current_module: string;
  current_sub_tab: string;
  launch_on_startup: boolean;
  minimize_to_tray_on_close: boolean;
  start_minimized: boolean;
  proxy_mode: ProxyMode;
  proxy_url: string;
  theme: string;
  auto_check_update: boolean;
  visible_tabs: string[];
  sidebar_hidden_by_page: SidebarHiddenByPage;
}

// Default settings
export const defaultSettings: AppSettings = {
  language: 'zh-CN',
  current_module: 'coding',
  current_sub_tab: 'pi',
  launch_on_startup: true,
  minimize_to_tray_on_close: true,
  start_minimized: false,
  proxy_mode: 'system',
  proxy_url: '',
  theme: 'system',
  auto_check_update: true,
  visible_tabs: ['pi', 'skills', 'mcp'],
  sidebar_hidden_by_page: createDefaultSidebarHiddenByPage(),
};

/**
 * Get settings from database
 */
export const getSettings = async (): Promise<AppSettings> => {
  try {
    const settings = await invoke<AppSettings & {
      sidebar_visibility_by_page?: Partial<Record<SidebarPageKey, boolean | { hidden?: boolean }>>;
    }>('get_settings');
    return {
      ...settings,
      sidebar_hidden_by_page: normalizeSidebarHiddenByPage(
        settings.sidebar_hidden_by_page ?? settings.sidebar_visibility_by_page
      ),
    };
  } catch (error) {
    console.error('Failed to get settings:', error);
    return defaultSettings;
  }
};

/**
 * Save settings to database
 */
export const saveSettings = async (settings: AppSettings): Promise<void> => {
  await invoke('save_settings', { settings });
};

/**
 * Update specific settings fields
 */
export const updateSettings = async (updates: Partial<AppSettings>): Promise<void> => {
  await invoke('update_settings', { updates });
};

/**
 * Set auto launch on startup
 */
export const setAutoLaunch = async (enabled: boolean): Promise<void> => {
  await invoke('set_auto_launch', { enabled });
};

/**
 * Get auto launch status
 */
export const getAutoLaunchStatus = async (): Promise<boolean> => {
  return await invoke<boolean>('get_auto_launch_status');
};

/**
 * Restart the application
 */
export const restartApp = async (): Promise<void> => {
  await invoke('restart_app');
};

/**
 * Test proxy connection
 */
export const testProxyConnection = async (proxyUrl: string): Promise<void> => {
  await invoke('test_proxy_connection', { proxyUrl });
};
