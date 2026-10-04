import { BarChart, PieChart } from '../components/charts';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { ScrollArea } from '../components/ui/ScrollArea';
import { useOverviewStats, useCorrelatedSample, usePatternComposition, useIllicitVsLicit, useSupervisedAnomalyMetrics } from '../hooks';
import { chartTheme } from '../components/charts/chartTheme';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import type { Transaction } from '../types';
import { LockKeyhole, RefreshCw, UploadCloud, Download, Database, Clock3 } from 'lucide-react';
import { isHostedDeployment } from '../utils/runtime';

function displayTimestamp(value: number | string | null) {
  if (value == null || value === '') return '—';
  const date = typeof value === 'number'
    ? new Date(value > 100_000_000_000 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function exportCorrelatedSample(rows: Transaction[]) {
  const columns: Array<[string, (row: Transaction) => unknown]> = [
    ['TXID', (row) => row.txid],
    ['Timestamp', (row) => row.timestamp],
    ['Source IP', (row) => row.src_ip],
    ['Country', (row) => row.geo_country],
    ['ASN owner', (row) => row.asn_owner],
    ['Input address', (row) => row.input_address],
    ['Input amount BTC', (row) => row.input_amount ?? row.total_input_btc],
    ['Pattern', (row) => row.pattern_type],
    ['Known illicit', (row) => row.is_illicit == null ? 'Unknown' : row.is_illicit ? 'Yes' : 'No'],
    ['Risk score', (row) => row.risk_score],
  ];
  const escapeCsv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const content = [columns.map(([label]) => escapeCsv(label)).join(','), ...rows.map((row) => columns.map(([, value]) => escapeCsv(value(row))).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `correlated-sample-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Overview() {
  const queryClient = useQueryClient();
  const { data: stats, isLoading: statsLoading, isFetching: statsFetching, isError: statsError, error, refetch, dataUpdatedAt } = useOverviewStats();
  const { data: correlatedSample } = useCorrelatedSample(15);
  const { data: patternComposition } = usePatternComposition();
  const { data: illicitVsLicit } = useIllicitVsLicit();
  const { data: supervisedAnomaly } = useSupervisedAnomalyMetrics();

  if (statsLoading) {
    return (
      <div className="page-loading">
        <span className="loading-mark" />
        <span>Loading local intelligence</span>
      </div>
    );
  }

  if (statsError || !stats) {
    return (
      <div className="page-stack animate-in">
        <div className="page-intro">
          <div><p className="eyebrow">{isHostedDeployment ? 'Hosted analysis workspace' : 'Private analysis workspace'}</p><h1 className="page-title">Bitcoin transaction forensics</h1><p className="page-description">{isHostedDeployment ? 'Review transaction activity, wallet behavior, and risk from the hosted reference dataset.' : 'Your dashboard runs with local data and models, without an internet connection.'}</p></div>
        </div>
        <Card className="card-hover">
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="eyebrow">Local service unavailable</p>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">{error instanceof Error ? error.message : 'Start the local dashboard from VS Code. The analysis service and model bundle need to be available on this device.'}</p>
            <Button variant="outline" onClick={() => refetch()}>Reconnect</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const importedLabels = illicitVsLicit?.some((item) => item.label.toLowerCase().includes('unlabeled')) || false;
  const isImported = stats?.dataset_mode === 'import' || importedLabels;
  const groundTruthAvailable = stats?.ground_truth_available ?? !importedLabels;
  const walletDataAvailable = stats?.wallet_data_available ?? !(isImported && !stats?.wallets_tracked);
  const flowDataAvailable = stats?.flow_data_available ?? !(isImported && !stats?.wallets_tracked);
  const seedDataAvailable = stats?.seed_wallet_data_available ?? !isImported;
  const ensembleAuc = isImported || !groundTruthAvailable
    ? null
    : supervisedAnomaly?.ensemble_roc_auc ?? stats?.ensemble_auc ?? null;
  const anomalyAuc = !isImported ? supervisedAnomaly?.ensemble_roc_auc ?? 0 : 0;
  const licitCount = illicitVsLicit?.find((item) => item.label.toLowerCase() === 'licit')?.count ?? 0;
  const illicitCount = illicitVsLicit?.find((item) => item.label.toLowerCase() === 'illicit')?.count ?? 0;

  return (
    <div className="page-stack animate-in">
      <div className="page-intro">
        <div>
          <p className="eyebrow">{isHostedDeployment ? 'Hosted analysis workspace' : 'Private analysis workspace'}</p>
          <h1 className="page-title">Bitcoin transaction intelligence</h1>
          <p className="page-description">A clear view of transaction activity, wallet behavior, and risk across the active dataset.</p>
        </div>
        <div className="overview-heading-aside">
          <div className="overview-actions">
            <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ['overview'] })} disabled={statsFetching}>
              <RefreshCw size={15} className={statsFetching ? 'mr-2 animate-spin' : 'mr-2'} />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCorrelatedSample(correlatedSample?.slice(0, 10) || [])} disabled={!correlatedSample?.length}>
              <Download size={15} className="mr-2" />Export sample
            </Button>
            <Button asChild size="sm" className="text-white">
              <RouterLink to="/ingestion"><UploadCloud size={15} className="mr-2" />Import dataset</RouterLink>
            </Button>
          </div>
          <div className="overview-local-note"><span className="overview-lock"><LockKeyhole size={15} /></span><span><strong>{isHostedDeployment ? 'Session scoped' : 'Local by design'}</strong><small>{isHostedDeployment ? 'Imported files are held temporarily for this session' : 'Analysis stays on this device'}</small></span></div>
        </div>
      </div>

      <div className="overview-data-strip" aria-label="Active dataset details">
        <span className="overview-data-source"><Database size={15} /><span>{isImported ? 'Imported dataset' : 'Reference dataset'}</span></span>
        <span className="overview-data-count">{stats.transactions_analyzed?.toLocaleString() || '0'} transactions</span>
        <span className="overview-data-updated"><Clock3 size={14} />Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</span>
      </div>

      <div className="grid gap-4 grid-dashboard">
        <Card className="metric-card-accent hover-lift">
          <CardContent className="pt-6">
            <p className="text-label-md text-[var(--color-text-muted)]">Transactions Analyzed</p>
            <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{stats?.transactions_analyzed?.toLocaleString() || '—'}</p>
          </CardContent>
        </Card>
        <Card className="metric-card-accent hover-lift stagger-1">
          <CardContent className="pt-6">
            <p className="text-label-md text-[var(--color-text-muted)]">Wallets Tracked</p>
            <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{walletDataAvailable ? stats?.wallets_tracked?.toLocaleString() ?? '0' : '—'}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{walletDataAvailable ? 'Unique wallet addresses in the active dataset' : 'Input/output wallet addresses were not supplied'}</p>
          </CardContent>
        </Card>
        <Card className="metric-card-danger hover-lift stagger-2">
          <CardContent className="pt-6">
            <p className="text-label-md text-[var(--color-text-muted)]">Known-risk seed wallets</p>
            <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{seedDataAvailable ? stats?.seed_illicit_wallets?.toLocaleString() ?? '0' : '—'}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{seedDataAvailable ? 'Known seed wallets matched in this dataset' : 'No reference seed list matched to this import'}</p>
          </CardContent>
        </Card>
        <Card className="metric-card-warning hover-lift stagger-3">
          <CardContent className="pt-6">
            <p className="text-label-md text-[var(--color-text-muted)]">Peeling Chains Found</p>
            <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{flowDataAvailable ? stats?.peeling_chains_found?.toLocaleString() ?? '0' : '—'}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{flowDataAvailable ? 'Inferred from available wallet flows' : 'Requires input/output wallet addresses'}</p>
          </CardContent>
        </Card>
        <Card className="metric-card-success hover-lift stagger-4">
          <CardContent className="pt-6">
            <p className="text-label-md text-[var(--color-text-muted)]">Ensemble Risk AUC</p>
            <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{ensembleAuc == null ? '—' : ensembleAuc.toFixed(3)}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{ensembleAuc == null ? 'Ground-truth labels are not available for this import' : 'Reference validation against held-out labels'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 overview-table-grid">
        <Card className="card-hover hover-lift">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Network ↔ Blockchain Correlated View</CardTitle>
          </CardHeader>
          <CardContent>
              <p className="text-body-sm text-[var(--color-text-muted)] mb-4">
              Local sample correlating network observations, wallet flows, and model labels where those fields are available.
            </p>
            <ScrollArea className="h-[380px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">TXID</TableHead>
                    <TableHead className="w-[150px]">Timestamp</TableHead>
                    <TableHead className="w-[110px]">Src IP</TableHead>
                    <TableHead className="w-[60px]">Country</TableHead>
                    <TableHead>ASN Owner</TableHead>
                    <TableHead className="w-[100px]">Input Addr</TableHead>
                    <TableHead className="w-[90px]">Amount</TableHead>
                    <TableHead className="w-[100px]">Pattern</TableHead>
                    <TableHead className="w-[80px]">Illicit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {correlatedSample?.slice(0, 10).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{row.txid?.slice(0, 16)}...</TableCell>
                      <TableCell>{displayTimestamp(row.timestamp)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.src_ip}</TableCell>
                      <TableCell>{row.geo_country || '—'}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{row.asn_owner || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.input_address ? `${row.input_address.slice(0, 12)}…` : '—'}</TableCell>
                      <TableCell>{row.input_amount == null ? '—' : `${row.input_amount.toFixed(4)} BTC`}</TableCell>
                      <TableCell>
                        <Badge variant="neutral">{row.pattern_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.is_illicit ? 'risk-high' : 'risk-low'}>
                          {row.is_illicit == null ? 'UNKNOWN' : row.is_illicit ? 'YES' : 'NO'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="card-hover hover-lift">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Transaction Pattern Composition</CardTitle>
          </CardHeader>
          <CardContent>
            {patternComposition && (
              <BarChart
                data={patternComposition.map(p => ({ label: p.pattern_type, value: p.count }))}
                xKey="value"
                yKey="label"
                color={chartTheme.primary}
                height={340}
                indexAxis="y"
              />
            )}
          </CardContent>
        </Card>

        <Card className="card-hover hover-lift">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Ground-truth labels</CardTitle>
          </CardHeader>
          <CardContent>
            {!groundTruthAvailable ? (
              <div className="grid h-[340px] place-content-center justify-items-center gap-3 px-5 text-center">
                <LockKeyhole className="h-9 w-9 text-[var(--color-text-muted)]" />
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">No ground-truth labels in this dataset</p>
                <p className="max-w-sm text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {illicitVsLicit?.[0]?.count?.toLocaleString() || stats?.transactions_analyzed?.toLocaleString() || 'Imported'} transactions are unlabelled. The model can prioritize leads, but its predictions cannot be validated against this import.
                </p>
              </div>
            ) : illicitVsLicit && (
              <>
                <div className="mb-2 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3">
                    <p className="text-xs text-[var(--color-text-muted)]">Licit transactions</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--color-accent)]">{licitCount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3">
                    <p className="text-xs text-[var(--color-text-muted)]">Illicit transactions</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--color-risk-high)]">{illicitCount.toLocaleString()}</p>
                  </div>
                </div>
                <PieChart
                  data={illicitVsLicit.map(p => ({ label: p.label, value: p.count }))}
                  colors={illicitVsLicit.map((item) => item.label.toLowerCase().includes('illicit') && !item.label.toLowerCase().includes('unlabeled') ? chartTheme.danger : item.label.toLowerCase().includes('unlabeled') ? chartTheme.muted : chartTheme.success)}
                  height={290}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6">
        <Card className="card-hover hover-lift">
          <CardHeader className="border-b border-[var(--color-border)]">
            <CardTitle className="text-headline-sm">Anomaly Detection - Model Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            {isImported && <p className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-xs text-[var(--color-text-muted)]">Reference validation metrics from the saved model bundle; these are not measurements on the current import.</p>}
            {supervisedAnomaly && (
              <BarChart
                data={[
                  { label: 'XGBoost', value: supervisedAnomaly.xgb_roc_auc },
                  { label: 'LightGBM', value: supervisedAnomaly.lgb_roc_auc },
                  { label: 'RandomForest', value: supervisedAnomaly.rf_roc_auc },
                  { label: 'Ensemble (Mean)', value: supervisedAnomaly.ensemble_roc_auc },
                  { label: 'Isolation Forest (Baseline)', value: supervisedAnomaly.iso_roc_auc },
                ]}
                xKey="value"
                yKey="label"
                color={chartTheme.primary}
                height={340}
                indexAxis="y"
              />
            )}
            {!supervisedAnomaly && anomalyAuc && (
              <div className="text-center py-12 text-[var(--color-text-muted)]">
                <p className="text-body-md">Supervised ensemble metrics not available.</p>
                <p className="text-body-sm mt-2">Run <code className="bg-[var(--color-background)] px-2 py-1 rounded text-[var(--color-accent)]">python src/build_artifacts.py</code> with XGBoost/LightGBM installed.</p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

    </div>
  );
}
