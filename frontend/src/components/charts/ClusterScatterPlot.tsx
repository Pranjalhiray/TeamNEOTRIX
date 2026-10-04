import { useEffect, useMemo, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { Wallet } from '../../types';
import { cn } from '../../utils/cn';
import { chartTheme } from './chartTheme';

Chart.register(...registerables);

const palette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#64748b', '#0891b2', '#7c3aed', '#b45309'];

interface ClusterScatterPlotProps {
  data: Wallet[];
  selectedCluster?: number | null;
  height?: number;
  className?: string;
}

type ScatterPoint = { x: number; y: number; address: string; cluster?: number; entityType: string };

export function ClusterScatterPlot({ data, selectedCluster = null, height = 420, className }: ClusterScatterPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'scatter', ScatterPoint[], string> | null>(null);
  const datasets = useMemo(() => {
    const valid = data.filter((item) => Number.isFinite(item.pc1) && Number.isFinite(item.pc2) && (selectedCluster === null || item.predicted_entity_cluster === selectedCluster));
    const groups = [...new Set(valid.map((item) => item.entity_type || 'unknown'))].sort();
    return groups.map((group, index) => ({
      label: group,
      data: valid.filter((item) => (item.entity_type || 'unknown') === group).map((item) => ({
        x: Number(item.pc1), y: Number(item.pc2), address: item.address,
        cluster: item.predicted_entity_cluster, entityType: group,
      })),
      backgroundColor: palette[index % palette.length],
      borderColor: palette[index % palette.length],
      pointRadius: 3,
      pointHoverRadius: 6,
      pointHitRadius: 7,
    }));
  }, [data, selectedCluster]);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    chartRef.current = new Chart<'scatter', ScatterPoint[], string>(context, {
      type: 'scatter',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 280 },
        parsing: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: chartTheme.muted, usePointStyle: true, boxWidth: 7, padding: 16 } },
          tooltip: {
            ...chartTheme.tooltip, borderWidth: 1, padding: 11,
            callbacks: {
              label: (context) => {
                const point = context.raw as ScatterPoint;
                return `${point.entityType} · cluster ${point.cluster ?? 'unassigned'}`;
              },
              afterLabel: (context) => {
                const point = context.raw as ScatterPoint;
                return [`PC1 ${point.x.toFixed(3)} · PC2 ${point.y.toFixed(3)}`, point.address];
              },
            },
          },
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Principal component 1', color: chartTheme.muted }, grid: { color: chartTheme.grid }, ticks: { color: chartTheme.muted, maxTicksLimit: 8 }, border: { display: false } },
          y: { type: 'linear', title: { display: true, text: 'Principal component 2', color: chartTheme.muted }, grid: { color: chartTheme.grid }, ticks: { color: chartTheme.muted, maxTicksLimit: 8 }, border: { display: false } },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets = datasets as typeof chart.data.datasets;
    chart.update('none');
  }, [datasets]);

  return (
    <div className={cn('relative w-full', className)} style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label="Wallet embedding scatter plot, colored by entity type" />
      {datasets.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-muted)]">Embedding coordinates are not available.</div>}
    </div>
  );
}
