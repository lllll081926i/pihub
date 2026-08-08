import React from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '../stores/skillsStore';
import * as api from '../services/skillsApi';
import type { ManagedSkill } from '../types';

export function useSkills() {
  const store = useSkillsStore();
  const { t } = useTranslation();

  // Initialize on mount
  React.useEffect(() => {
    if (store.isModalOpen) {
      store.refresh();
    }
  }, [store.isModalOpen]);

  // Listen for skills-changed events from tray
  React.useEffect(() => {
    const unlisten = listen<string>('skills-changed', (event) => {
      if (event.payload === 'tray') {
        store.loadSkills();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [store.loadSkills]);

  // Format relative time
  const formatRelative = React.useCallback((ms: number | null | undefined) => {
    if (!ms) return '—';

    const now = Date.now();
    const diff = now - ms;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('sessionManager.justNow');
    if (minutes < 60) return t('sessionManager.minutesAgo', { count: minutes });
    if (hours < 24) return t('sessionManager.hoursAgo', { count: hours });
    return t('sessionManager.daysAgo', { count: days });
  }, [t]);

  // Get GitHub info from URL
  const getGithubInfo = React.useCallback((url: string | null | undefined) => {
    if (!url) return null;

    const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (match) {
      const [, owner, repo] = match;
      return {
        label: `${owner}/${repo}`,
        href: `https://github.com/${owner}/${repo}`,
      };
    }
    return null;
  }, []);

  // Update skill
  const updateSkill = React.useCallback(
    async (skill: ManagedSkill) => {
      try {
        await api.updateManagedSkill(skill.id);
        await store.loadSkills();
      } catch (error) {
        console.error('Failed to update skill:', error);
        throw error;
      }
    },
    [store]
  );

  // Delete skill
  const deleteSkill = React.useCallback(
    async (skillId: string) => {
      try {
        await api.deleteManagedSkill(skillId);
        await store.loadSkills();
      } catch (error) {
        console.error('Failed to delete skill:', error);
        throw error;
      }
    },
    [store]
  );

  return {
    ...store,
    formatRelative,
    getGithubInfo,
    updateSkill,
    deleteSkill,
  };
}
