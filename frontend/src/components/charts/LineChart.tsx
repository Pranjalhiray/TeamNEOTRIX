import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { cn } from '../../utils/cn';
import { chartTheme } from './chartTheme';

Chart.register(...registerables);

interface LineChartDataPoint {
  x: number;
  y: number;
}

interface LineChartProps {
  datasets: {
    label: string;
    data: LineChartDataPoint[];
    borderColor: string;
    backgroundColor?: string;
    borderDash?: number[];
    borderWidth?: number;
  }[];
  className?: string;
  height?: number;
  xAxisTitle?: string;
  yAxisTitle?: string;
  showLegend?: boolean;
}

export function LineChart({ datasets, className, height = 350, xAxisTitle, yAxisTitle, showLegend = true }: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'line', LineChartDataPoint[], string> | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    chartRef.current = new Chart<'line', LineChartDataPoint[], string>(context, {
      type: 'line',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 360, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        elements: { line: { tension: 0.24 }, point: { radius: 0, hoverRadius: 4, hitRadius: 12 } },
        plugins: {
          legend: {
            display: showLegend,
            labels: { color: chartTheme.muted, font: { size: 11, family: 'system-ui' }, usePointStyle: true, pointStyle: 'circle', padding: 18 },
          },
          tooltip: {
            ...chartTheme.tooltip,
            borderWidth: 1,
            padding: 11,
            cornerRadius: 9,
            displayColors: true,
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: xAxisTitle ? { display: true, text: xAxisTitle, color: chartTheme.muted, font: { size: 11, family: 'system-ui' }, padding: { top: 10 } } : undefined,
            grid: { color: chartTheme.grid },
            ticks: { color: chartTheme.muted, font: { size: 10, family: 'system-ui' }, maxTicksLimit: 7 },
            border: { display: false },
            min: 0,
            max: 1,
          },
          y: {
            title: yAxisTitle ? { display: true, text: yAxisTitle, color: chartTheme.muted, font: { size: 11, family: 'system-ui' }, padding: { bottom: 10 } } : undefined,
            grid: { color: chartTheme.grid },
            ticks: { color: chartTheme.muted, font: { size: 10, family: 'system-ui' }, maxTicksLimit: 7 },
            border: { display: false },
            min: 0,
            max: 1,
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [xAxisTitle, yAxisTitle, showLegend]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets = datasets.map((dataset) => ({
      ...dataset,
      fill: false,
      tension: 0.24,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 12,
      borderWidth: dataset.borderWidth || 2.5,
    })) as typeof chart.data.datasets;
    chart.update('none');
  }, [datasets]);

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={`${yAxisTitle || 'Value'} over ${xAxisTitle || 'range'}`} />
    </div>
  );
}
