import React from 'react';
import { Card, Segmented, Typography } from 'antd';
import EmptyState from '@/components/common/EmptyState';
import Skeleton from '@/components/common/Skeleton';
import {
  DollarOutlined,
  FireOutlined,
  MessageOutlined,
  PieChartOutlined,
  RiseOutlined,
  SaveOutlined,
  BarChartOutlined,
  RobotOutlined,
  CalendarOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { getTokenStats, refreshTokenStats, type TokenStatsResult } from '@/services/tokenStatsApi';
import { useCountUp } from '@/hooks/useCountUp';
import styles from './TokenStatsPage.module.less';

const { Title, Text } = Typography;

/**
 * Module-level cache so switching away from the token stats page and back
 * renders instantly; SQLite cache covers app restarts. A silent background
 * rescan then refreshes the view when fresh data arrives.
 */
let TOKEN_STATS_CACHE: TokenStatsResult | null = null;

const formatNumber = (value: number): string => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
};

const formatCost = (value: number): string => `$${value.toFixed(4)}`;

interface KpiItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Numeric value; when provided the displayed number counts up on mount/change. */
  count?: number;
  /** Formatter for the animated count (defaults to `formatNumber`). */
  formatter?: (value: number) => string;
  hint?: string;
  accent?: string;
}

const KpiItem: React.FC<KpiItemProps> = ({ icon, label, value, count, formatter, hint, accent }) => {
  const animatedCount = useCountUp(count ?? 0, 550);
  const displayValue = count !== undefined ? (formatter ?? formatNumber)(animatedCount) : value;
  return (
    <div className={styles.kpiItem}>
      <span className={styles.kpiIcon} style={{ color: accent }}>{icon}</span>
      <div className={styles.kpiBody}>
        <Text className={styles.kpiLabel}>{label}</Text>
        <Text className={styles.kpiValue}>{displayValue}</Text>
        {hint && <Text className={styles.kpiHint}>{hint}</Text>}
      </div>
    </div>
  );
};

interface SubKpiItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Numeric value; when provided the displayed number counts up on mount/change. */
  count?: number;
  /** Formatter for the animated count (defaults to `formatNumber`). */
  formatter?: (value: number) => string;
  hint?: string;
  accent?: string;
}

const SubKpiItem: React.FC<SubKpiItemProps> = ({ icon, label, value, count, formatter, hint, accent }) => {
  const animatedCount = useCountUp(count ?? 0, 550);
  const displayValue = count !== undefined ? (formatter ?? formatNumber)(animatedCount) : value;
  return (
    <div className={styles.subKpiItem}>
      <span className={styles.subKpiIcon} style={{ color: accent }}>{icon}</span>
      <div className={styles.subKpiBody}>
        <Text className={styles.subKpiLabel}>{label}</Text>
        <Text className={styles.subKpiValue}>{displayValue}</Text>
        {hint && <Text className={styles.subKpiHint}>{hint}</Text>}
      </div>
    </div>
  );
};

type DetailTab = 'models' | 'heatmap' | 'daily';
type DetailRange = '7' | '30' | '90' | 'all';

