import React, { lazy } from 'react';

const PiConfigPage = lazy(() => import('@/features/coding/pi/pages/PiConfigPage'));
const PiExtensionsPage = lazy(() => import('@/features/coding/pi/pages/PiExtensionsPage'));
const PiOtherPage = lazy(() => import('@/features/coding/pi/pages/PiOtherPage'));
const TokenStatsPage = lazy(() => import('@/features/coding/pi/pages/TokenStatsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const SkillsPage = lazy(() => import('@/features/coding/skills/pages/SkillsPage'));
const McpPage = lazy(() => import('@/features/coding/mcp/pages/McpPage'));
const PiSessionDetailPage = lazy(() => import('@/features/coding/shared/sessionManager/detail/SessionDetailPage').then((module) => ({
  default: module.PiSessionDetailPage,
})));

export interface RouteEntry {
  path: string;
  component: React.ComponentType;
  chrome?: RouteChromeConfig;
}

export type RouteChromeMode = 'default' | 'secondary';
export type RouteContentPadding = 'default' | 'compact' | 'none';

export interface RouteChromeConfig {
  mode?: RouteChromeMode;
  contentPadding?: RouteContentPadding;
}

/**
 * 统一路由配置，新增页面只需在此处添加一条记录。
 * routes.tsx 和 MainLayout 的 KeepAliveOutlet 共同消费此配置。
 */
export const PAGE_ROUTES: RouteEntry[] = [
  { path: '/coding/pi', component: PiConfigPage },
  { path: '/coding/pi/extensions', component: PiExtensionsPage },
  { path: '/coding/pi/other', component: PiOtherPage },
  {
    path: '/coding/pi/sessions/detail',
    component: PiSessionDetailPage,
    chrome: {
      mode: 'secondary',
      contentPadding: 'compact',
    },
  },
  { path: '/skills', component: SkillsPage },
  { path: '/mcp', component: McpPage },
  { path: '/token-stats', component: TokenStatsPage },
  { path: '/settings', component: SettingsPage },
];
