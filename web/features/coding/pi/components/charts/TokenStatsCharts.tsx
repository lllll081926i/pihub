import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TokenDayBucket, TokenModelBucket } from '@/services/tokenStatsApi';
import { useThemeStore } from '@/stores/themeStore';
import { formatCompactNumber } from '../../utils/formatNumber';
import EChart from './EChart';
import { getChartPalette } from './chartPalette';
import type { EChartsCoreOption } from './echartsCore';

/** Charts honor the OS reduced-motion setting, same as CSS animations. */
const prefersReducedMotion =
  typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const dayTotal = (day: TokenDayBucket): number =>
  day.inputTokens + day.outputTokens + day.cacheWriteTokens + day.cacheReadTokens;

interface TrendChartProps {
  days: TokenDayBucket[];
}

/** 按日 token 总量趋势：渐变面积图 */
export const TrendChart: React.FC<TrendChartProps> = ({ days }) => {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const option = React.useMemo<EChartsCoreOption>(() => {
    const palette = getChartPalette(resolvedTheme);
    return {
      grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        textStyle: { color: palette.text, fontSize: 12 },
        valueFormatter: (value: unknown) =>
          typeof value === 'number' ? formatCompactNumber(value) : String(value ?? '-'),
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days.map((day) => day.date.slice(5)),
        axisLine: { lineStyle: { color: palette.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: palette.textTertiary, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: palette.splitLine } },
        axisLabel: {
          color: palette.textTertiary,
          fontSize: 10,
          formatter: (value: number) => formatCompactNumber(value),
        },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: days.map(dayTotal),
          lineStyle: { width: 2, color: palette.primary },
          itemStyle: { color: palette.primary },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(22, 119, 255, 0.28)' },
                { offset: 1, color: 'rgba(22, 119, 255, 0.02)' },
              ],
            },
          },
        },
      ],
      animationDuration: prefersReducedMotion ? 0 : 400,
      animationEasing: 'cubicOut',
    };
  }, [days, resolvedTheme]);

  return <EChart option={option} height={240} />;
};

interface ModelShareChartProps {
  models: TokenModelBucket[];
}

const MODEL_SHARE_TOP_N = 6;

/** 模型占比：Top N + 其他的环形图，中心显示总量 */
export const ModelShareChart: React.FC<ModelShareChartProps> = ({ models }) => {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const option = React.useMemo<EChartsCoreOption>(() => {
    const palette = getChartPalette(resolvedTheme);
    const totals = models.map((model) => ({
      name: model.model,
      value: model.inputTokens + model.outputTokens + model.cacheWriteTokens + model.cacheReadTokens,
    }));
    const top = totals.slice(0, MODEL_SHARE_TOP_N);
    const rest = totals.slice(MODEL_SHARE_TOP_N);
    const restValue = rest.reduce((sum, item) => sum + item.value, 0);
    const data = restValue > 0
      ? [...top, { name: t('tokenStats.otherModels'), value: restValue }]
      : top;
    const grandTotal = totals.reduce((sum, item) => sum + item.value, 0);

    return {
      color: palette.series,
      tooltip: {
        trigger: 'item',
        backgroundColor: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        textStyle: { color: palette.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const item = params as { name: string; value: number; percent: number };
          return `${item.name}<br/>${formatCompactNumber(item.value)} (${item.percent}%)`;
        },
      },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: palette.textTertiary, fontSize: 10 },
        type: 'scroll',
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 4, borderWidth: 0 },
          label: { show: false },
          emphasis: {
            scaleSize: 4,
            label: { show: false },
          },
          data,
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '36%',
          style: {
            text: formatCompactNumber(grandTotal),
            fill: palette.text,
            fontSize: 18,
            fontWeight: 600,
            textAlign: 'center',
          },
        },
        {
          type: 'text',
          left: 'center',
          top: '46%',
          style: {
            text: 'Tokens',
            fill: palette.textTertiary,
            fontSize: 10,
            textAlign: 'center',
          },
        },
      ],
      animationDuration: prefersReducedMotion ? 0 : 400,
    };
  }, [models, resolvedTheme, t]);

  return <EChart option={option} height={250} />;
};

interface DailyCompositionChartProps {
  days: TokenDayBucket[];
}

/** 每日构成：输入/输出/缓存读取/缓存写入堆叠柱图 */
export const DailyCompositionChart: React.FC<DailyCompositionChartProps> = ({ days }) => {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const option = React.useMemo<EChartsCoreOption>(() => {
    const palette = getChartPalette(resolvedTheme);
    const barSeries = (
      name: string,
      color: string,
      pick: (day: TokenDayBucket) => number,
    ) => ({
      name,
      type: 'bar' as const,
      stack: 'total',
      barMaxWidth: 18,
      itemStyle: { color },
      emphasis: { focus: 'series' as const },
      data: days.map(pick),
    });

    return {
      grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        textStyle: { color: palette.text, fontSize: 12 },
        valueFormatter: (value: unknown) =>
          typeof value === 'number' ? formatCompactNumber(value) : String(value ?? '-'),
      },
      legend: {
        top: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: palette.textTertiary, fontSize: 10 },
      },
      xAxis: {
        type: 'category',
        data: days.map((day) => day.date.slice(5)),
        axisLine: { lineStyle: { color: palette.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: palette.textTertiary, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: palette.splitLine } },
        axisLabel: {
          color: palette.textTertiary,
          fontSize: 10,
          formatter: (value: number) => formatCompactNumber(value),
        },
      },
      series: [
        barSeries(t('tokenStats.inputTokens'), palette.series[0], (day) => day.inputTokens),
        barSeries(t('tokenStats.outputTokens'), palette.series[1], (day) => day.outputTokens),
        barSeries(t('tokenStats.cacheReadLabel'), palette.series[2], (day) => day.cacheReadTokens),
        barSeries(t('tokenStats.cacheWriteLabel'), palette.series[3], (day) => day.cacheWriteTokens),
      ],
      animationDuration: prefersReducedMotion ? 0 : 400,
    };
  }, [days, resolvedTheme, t]);

  return <EChart option={option} height={250} />;
};
