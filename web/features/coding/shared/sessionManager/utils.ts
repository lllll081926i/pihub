import type { TFunction } from 'i18next';

import type {
  SessionMeta,
  SessionSourceMode,
  SessionSourceOption,
} from './types';

export function advanceVisibleContextId(
  currentVisibleContextId: number,
  wasActive: boolean,
  isActive: boolean,
): number {
  return wasActive && !isActive ? currentVisibleContextId + 1 : currentVisibleContextId;
}

export function shouldShowVisibleFeedback(
  isPageActive: boolean,
  requestVisibleContextId: number | undefined,
  currentVisibleContextId: number,
): boolean {
  if (!isPageActive) {
    return false;
  }

  if (requestVisibleContextId === undefined) {
    return true;
  }

  return requestVisibleContextId === currentVisibleContextId;
}

export function resolveEffectiveSessionSourceMode(
  sourceMode: SessionSourceMode,
  availableSources: SessionSourceOption[],
): SessionSourceMode {
  const hasLocalSource = availableSources.some((item) => item.source === 'local');
  const hasWslSource = availableSources.some((item) => item.source === 'wsl');
  return hasLocalSource && hasWslSource ? sourceMode : 'all';
}

export function formatSessionTitle(session: SessionMeta): string {
  if (session.title?.trim()) {
    return session.title.trim();
  }

  if (session.projectDir?.trim()) {
    const normalized = session.projectDir.replace(/[\\/]+$/, '');
    const basename = normalized.split(/[\\/]/).pop();
    if (basename?.trim()) {
      return basename.trim();
    }
  }

  return shortSessionId(session.sessionId);
}

export function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`;
}

export function formatTimestamp(timestamp?: number): string {
  if (!timestamp) {
    return '';
  }

  return new Date(timestamp).toLocaleString();
}

export function formatRelativeTime(timestamp: number | undefined, t: TFunction): string {
  if (!timestamp) {
    return t('common.notSet');
  }

  const date = new Date(timestamp);
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) {
    return t('sessionManager.justNow');
  }
  if (diffMinutes < 60) {
    return t('sessionManager.minutesAgo', { count: diffMinutes });
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return t('sessionManager.hoursAgo', { count: diffHours });
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 7) {
    return date.toLocaleString();
  }
  return t('sessionManager.daysAgo', { count: diffDays });
}

export function getRoleLabel(role: string, t: TFunction): string {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === 'user') {
    return t('sessionManager.roles.user');
  }
  if (normalizedRole === 'assistant') {
    return t('sessionManager.roles.assistant');
  }
  if (normalizedRole === 'tool') {
    return t('sessionManager.roles.tool');
  }
  if (normalizedRole === 'system') {
    return t('sessionManager.roles.system');
  }
  return role;
}
