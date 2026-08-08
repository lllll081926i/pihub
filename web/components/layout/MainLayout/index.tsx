import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Dropdown, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { Sparkles, Puzzle, SlidersHorizontal, Settings, BarChart3, Monitor, Moon, Sun } from 'lucide-react';
import { MCP } from '@lobehub/icons';
import PiIcon from '@/assets/pi.svg';
import KeepAliveOutlet from '@/components/layout/KeepAliveOutlet';
import { useThemeStore, type ThemeMode } from '@/stores/themeStore';
import { PAGE_ROUTES } from '@/app/routeConfig';
import { getRouteChrome, matchRouteEntry } from '@/app/routeMatching';
import styles from './styles.module.less';

interface NavEntry {
  key: string;
  path: string;
  labelKey: string;
  icon: React.ReactNode;
}

const AppSidebar: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setMode } = useThemeStore();

  const entries: NavEntry[] = [
    {
      key: 'pi',
      path: '/coding/pi',
      labelKey: 'subModules.pi',
      icon: <img src={PiIcon} alt="Pi" className={styles.navIcon} />,
    },
    {
      key: 'extensions',
      path: '/coding/pi/extensions',
      labelKey: 'pi.extensions.title',
      icon: <Puzzle className={styles.navIcon} size={20} />,
    },
    {
      key: 'other',
      path: '/coding/pi/other',
      labelKey: 'pi.other.title',
      icon: <SlidersHorizontal className={styles.navIcon} size={20} />,
    },
    {
      key: 'skills',
      path: '/skills',
      labelKey: 'skills.tooltip',
      icon: <Sparkles className={styles.navIcon} size={20} />,
    },
    {
      key: 'mcp',
      path: '/mcp',
      labelKey: 'mcp.tooltip',
      icon: <MCP className={styles.navIcon} size={20} />,
    },
    {
      key: 'tokenStats',
      path: '/token-stats',
      labelKey: 'tokenStats.title',
      icon: <BarChart3 className={styles.navIcon} size={20} />,
    },
  ];

  const bottomEntries: NavEntry[] = [
    {
      key: 'settings',
      path: '/settings',
      labelKey: 'settings.title',
      icon: <Settings className={styles.navIcon} size={20} />,
    },
  ];

  const activeKey = React.useMemo(() => {
    const allEntries = [...entries, ...bottomEntries];
    // 先匹配更具体的子路径，再匹配父路径
    // 避免 /coding/pi/extensions 被 /coding/pi 抢先匹配
    for (const entry of allEntries) {
      if (entry.path !== '/coding/pi' && location.pathname.startsWith(entry.path)) {
        return entry.key;
      }
    }
    // 最后匹配 /coding/pi（仅当路径恰好是 /coding/pi 或 /coding/pi/ 时）
    if (location.pathname === '/coding/pi' || location.pathname === '/coding/pi/') {
      return 'pi';
    }
    return 'pi';
  }, [bottomEntries, entries, location.pathname]);

  const handleClick = (entry: NavEntry) => {
    navigate(entry.path);
  };

  const renderNavButton = (entry: NavEntry) => (
    <Tooltip key={entry.key} title={t(entry.labelKey)} placement="right">
      <button
        type="button"
        className={`${styles.navItem} ${activeKey === entry.key ? styles.navItemActive : ''}`}
        onClick={() => handleClick(entry)}
        aria-label={t(entry.labelKey)}
      >
        {entry.icon}
      </button>
    </Tooltip>
  );

  const themeIcon = mode === 'light' ? <Sun className={styles.navIcon} size={20} /> : mode === 'dark' ? <Moon className={styles.navIcon} size={20} /> : <Monitor className={styles.navIcon} size={20} />;
  const themeMenu = {
    selectedKeys: [mode],
    items: [
      { key: 'system', label: t('settings.themeSystem'), icon: <Monitor size={16} /> },
      { key: 'light', label: t('settings.themeLight'), icon: <Sun size={16} /> },
      { key: 'dark', label: t('settings.themeDark'), icon: <Moon size={16} /> },
    ],
    onClick: ({ key }: { key: string }) => void setMode(key as ThemeMode),
  };

  const themeButton = (
    <Tooltip key="theme" title={t('settings.categoryAppearance')} placement="right">
      <Dropdown menu={themeMenu} placement="bottom" trigger={['click']}>
        <button type="button" className={styles.navItem} aria-label={t('settings.categoryAppearance')}>
          {themeIcon}
        </button>
      </Dropdown>
    </Tooltip>
  );

  return (
    <nav className={styles.sidebar}>
      <div className={styles.sidebarTop}>
        {entries.slice(0, 3).map(renderNavButton)}
        <div className={styles.sidebarDivider} />
        {entries.slice(3).map(renderNavButton)}
      </div>
      <div className={styles.sidebarBottom}>
        {themeButton}
        {bottomEntries.map(renderNavButton)}
      </div>
    </nav>
  );
};

const MainLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = React.useRef<HTMLElement | null>(null);

  const currentRoute = React.useMemo(
    () => matchRouteEntry(PAGE_ROUTES, location.pathname),
    [location.pathname],
  );
  const routeChrome = React.useMemo(() => getRouteChrome(currentRoute), [currentRoute]);
  const isSecondary = routeChrome.mode === 'secondary';

  // Ensure a default landing page on first load: unknown/empty paths go to Pi.
  React.useEffect(() => {
    if (location.pathname === '/') {
      navigate('/coding/pi', { replace: true });
      return;
    }
    if (!matchRouteEntry(PAGE_ROUTES, location.pathname) && !isSecondary) {
      navigate('/coding/pi', { replace: true });
    }
  }, [isSecondary, location.pathname, navigate]);

  return (
    <div className={styles.layout}>
      <AppSidebar />
      <main ref={mainRef} className={styles.main}>
        <div className={[
          styles.contentArea,
          routeChrome.contentPadding === 'compact' ? styles.contentAreaCompact : '',
          routeChrome.contentPadding === 'none' ? styles.contentAreaNone : '',
          isSecondary ? styles.contentAreaSecondary : '',
        ].filter(Boolean).join(' ')}
        >
          <KeepAliveOutlet routes={PAGE_ROUTES} max={12} scrollContainerRef={mainRef} />
        </div>
      </main>
    </div>
  );
};

export default MainLayout;
