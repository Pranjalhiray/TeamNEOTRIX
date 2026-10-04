import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { cn } from '../../utils/cn';
import { chartTheme } from './chartTheme';

Chart.register(...registerables);

export interface RiskDistributionBin {
  bin: string;
  licit: number;
  illicit: number;
}

interface RiskDistributionChartProps {
  data: RiskDistributionBin[];
  className?: string;
  height?: number;
}

export function RiskDistributionChart({ data, className, height = 250 }: RiskDistributionChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'bar', number[], string> | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    chartRef.current = new Chart<'bar', number[], string>(context, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          { label: 'Licit / unknown', data: [], backgroundColor: chartTheme.success, borderRadius: 4, borderSkipped: false, maxBarThickness: 20 },
          { label: 'Illicit ground truth', data: [], backgroundColor: chartTheme.danger, borderRadius: 4, borderSkipped: false, maxBarThickness: 20 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 360, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: chartTheme.muted, font: { size: 10, family: 'system-ui' }, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
          tooltip: { ...chartTheme.tooltip, borderWidth: 1, padding: 10, cornerRadius: 9 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: chartTheme.muted, font: { size: 9, family: 'system-ui' }, maxRotation: 0, maxTicksLimit: 10 }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: chartTheme.grid }, ticks: { color: chartTheme.muted, font: { size: 9, family: 'system-ui' }, callback: (value) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value)) }, border: { display: false } },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = data.map((row) => row.bin);
    chart.data.datasets[0].data = data.map((row) => row.licit);
    chart.data.datasets[1].data = data.map((row) => row.illicit);
    chart.update('none');
  }, [data]);

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label="Transaction risk score distribution by synthetic ground truth" />
    </div>
  );
}
