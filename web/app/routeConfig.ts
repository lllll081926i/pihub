import type { ComponentType } from 'react';
import { PiConfigPage, PiExtensionsPage, PiOtherPage, TokenStatsPage } from '@/features/coding';
import SettingsPage from '@/features/settings/SettingsPage';
import { SkillsPage } from '@/features/coding/skills';
import { McpPage } from '@/features/coding/mcp';
import {
  PiSessionDetailPage,
} from '@/features/coding/shared/sessionManager/detail/SessionDetailPage';

export interface RouteEntry {
  path: string;
  component: ComponentType;
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