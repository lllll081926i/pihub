import { create } from 'zustand';
import type { Language } from '@/i18n';
import { getSettings, saveSettings, type AppSettings } from '@/services';

interface AppState {
  // Loading state
  isLoading: boolean;
  isInitialized: boolean;

  // App state
  language: Language;

  // Actions
  initApp: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
}

export const useAppStore = create<AppState>()((set, get) => ({
  isLoading: false,
  isInitialized: false,
  language: 'zh-CN',

  initApp: async () => {
    if (get().isInitialized) return;

    set({ isLoading: true });
    try {
      const settings = await getSettings();
      set({
        language: (settings.language as Language) || 'zh-CN',
        isInitialized: true,
      });
    } catch (error) {
      console.error('Failed to load app settings:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  setLanguage: async (language) => {
    set({ language });

    try {
      const currentSettings = await getSettings();
      const newSettings: AppSettings = {
        ...currentSettings,
        language,
      };
      await saveSettings(newSettings);
    } catch (error) {
      console.error('Failed to save language:', error);
    }
  },
}));