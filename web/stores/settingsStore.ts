import { create } from 'zustand';
import type { SidebarHiddenByPage } from '@/services';
import {
  getSettings,
  updateSettings,
  normalizeSidebarHiddenByPage,
} from '@/services';

interface SettingsState {
  isLoading: boolean;
  isInitialized: boolean;
  sidebarHiddenByPage: SidebarHiddenByPage;

  initSettings: () => Promise<void>;
  setSidebarHidden: (page: string, hidden: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  isLoading: false,
  isInitialized: false,
  sidebarHiddenByPage: { pi: false },

  initSettings: async () => {
    if (get().isInitialized) return;

    set({ isLoading: true });
    try {
      const settings = await getSettings();
      set({
        sidebarHiddenByPage: normalizeSidebarHiddenByPage(settings.sidebar_hidden_by_page ?? {}),
        isInitialized: true,
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  setSidebarHidden: async (page, hidden) => {
    const currentVisibility = { ...get().sidebarHiddenByPage };
    const nextVisibility = { ...currentVisibility, [page]: hidden };

    set({ sidebarHiddenByPage: nextVisibility });
    try {
      await updateSettings({ sidebar_hidden_by_page: nextVisibility });
    } catch (error) {
      // Keep the UI consistent with persisted settings when the backend write
      // fails (for example while the database is being restored).
      set({ sidebarHiddenByPage: currentVisibility });
      throw error;
    }
  },
}));
