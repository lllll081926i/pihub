/**
 * Tree-shaken ECharts bundle for the token stats page.
 * Only imported through React.lazy, so it lands in its own chunk.
 */
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export default echarts;
export type { EChartsCoreOption } from 'echarts/core';