const TokenStatsPage: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = React.useState<TokenStatsResult | null>(TOKEN_STATS_CACHE);
  const [loading, setLoading] = React.useState(!TOKEN_STATS_CACHE);
  const [refreshing, setRefreshing] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<DetailTab>('models');
  const [detailRange, setDetailRange] = React.useState<DetailRange>('30');

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // 1) SQLite cache — fast path, shows the last computed stats
        const cached = await getTokenStats();
        if (cancelled) return;
        setData(cached);
        TOKEN_STATS_CACHE = cached;
        setLoading(false);
      } catch (error) {
        console.error('Failed to load token stats:', error);
        if (!cancelled) setLoading(false);
      }
      // 2) Silent background rescan — session files can be large, so this
      //    runs after the cached view is already on screen.
      setRefreshing(true);
      try {
        const fresh = await refreshTokenStats();
        if (cancelled) return;
        setData(fresh);
        TOKEN_STATS_CACHE = fresh;
      } catch (error) {
        console.error('Failed to refresh token stats:', error);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const totalTokens = (data?.totalInputTokens ?? 0)
    + (data?.totalOutputTokens ?? 0)
    + (data?.totalCacheWriteTokens ?? 0)
    + (data?.totalCacheReadTokens ?? 0);

  const maxDayTokens = React.useMemo(() => {
    if (!data?.days.length) return 1;
    return Math.max(...data.days.map(d => d.inputTokens + d.outputTokens + d.cacheWriteTokens + d.cacheReadTokens), 1);
  }, [data]);

  const sortedModels = React.useMemo(() => {
    if (!data?.models.length) return [];
    return [...data.models].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
  }, [data]);

  const tabOptions = [
    { label: t('tokenStats.modelRanking'), value: 'models', icon: <RobotOutlined /> },
    { label: t('tokenStats.heatmap'), value: 'heatmap', icon: <CalendarOutlined /> },
    { label: t('tokenStats.dailyBreakdown'), value: 'daily', icon: <TableOutlined /> },
  ];

  // Detail views (heatmap/daily) honor the selected time range; KPI cards and
  // the model ranking stay as the all-time overview because the backend only
  // aggregates per-model totals globally.
  const visibleDays = React.useMemo(() => {
    if (!data?.days.length || detailRange === 'all') {
      return data?.days ?? [];
    }
    return data.days.slice(-Number(detailRange));
  }, [data, detailRange]);

  const rangeOptions = [
    { label: t('tokenStats.range7'), value: '7' },
    { label: t('tokenStats.range30'), value: '30' },
    { label: t('tokenStats.range90'), value: '90' },
    { label: t('tokenStats.rangeAll'), value: 'all' },
  ];

  const renderModelsTab = () => {
    if (sortedModels.length === 0) {
      return <EmptyState title={t('tokenStats.empty')} compact />;
    }
    const maxModelTokens = Math.max(
      ...sortedModels.map((m) => m.inputTokens + m.outputTokens),
      1,
    );
    return (
      <div className={styles.tableContainer}>
        <div className={styles.tableHeader}>
          <span>{t('tokenStats.model')}</span>
          <span>{t('tokenStats.inputTokens')}</span>
          <span>{t('tokenStats.outputTokens')}</span>
          <span>{t('tokenStats.cacheTokens')}</span>
          <span>{t('tokenStats.cost')}</span>
          <span>{t('tokenStats.messages')}</span>
        </div>
        {sortedModels.map((m) => {
          const ratio = (m.inputTokens + m.outputTokens) / maxModelTokens;
          return (
            <div
              key={m.model}
              className={styles.tableRow}
              style={{
                backgroundImage: `linear-gradient(to right, var(--ant-color-primary-bg) ${(ratio * 100).toFixed(1)}%, transparent ${(ratio * 100).toFixed(1)}%)`,
              }}
            >
              <span className={styles.modelName}>{m.model}</span>
              <span>{formatNumber(m.inputTokens)}</span>
              <span>{formatNumber(m.outputTokens)}</span>
              <span>{formatNumber(m.cacheWriteTokens + m.cacheReadTokens)}</span>
              <span>{formatCost(m.costUsd)}</span>
              <span>{m.messageCount}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderHeatmapTab = () => {
    if (!data || data.days.length === 0) {
      return <EmptyState title={t('tokenStats.empty')} compact />;
    }
    return (
      <>
        <div className={styles.heatmapGrid}>
          {visibleDays.slice(-21).map((day) => {
            const dayTokens = day.inputTokens + day.outputTokens + day.cacheWriteTokens + day.cacheReadTokens;
            const intensity = dayTokens / maxDayTokens;
            const alpha = 0.12 + intensity * 0.88;
            return (
              <div key={day.date} className={styles.heatmapCell}
                title={`${day.date}: ${formatNumber(dayTokens)} tokens`}
                style={{ backgroundColor: `color-mix(in srgb, var(--ant-color-primary) ${Math.round(alpha * 100)}%, transparent)` }}>
                <span className={styles.heatmapDate}>{day.date.slice(5)}</span>
                <span className={styles.heatmapValue}>{formatNumber(dayTokens)}</span>
              </div>
            );
          })}
        </div>
        <div className={styles.heatmapLegend}>
          <Text className={styles.legendText}>{t('tokenStats.recentDays', { count: visibleDays.slice(-21).length })}</Text>
        </div>
      </>
    );
  };

  const renderDailyTab = () => {
    if (!data || visibleDays.length === 0) {
      return <EmptyState title={t('tokenStats.empty')} compact />;
    }
    return (
      <div className={styles.tableContainer}>
        <div className={styles.tableHeader}>
          <span>{t('tokenStats.date')}</span>
          <span>{t('tokenStats.inputTokens')}</span>
          <span>{t('tokenStats.outputTokens')}</span>
          <span>{t('tokenStats.cacheTokens')}</span>
          <span>{t('tokenStats.cost')}</span>
          <span>{t('tokenStats.messages')}</span>
        </div>
        {[...visibleDays].reverse().slice(0, 60).map((day) => {
          const dayTokens = day.inputTokens + day.outputTokens + day.cacheWriteTokens + day.cacheReadTokens;
          const ratio = dayTokens / maxDayTokens;
          return (
            <div
              key={day.date}
              className={styles.tableRow}
              style={{
                backgroundImage: `linear-gradient(to right, var(--ant-color-primary-bg) ${(ratio * 100).toFixed(1)}%, transparent ${(ratio * 100).toFixed(1)}%)`,
              }}
            >
              <span>{day.date}</span>
              <span>{formatNumber(day.inputTokens)}</span>
              <span>{formatNumber(day.outputTokens)}</span>
              <span>{formatNumber(day.cacheWriteTokens + day.cacheReadTokens)}</span>
              <span>{formatCost(day.costUsd)}</span>
              <span>{day.messageCount}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Title level={4} className={styles.title}>{t('tokenStats.title')}</Title>
        {refreshing && (
          <Text className={styles.refreshingHint}>{t('tokenStats.refreshing')}</Text>
        )}
      </div>

      {loading ? (
        <div className={styles.content}>
          <Skeleton type="kpi" kpiCount={4} gridColumns={4} />
          <Skeleton type="kpi" kpiCount={3} gridColumns={3} />
          <Skeleton type="chart" />
        </div>
      ) : data ? (
        <div className={styles.content}>
          {/* 统计概览：主 KPI + 次级指标统一在一个卡片内 */}
          <Card className={styles.kpiCard} size="small">
            <div className={styles.kpiGrid}>
              <KpiItem
                icon={<PieChartOutlined />}
                label={t('tokenStats.totalTokens')}
                value={formatNumber(totalTokens)}
                count={totalTokens}
                accent="var(--ant-color-primary)"
              />
              <KpiItem
                icon={<RiseOutlined />}
                label={t('tokenStats.totalCost')}
                value={formatCost(data.totalCostUsd)}
                count={data.totalCostUsd}
                formatter={formatCost}
                accent="var(--ant-color-success)"
              />
              <KpiItem
                icon={<FireOutlined />}
                label={t('tokenStats.totalOutput')}
                value={formatNumber(data.totalOutputTokens)}
                count={data.totalOutputTokens}
                hint={t('tokenStats.inputHint', { count: data.totalInputTokens })}
                accent="var(--ant-color-warning)"
              />
              <KpiItem
                icon={<MessageOutlined />}
                label={t('tokenStats.sessions')}
                value={String(data.sessionCount)}
                count={data.sessionCount}
                hint={t('tokenStats.messagesHint', { count: data.totalMessages })}
                accent="var(--ant-color-info)"
              />
            </div>
            <div className={styles.kpiDivider} />
            <div className={styles.subKpiGrid}>
              <SubKpiItem
                icon={<BarChartOutlined />}
                label={t('tokenStats.avgPerSession')}
                value={formatNumber(data.avgTokensPerSession)}
                count={data.avgTokensPerSession}
                hint={formatCost(data.avgCostPerSession)}
                accent="var(--ant-color-primary)"
              />
              <SubKpiItem
                icon={<SaveOutlined />}
                label={t('tokenStats.cacheSaving')}
                value={formatCost(data.cacheSavingsUsd)}
                hint={`${t('tokenStats.cacheTokens')}: ${formatNumber(data.totalCacheReadTokens)}`}
                accent="var(--ant-color-success)"
              />
              <SubKpiItem
                icon={<DollarOutlined />}
                label={t('tokenStats.cacheWriteLabel')}
                value={formatNumber(data.totalCacheWriteTokens)}
                count={data.totalCacheWriteTokens}
                hint={`${t('tokenStats.cacheReadLabel')}: ${formatNumber(data.totalCacheReadTokens)}`}
                accent="var(--ant-color-warning)"
              />
            </div>
          </Card>

          {/* 详细数据 Tab 切换 */}
          <Card className={styles.detailCard} size="small">
            <div className={styles.detailHeader}>
              <Segmented
                options={tabOptions}
                value={activeTab}
                onChange={(value) => setActiveTab(value as DetailTab)}
              />
              <Segmented
                className={styles.rangeSegmented}
                options={rangeOptions}
                value={detailRange}
                onChange={(value) => setDetailRange(value as DetailRange)}
              />
            </div>
            <div className={styles.detailContent}>
              {activeTab === 'models' && renderModelsTab()}
              {activeTab === 'heatmap' && renderHeatmapTab()}
              {activeTab === 'daily' && renderDailyTab()}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default TokenStatsPage;
