import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { cn } from '../../utils/cn';
import { chartTheme } from './chartTheme';

Chart.register(...registerables);

interface BarChartProps {
  data: { label: string; value: number }[];
  xKey: string;
  yKey: string;
  color?: string;
  className?: string;
  height?: number;
  indexAxis?: 'x' | 'y';
}

export function BarChart({ data, xKey, yKey, color = chartTheme.primary, className, height = 300, indexAxis = 'x' }: BarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'bar', number[], string> | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    chartRef.current = new Chart<'bar', number[], string>(context, {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Value', data: [], backgroundColor: color, borderRadius: 5, borderSkipped: false, maxBarThickness: 24 }] },
      options: {
        indexAxis,
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 360, easing: 'easeOutQuart' },
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...chartTheme.tooltip,
            borderWidth: 1,
            padding: 11,
            displayColors: false,
            cornerRadius: 9,
            callbacks: {
              label: (context) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format((indexAxis === 'y' ? context.parsed.x : context.parsed.y) ?? 0),
            },
          },
        },
        scales: {
          x: {
            grid: { display: indexAxis === 'y', color: chartTheme.grid },
            ticks: { color: chartTheme.muted, font: { size: 10, family: 'system-ui' }, maxRotation: 0, callback: (value) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value)) },
            border: { display: false },
            beginAtZero: indexAxis === 'y',
          },
          y: {
            grid: { display: indexAxis === 'x', color: chartTheme.grid },
            ticks: { color: chartTheme.muted, font: { size: 10, family: 'system-ui' }, maxRotation: 0, autoSkip: true },
            border: { display: false },
            beginAtZero: indexAxis === 'x',
            reverse: indexAxis === 'y',
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [indexAxis]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = data.map((row) => row.label);
    chart.data.datasets[0].data = data.map((row) => Number.isFinite(Number(row.value)) ? Number(row.value) : 0);
    chart.data.datasets[0].label = indexAxis === 'y' ? 'Value' : yKey;
    chart.data.datasets[0].backgroundColor = color;
    chart.update('none');
  }, [data, xKey, yKey, color, indexAxis]);

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={`${yKey} by ${xKey}`} />
    </div>
  );
}
