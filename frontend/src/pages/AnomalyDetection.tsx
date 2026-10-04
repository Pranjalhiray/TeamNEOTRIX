import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { ScrollArea } from '../components/ui/ScrollArea';
import { PageHeading } from '../components/layout/PageHeading';
import { BarChart, LineChart } from '../components/charts';
import { chartTheme } from '../components/charts/chartTheme';
import { useSupervisedAnomalyMetrics } from '../hooks/usePerformance';
import { useAnomalyMetrics } from '../hooks/usePerformance';
import { Brain, Loader2, RefreshCw } from 'lucide-react';

export function AnomalyDetection() {
  const supervisedQuery = useSupervisedAnomalyMetrics();
  const anomalyQuery = useAnomalyMetrics();
  const supervisedMetrics = supervisedQuery.data;
  const anomalyMetrics = anomalyQuery.data;
  const [retrying, setRetrying] = useState(false);

  const metrics = supervisedMetrics || anomalyMetrics;

  const modelCards = [
    { name: 'XGBoost', roc: metrics?.xgb_roc_auc, pr: metrics?.xgb_pr_auc },
    { name: 'LightGBM', roc: metrics?.lgb_roc_auc, pr: metrics?.lgb_pr_auc },
    { name: 'RandomForest', roc: metrics?.rf_roc_auc, pr: metrics?.rf_pr_auc },
    { name: 'Ensemble (Mean)', roc: metrics?.ensemble_roc_auc, pr: metrics?.ensemble_pr_auc, highlighted: true },
    { name: 'Isolation Forest', roc: metrics?.iso_roc_auc, pr: metrics?.iso_pr_auc },
  ];

  if (!metrics) {
    if (supervisedQuery.isLoading || anomalyQuery.isLoading) {
      return <div className="space-y-6 animate-in"><PageHeading eyebrow="Model intelligence" title="Anomaly detection" description="Review the saved evaluation for the supervised XGBoost, LightGBM, and Random Forest ensemble." /><div className="model-loading-state"><Loader2 size={18} className="animate-spin" /><span>Loading saved model evaluation</span></div></div>;
    }
    const metricsError = supervisedQuery.error ?? anomalyQuery.error;
    return (
      <div className="space-y-6 animate-in">
        <PageHeading eyebrow="Model intelligence" title="Anomaly detection" description="Review the saved evaluation for the supervised XGBoost, LightGBM, and Random Forest ensemble." />
        <Card className="model-unavailable-card">
          <CardContent className="model-unavailable-content">
            <div className="model-unavailable-main">
              <div className="model-unavailable-icon"><Brain size={23} /></div>
              <div>
                <p className="eyebrow">Evaluation unavailable</p>
                <h2>Saved model metrics could not be loaded</h2>
                <p className="model-unavailable-description">{metricsError ? 'The local analysis service did not return the model evaluation.' : 'The model bundle does not include saved evaluation metrics yet.'} Check the local service or rebuild its model bundle, then retry.</p>
                {metricsError ? <div role="alert" className="model-error-detail"><span>Service response</span><code>{String(metricsError)}</code></div> : <pre className="model-error-detail"><span>Build evaluation artifacts</span><code>python src/build_artifacts.py</code></pre>}
                <Button variant="outline" disabled={retrying} onClick={async () => { setRetrying(true); try { await Promise.all([supervisedQuery.refetch(), anomalyQuery.refetch()]); } finally { setRetrying(false); } }} className="mt-4 gap-2">{retrying ? <><Loader2 size={15} className="animate-spin" /> Reconnecting…</> : <><RefreshCw size={15} /> Retry local metrics</>}</Button>
              </div>
            </div>
            <aside className="model-unavailable-aside"><span>LOCAL ANALYSIS</span><strong>Private by design</strong><p>Evaluation results are loaded from the analysis service running on this device.</p></aside>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <PageHeading eyebrow="Model intelligence" title="Anomaly detection" description="Review the saved evaluation for the supervised XGBoost, LightGBM, and Random Forest ensemble." />

      <div className="grid gap-4 grid-dashboard">
        {modelCards.map((model, index) => (
          <Card 
            key={model.name} 
            className={`metric-card-accent hover-lift ${model.highlighted ? 'border-t-3 border-[var(--color-accent)]' : ''} stagger-${index + 1}`}
          >
            <CardContent className="pt-6">
              <p className="text-label-md text-[var(--color-text-muted)] mb-2">{model.name}</p>
              <p className="text-display-sm font-bold text-[var(--color-text-primary)]">{model.roc?.toFixed(3) || '—'}</p>
              <p className="text-body-sm text-[var(--color-text-muted)] mt-1">ROC-AUC / PR-AUC: {model.pr?.toFixed(3) || '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="card-hover">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">ROC Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              datasets={[
                {
                  label: `Ensemble (AUC=${supervisedMetrics?.ensemble_roc_auc?.toFixed(3) || '—'})`,
                  data: supervisedMetrics?.ensemble_roc_curve?.[0]?.map((x: number, i: number) => ({ x, y: supervisedMetrics.ensemble_roc_curve?.[1]?.[i] })) || [],
                  borderColor: chartTheme.primary,
                  borderWidth: 3,
                },
                {
                  label: 'Random',
                  data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
                  borderColor: '#9ca3af',
                  borderDash: [5, 5],
                  borderWidth: 1,
                },
              ]}
              height={380}
              xAxisTitle="False Positive Rate"
              yAxisTitle="True Positive Rate"
            />
          </CardContent>
        </Card>

        <Card className="card-hover">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Precision-Recall Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              datasets={[
                {
                  label: `Ensemble (AP=${supervisedMetrics?.ensemble_pr_auc?.toFixed(3) || '—'})`,
                  data: supervisedMetrics?.ensemble_pr_curve?.[1]?.map((y: number, i: number) => ({ x: supervisedMetrics.ensemble_pr_curve?.[0]?.[i], y })) || [],
                  borderColor: '#0f766e',
                  borderWidth: 3,
                },
              ]}
              height={380}
              xAxisTitle="Recall"
              yAxisTitle="Precision"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="card-hover">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Precision @ K</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.precision_at_k && metrics.precision_at_k.length > 0 && (
              <ScrollArea className="h-[280px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Top K</TableHead>
                      <TableHead>Precision</TableHead>
                      <TableHead>Recall</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.precision_at_k.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>Top {row.k}</TableCell>
                        <TableCell className="font-medium text-[var(--color-accent)]">{(row.precision * 100).toFixed(1)}%</TableCell>
                        <TableCell>{(row.recall * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="card-hover">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Threshold Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.threshold_analysis && metrics.threshold_analysis.length > 0 && (
              <ScrollArea className="h-[220px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Threshold (Percentile)</TableHead>
                      <TableHead>Flagged Transactions</TableHead>
                      <TableHead>Precision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.threshold_analysis.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.threshold.toFixed(4)}</TableCell>
                        <TableCell>{row.flagged.toLocaleString()}</TableCell>
                        <TableCell className="font-medium text-[var(--color-accent)]">{(row.precision * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm">XGBoost Feature Importance (Top 25)</CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.feature_importance && Object.keys(metrics.feature_importance).length > 0 && (
            <BarChart
              data={Object.entries(metrics.feature_importance)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 25)
                .map(([feature, importance]) => ({ label: feature, value: importance }))}
              xKey="value"
              yKey="label"
              color={chartTheme.primary}
              height={480}
              indexAxis="y"
            />
          )}
        </CardContent>
      </Card>

    </div>
  );
}
