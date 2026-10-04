import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { ScrollArea } from '../components/ui/ScrollArea';
import { PageHeading } from '../components/layout/PageHeading';
import { BarChart, LineChart, Heatmap, RiskDistributionChart } from '../components/charts';
import { chartTheme } from '../components/charts/chartTheme';
import {
  useAnomalyMetrics,
  useSupervisedAnomalyMetrics,
  usePatternMetrics,
  useRiskMetrics,
  useEnsembleAUC,
  useRiskDistribution,
  useSHAPGlobal,
} from '../hooks/usePerformance';
import { Award, Brain, Network, Zap, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

export function Performance() {
  const anomalyQuery = useAnomalyMetrics();
  const supervisedQuery = useSupervisedAnomalyMetrics();
  const patternQuery = usePatternMetrics();
  const riskQuery = useRiskMetrics();
  const ensembleQuery = useEnsembleAUC();
  const distributionQuery = useRiskDistribution();
  const shapQuery = useSHAPGlobal();
  const performanceQueries = [anomalyQuery, supervisedQuery, patternQuery, riskQuery, ensembleQuery, distributionQuery, shapQuery];
  const [retrying, setRetrying] = useState(false);
  const anomalyMetrics = anomalyQuery.data;
  const supervisedAnomalyMetrics = supervisedQuery.data;
  const patternMetrics = patternQuery.data;
  const riskMetrics = riskQuery.data;
  const ensembleAUC = ensembleQuery.data;
  const riskDistribution = distributionQuery.data;
  const shapGlobal = shapQuery.data;

  const isSupervised = !!supervisedAnomalyMetrics;

  const rocAuc = isSupervised ? supervisedAnomalyMetrics?.ensemble_roc_auc : anomalyMetrics?.roc_auc;
  const prAuc = isSupervised ? supervisedAnomalyMetrics?.ensemble_pr_auc : anomalyMetrics?.pr_auc;
  const xgbRocAuc = supervisedAnomalyMetrics?.xgb_roc_auc;
  const xgbPrAuc = supervisedAnomalyMetrics?.xgb_pr_auc;
  const lgbRocAuc = supervisedAnomalyMetrics?.lgb_roc_auc;
  const lgbPrAuc = supervisedAnomalyMetrics?.lgb_pr_auc;
  const rfRocAuc = supervisedAnomalyMetrics?.rf_roc_auc;
  const rfPrAuc = supervisedAnomalyMetrics?.rf_pr_auc;
  const isoRocAuc = isSupervised ? supervisedAnomalyMetrics?.iso_roc_auc : anomalyMetrics?.roc_auc;
  const isoPrAuc = isSupervised ? supervisedAnomalyMetrics?.iso_pr_auc : anomalyMetrics?.pr_auc;
  const precisionAtK = isSupervised ? supervisedAnomalyMetrics?.precision_at_k : undefined;
  const thresholdAnalysis = isSupervised ? supervisedAnomalyMetrics?.threshold_analysis : undefined;
  const featureImportance = isSupervised ? supervisedAnomalyMetrics?.feature_importance : undefined;

  const modelCards = [
    { name: 'XGBoost', roc: xgbRocAuc, pr: xgbPrAuc },
    { name: 'LightGBM', roc: lgbRocAuc, pr: lgbPrAuc },
    { name: 'RandomForest', roc: rfRocAuc, pr: rfPrAuc },
    { name: 'Ensemble (Mean)', roc: rocAuc, pr: prAuc, highlighted: true },
    { name: 'Isolation Forest', roc: isoRocAuc, pr: isoPrAuc },
  ];

  const hasAnyEvaluation = Boolean(anomalyMetrics || supervisedAnomalyMetrics || patternMetrics || riskMetrics || ensembleAUC || riskDistribution?.length || shapGlobal?.length);
  const metricError = performanceQueries.find((query) => query.error)?.error;
  if (!hasAnyEvaluation && performanceQueries.some((query) => query.isLoading)) {
    return <div className="space-y-6 animate-in"><PageHeading eyebrow="Model governance" title="Performance & explainability" description="Inspect model quality, calibration, risk propagation, and the features that drive ranked results." /><div className="model-loading-state"><Loader2 size={18} className="animate-spin" /><span>Loading saved evaluation metrics</span></div></div>;
  }
  if (!hasAnyEvaluation) {
    return <div className="space-y-6 animate-in">
      <PageHeading eyebrow="Model governance" title="Performance & explainability" description="Inspect model quality, calibration, risk propagation, and the features that drive ranked results." />
      <Card className="model-unavailable-card"><CardContent className="model-unavailable-content">
        <div className="model-unavailable-main"><div className="model-unavailable-icon"><ShieldAlert size={23} /></div><div>
          <p className="eyebrow">Evaluation unavailable</p><h2>Model performance data could not be loaded</h2>
          <p className="model-unavailable-description">Reconnect to the local analysis service to load saved model scores, validation curves, and explainability results.</p>
          {metricError && <div role="alert" className="model-error-detail"><span>Service response</span><code>{metricError instanceof Error ? metricError.message : String(metricError)}</code></div>}
          <Button variant="outline" disabled={retrying} onClick={async () => { setRetrying(true); try { await Promise.all(performanceQueries.map((query) => query.refetch())); } finally { setRetrying(false); } }} className="mt-4 gap-2">{retrying ? <><Loader2 size={15} className="animate-spin" /> Reconnecting…</> : <><RefreshCw size={15} /> Retry model metrics</>}</Button>
        </div></div>
        <aside className="model-unavailable-aside"><span>LOCAL ANALYSIS</span><strong>Private by design</strong><p>Saved evaluations are read from the analysis service running on this device.</p></aside>
      </CardContent></Card>
    </div>;
  }

  return (
    <div className="space-y-6 animate-in">
      <PageHeading eyebrow="Model governance" title="Performance & explainability" description="Inspect model quality, calibration, risk propagation, and the features that drive ranked results." />

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)] flex items-center justify-between">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Award className="h-5 w-5" />
            Ensemble (Fused) Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-4 p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-accent)] transition-colors">
              <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                <span className="text-xl font-bold text-[var(--color-accent)]">AUC</span>
              </div>
              <div>
                <p className="text-display-sm font-bold text-[var(--color-text-primary)]">{ensembleAUC?.ensemble_auc?.toFixed(3) || '—'}</p>
                <p className="text-body-sm text-[var(--color-text-muted)]">ROC-AUC vs ground-truth is_illicit</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-accent)] transition-colors">
              <div className="w-14 h-14 rounded-xl bg-[var(--color-risk-low-subtle)] flex items-center justify-center">
                <span className="text-xl font-bold text-[var(--color-risk-low)]">PR</span>
              </div>
              <div>
                <p className="text-display-sm font-bold text-[var(--color-text-primary)]">{prAuc?.toFixed(3) || '—'}</p>
                <p className="text-body-sm text-[var(--color-text-muted)]">PR-AUC (Average Precision)</p>
              </div>
            </div>
            {riskDistribution && riskDistribution.length > 0 && (
              <div className="md:col-span-3">
                <RiskDistributionChart data={riskDistribution} height={230} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Anomaly Detector - Supervised Ensemble (XGBoost + LightGBM + RandomForest)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {(isSupervised || anomalyMetrics) && (
            <>
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
                          label: isSupervised
                            ? `Ensemble ROC (AUC=${supervisedAnomalyMetrics?.ensemble_roc_auc?.toFixed(3) || '—'})`
                            : `ROC (AUC=${anomalyMetrics?.roc_auc?.toFixed(3) || '—'})`,
                          data: isSupervised
                            ? supervisedAnomalyMetrics?.ensemble_roc_curve?.[0]?.map((x: number, i: number) => ({ x, y: supervisedAnomalyMetrics.ensemble_roc_curve?.[1]?.[i] })) || []
                            : anomalyMetrics?.roc_curve?.[0]?.map((x: number, i: number) => ({ x, y: anomalyMetrics.roc_curve?.[1]?.[i] })) || [],
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
                          label: isSupervised
                            ? `Ensemble PR (AP=${supervisedAnomalyMetrics?.ensemble_pr_auc?.toFixed(3) || '—'})`
                            : `PR (AP=${anomalyMetrics?.pr_auc?.toFixed(3) || '—'})`,
                          data: isSupervised
                            ? supervisedAnomalyMetrics?.ensemble_pr_curve?.[1]?.map((y: number, i: number) => ({ x: supervisedAnomalyMetrics.ensemble_pr_curve?.[0]?.[i], y })) || []
                            : anomalyMetrics?.pr_curve?.[1]?.map((y: number, i: number) => ({ x: anomalyMetrics.pr_curve?.[0]?.[i], y })) || [],
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

              {precisionAtK && precisionAtK.length > 0 && (
                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm">Precision @ K</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[220px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Top K</TableHead>
                            <TableHead>Precision</TableHead>
                            <TableHead>Recall</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {precisionAtK.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell>Top {row.k}</TableCell>
                              <TableCell className="font-medium text-[var(--color-accent)]">{(row.precision * 100).toFixed(1)}%</TableCell>
                              <TableCell>{(row.recall * 100).toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {thresholdAnalysis && thresholdAnalysis.length > 0 && (
                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm">Threshold Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[180px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Threshold (Percentile)</TableHead>
                            <TableHead>Flagged Transactions</TableHead>
                            <TableHead>Precision</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {thresholdAnalysis.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell>{row.threshold.toFixed(4)}</TableCell>
                              <TableCell>{row.flagged.toLocaleString()}</TableCell>
                              <TableCell className="font-medium text-[var(--color-accent)]">{(row.precision * 100).toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {featureImportance && Object.keys(featureImportance).length > 0 && (
                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm">XGBoost Feature Importance (Top 25)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChart
                      data={Object.entries(featureImportance)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 25)
                        .map(([feature, importance]) => ({ label: feature, value: importance }))}
                      xKey="value"
                      yKey="label"
                      color={chartTheme.primary}
                      height={480}
                      indexAxis="y"
                    />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Network className="h-5 w-5" />
            Peeling-Chain / Mixing Classifier (RandomForest)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {patternMetrics && (
            <>
              <div>
                {patternMetrics.confusion_matrix && patternMetrics.classes && (
                  <Heatmap
                    matrix={patternMetrics.confusion_matrix}
                    labels={patternMetrics.classes}
                    height={400}
                  />
                )}
              </div>
              <div>
                {patternMetrics.feature_importance && (
                  <BarChart
                    data={Object.entries(patternMetrics.feature_importance)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 20)
                      .map(([feature, importance]) => ({ label: feature, value: importance }))}
                    xKey="value"
                    yKey="label"
                    color={chartTheme.primary}
                    height={400}
                    indexAxis="y"
                  />
                )}
              </div>
            </>
          )}
          {patternMetrics && (
            <div className="md:col-span-2">
              <ScrollArea className="h-[320px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Class</TableHead>
                      <TableHead>Precision</TableHead>
                      <TableHead>Recall</TableHead>
                      <TableHead>F1-Score</TableHead>
                      <TableHead>Support</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(patternMetrics.report).map(([className, metrics]) => {
                      if (typeof metrics === 'object' && metrics !== null && 'precision' in metrics) {
                        return (
                          <TableRow key={className}>
                            <TableHead>{className.replace('_', ' ')}</TableHead>
                            <TableCell>{(metrics.precision as number).toFixed(3)}</TableCell>
                            <TableCell>{(metrics.recall as number).toFixed(3)}</TableCell>
                            <TableCell>{(metrics['f1-score'] as number).toFixed(3)}</TableCell>
                            <TableCell>{metrics.support as number}</TableCell>
                          </TableRow>
                        );
                      }
                      return null;
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Brain className="h-5 w-5" />
            SHAP Global Feature Importance (Mean |SHAP| over Top-500 Alerts)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shapGlobal && shapGlobal.length > 0 && (
            <BarChart
              data={shapGlobal.slice(0, 20).map(d => ({ label: d.feature, value: d.importance }))}
              xKey="value"
              yKey="label"
              color={chartTheme.primary}
              height={400}
              indexAxis="y"
            />
          )}
          <p className="text-body-sm text-[var(--color-text-muted)] mt-3">
            SHAP-based importance, shown alongside the RandomForest's built-in importance above.
          </p>
        </CardContent>
      </Card>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Risk Propagation (Personalized PageRank)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {riskMetrics && (
            <div className="grid gap-4 grid-dashboard">
              <Card className="metric-card-accent hover-lift">
                <CardContent className="pt-6">
                  <p className="text-label-md text-[var(--color-text-muted)]">TX-Level AUC</p>
                  <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{riskMetrics.tx_level_auc?.toFixed(3)}</p>
                </CardContent>
              </Card>
              <Card className="metric-card-accent hover-lift">
                <CardContent className="pt-6">
                  <p className="text-label-md text-[var(--color-text-muted)]">Wallet-Level AUC</p>
                  <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{riskMetrics.wallet_level_auc?.toFixed(3)}</p>
                </CardContent>
              </Card>
              <Card className="metric-card-accent hover-lift">
                <CardContent className="pt-6">
                  <p className="text-label-md text-[var(--color-text-muted)]">Wallet-Level AP</p>
                  <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{riskMetrics.wallet_level_ap?.toFixed(3)}</p>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
