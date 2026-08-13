import React from 'react';
import echarts, { type EChartsCoreOption } from './echartsCore';
import { useThemeStore } from '@/stores/themeStore';

interface EChartProps {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
}

/**
 * Minimal ECharts React wrapper: init once, re-apply option on change,
 * auto-resize with the container, dispose on unmount. `resolvedTheme` is a
 * dependency of the option effect because option colors are theme-aware.
 */
const EChart: React.FC<EChartProps> = ({ option, height = 260, className }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<echarts.ECharts | null>(null);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const chart = echarts.init(container);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option, resolvedTheme]);

  return <div ref={containerRef} className={className} style={{ height, width: '100%' }} />;
};

export default EChart;
