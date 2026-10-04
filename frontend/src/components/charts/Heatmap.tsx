import { Fragment } from 'react';
import { cn } from '../../utils/cn';

interface HeatmapProps {
  matrix: number[][];
  labels: string[];
  className?: string;
  height?: number;
}

export function Heatmap({ matrix, labels, className, height = 380 }: HeatmapProps) {
  const rows = labels.map((label, rowIndex) => {
    const values = matrix[rowIndex] || [];
    return { label, values, total: values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) };
  });

  return (
    <div className={cn('confusion-matrix-wrap', className)} style={{ minHeight: height }}>
      <div className="confusion-matrix" role="table" aria-label="Confusion matrix: actual classes by predicted classes" style={{ gridTemplateColumns: `minmax(112px, 1.1fr) repeat(${labels.length}, minmax(72px, 1fr))` }}>
        <div className="confusion-matrix-corner" role="columnheader">Actual / predicted</div>
        {labels.map((label) => <div className="confusion-matrix-heading" role="columnheader" key={`column-${label}`}>{label.replaceAll('_', ' ')}</div>)}
        {rows.map((row, rowIndex) => (
          <Fragment key={`row-${row.label}`}>
            <div className="confusion-matrix-row-label" role="rowheader">{row.label.replaceAll('_', ' ')}</div>
            {labels.map((predictedLabel, columnIndex) => {
              const count = Math.max(0, Number(row.values[columnIndex]) || 0);
              const share = row.total ? count / row.total : 0;
              const correct = rowIndex === columnIndex;
              const alpha = (0.07 + share * 0.2).toFixed(2);
              return (
                <div
                  className={`confusion-matrix-cell ${correct ? 'is-correct' : 'is-miss'}`}
                  key={`cell-${row.label}-${predictedLabel}`}
                  role="cell"
                  title={`Actual: ${row.label.replaceAll('_', ' ')} · Predicted: ${predictedLabel.replaceAll('_', ' ')} · ${count.toLocaleString()} transactions · ${(share * 100).toFixed(1)}% of this actual class`}
                  style={{ backgroundColor: correct ? `rgba(22, 163, 74, ${alpha})` : `rgba(220, 38, 38, ${alpha})` }}
                >
                  <strong>{count.toLocaleString()}</strong>
                  <small>{(share * 100).toFixed(1)}% of row</small>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="confusion-matrix-legend"><span><i className="matrix-legend-correct" />Correct classification</span><span><i className="matrix-legend-miss" />Misclassification</span></div>
    </div>
  );
}
