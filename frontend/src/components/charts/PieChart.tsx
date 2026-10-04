import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { cn } from '../../utils/cn';
import { chartTheme } from './chartTheme';

Chart.register(...registerables);

interface PieChartProps {
  data: { label: string; value: number }[];
  colors?: string[];
  className?: string;
  height?: number;
  innerRadius?: number;
}

export function PieChart({ data, colors = [chartTheme.success, chartTheme.danger, chartTheme.primary, chartTheme.warning], className, height = 300, innerRadius = 0.5 }: PieChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: colors.slice(0, data.length),
          borderWidth: 0,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: innerRadius * 100 + '%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: chartTheme.muted,
              font: { size: 12, family: 'Inter' },
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            ...chartTheme.tooltip,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (context) => {
                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = ((context.raw as number) / total * 100).toFixed(1);
                return `${context.label}: ${context.raw} (${percentage}%)`;
              },
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [data, colors, innerRadius]);

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
