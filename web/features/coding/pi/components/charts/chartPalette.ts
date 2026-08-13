/**
 * Theme-aware chart palette. Colors mirror web/App.css design tokens so
 * charts blend into both light and dark surfaces.
 */
export interface ChartPalette {
  text: string;
  textTertiary: string;
  axisLine: string;
  splitLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  primary: string;
  series: string[];
}

export const getChartPalette = (theme: 'light' | 'dark'): ChartPalette => {
  const dark = theme === 'dark';
  return {
    text: dark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)',
    textTertiary: dark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.45)',
    axisLine: dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.15)',
    splitLine: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
    tooltipBg: dark ? '#1e242c' : '#ffffff',
    tooltipBorder: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
    primary: '#1677ff',
    series: ['#1677ff', '#36cfc9', '#73d13d', '#ffc53d', '#9254de', '#f759ab', '#40a9ff'],
  };
};
