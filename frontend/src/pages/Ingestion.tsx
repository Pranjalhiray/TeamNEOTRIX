import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, ArrowUpRight, CheckCircle2, Database, FileJson2, FileSpreadsheet, FileText, Loader2, ShieldAlert, Trash2, UploadCloud } from 'lucide-react';
import { api } from '../services/api';
import type { GraphNode, IngestionSummary, Transaction } from '../types';
import { CytoscapeGraph } from '../components/graph';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { cn } from '../utils/cn';
import { PageHeading } from '../components/layout/PageHeading';
import { isHostedDeployment } from '../utils/runtime';

const number = (value: number | undefined) => value?.toLocaleString() ?? '—';
const score = (value: number | undefined) => `${((value ?? 0) * 100).toFixed(1)}%`;

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="metric-card-accent">
      <CardContent className="pt-5">
        <div className="min-w-0">
          <p className="text-label-md text-[var(--color-text-muted)]">{label}</p>
          <p className="mt-1 truncate text-display-sm font-bold text-[var(--color-text-primary)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DatasetWarnings({ summary }: { summary: IngestionSummary }) {
  if (summary.warnings.length === 0 && summary.missing_fields.length === 0) {
    return <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 size={17} /> All core network and blockchain fields were mapped.</div>;
  }
  return (
    <div className="space-y-2 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">
      <div className="flex items-center gap-2 font-medium"><AlertOctagon size={17} /> Dataset imported with field notes</div>
      {summary.warnings.map((warning) => <p key={warning} className="pl-6 text-xs leading-relaxed text-amber-100/80">{warning}</p>)}
    </div>
  );
}

export function Ingestion() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [localResult, setLocalResult] = useState<{ summary: IngestionSummary; sample: Transaction[] } | null>(null);
  const [error, setError] = useState('');

  const sessionQuery = useQuery({ queryKey: ['ingestion', 'session'], queryFn: api.ingestion.getSession, staleTime: 5_000 });
  const active = Boolean(sessionQuery.data?.active);
  const summary = localResult?.summary ?? sessionQuery.data?.summary ?? null;
  const alertsQuery = useQuery({ queryKey: ['ingestion', 'alerts'], queryFn: () => api.ingestion.getAlerts(100), enabled: active });
  const graphQuery = useQuery({ queryKey: ['ingestion', 'graph'], queryFn: () => api.ingestion.getGraph(20), enabled: active });

  const analyze = useMutation({
    mutationFn: api.ingestion.analyze,
    onSuccess: async (result) => {
      setError('');
      setLocalResult({ summary: result.summary, sample: result.sample });
      await queryClient.invalidateQueries();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'The dataset could not be analyzed.'),
  });

  const clear = useMutation({
    mutationFn: api.ingestion.clearSession,
    onSuccess: async () => {
      setLocalResult(null);
      setFile(null);
      setError('');
      await queryClient.invalidateQueries();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'The active import could not be cleared.'),
  });

  const openNode = (node: GraphNode) => {
    if (node.type === 'transaction' && node.id.startsWith('tx:')) navigate(`/investigate/${encodeURIComponent(node.id.slice(3))}`);
  };

  const chooseFile = (selected: File | null) => {
    setError('');
    if (!selected) return;
    if (!/\.(csv|json|xml)$/i.test(selected.name)) {
      setError('Choose a CSV, JSON or XML file.');
      return;
    }
    if (selected.size > 50 * 1024 * 1024) {
      setError('This file exceeds the 50 MB import limit.');
      return;
    }
    setFile(selected);
  };

  const sample = localResult?.sample ?? alertsQuery.data?.slice(0, 5) ?? [];
  const activeFilename = sessionQuery.data?.filename;

  return (
    <div className="space-y-6 animate-in">
      <PageHeading eyebrow={isHostedDeployment ? 'Hosted dataset workspace' : 'Offline dataset workspace'} title="Ingest & correlate" description={isHostedDeployment ? 'Uploaded files are processed in a temporary, browser-scoped server session. Use synthetic or non-sensitive demo data only.' : 'Bring transaction and network metadata into the forensic workspace. Your files stay on this computer.'} />

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="flex items-center gap-2 text-headline-sm"><UploadCloud className="h-5 w-5 text-[var(--color-accent)]" /> Import a bulk dataset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <label className={cn('flex min-h-[112px] cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] px-5 py-4 transition-colors hover:border-[var(--color-accent)]', analyze.isPending && 'pointer-events-none opacity-60')}>
              <input type="file" className="sr-only" accept=".csv,.json,.xml,text/csv,application/json,application/xml,text/xml" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"><FileText size={21} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{file?.name ?? activeFilename ?? 'Choose a local file to analyze'}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--color-text-muted)]">CSV, JSON or XML · up to 50 MB · transaction IDs and nested wallet arrays are supported</span>
              </span>
              <span className="hidden gap-2 text-[var(--color-text-muted)] sm:flex"><FileSpreadsheet size={17} /><FileJson2 size={17} /><FileText size={17} /></span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => file && analyze.mutate(file)} disabled={!file || analyze.isPending} className="min-w-40 gap-2">
                {analyze.isPending ? <><Loader2 size={16} className="animate-spin" /> Analyzing dataset</> : <><ShieldAlert size={16} /> Analyze dataset</>}
              </Button>
              {active && <Button variant="outline" onClick={() => clear.mutate()} disabled={clear.isPending} className="gap-2"><Trash2 size={15} /> Clear import</Button>}
            </div>
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">The importer maps timestamp, IP/port, TXID, wallet, amount, fee, script, GeoIP and ASN fields from common column names. Missing values are reported; unavailable ground truth is kept unknown.</p>
          {error && <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">{error}</div>}
          {summary && <DatasetWarnings summary={summary} />}
        </CardContent>
      </Card>
      {sessionQuery.error && <div role="alert" className="workspace-error-banner"><AlertOctagon size={17} /><span><strong>Could not check the active import.</strong> {sessionQuery.error instanceof Error ? sessionQuery.error.message : 'Reconnect to the local analysis service, then try again.'}</span><Button variant="outline" size="sm" onClick={() => void sessionQuery.refetch()} className="ml-auto shrink-0">Retry</Button></div>}

      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Transactions" value={number(summary.transactions_analyzed)} detail="Parsed and scored locally" />
            <Metric label="Wallets correlated" value={number(summary.wallets_correlated)} detail={`${number(summary.input_address_links + summary.output_address_links)} wallet links`} />
            <Metric label="Network endpoints" value={number(summary.ip_addresses_observed)} detail={`${number(summary.geoip_enriched)} records with location data`} />
            <Metric label="Prioritized leads" value={number(summary.prioritized_leads)} detail={`${number(summary.peeling_chain_count)} inferred peeling chains`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_.9fr]">
            <Card className="graph-panel">
              <CardHeader className="graph-panel-header">
                <div><CardTitle className="graph-panel-title">Correlated network & wallet graph</CardTitle><p className="mt-1 text-xs text-[var(--color-text-muted)]">IP broadcasts, transaction peers, wallet inputs/outputs, and inferred time-ordered flows.</p></div>
                <Badge variant="outline">Local graph</Badge>
              </CardHeader>
              <CardContent className="graph-panel-content">
                {graphQuery.isLoading ? <div className="graph-loading"><Loader2 className="animate-spin" /> Building graph links</div>
                  : graphQuery.data ? <CytoscapeGraph data={graphQuery.data} height="540px" onNodeClick={openNode} />
                    : <div className="graph-error">{graphQuery.error instanceof Error ? graphQuery.error.message : 'No graph could be loaded.'}</div>}
              </CardContent>
            </Card>

            <Card className="card-hover">
              <CardHeader className="border-b border-[var(--color-border)]"><CardTitle className="text-headline-sm">Signals in this import</CardTitle></CardHeader>
              <CardContent className="space-y-4 pt-5">
                <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{summary.score_method}</p>
                <div className="space-y-2">
                  {Object.entries(summary.pattern_distribution).map(([pattern, count]) => (
                    <div key={pattern} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2.5">
                      <span className="text-sm capitalize text-[var(--color-text-primary)]">{pattern.replaceAll('_', ' ')}</span>
                      <span className="font-mono text-xs text-[var(--color-text-muted)]">{number(count)}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  <strong className="text-[var(--color-text-primary)]">Evidence stays attached.</strong> Each lead includes model scores, network observations, input/output wallets and amounts. Search a transaction to see SHAP feature attribution.
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="card-hover">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[var(--color-border)]">
              <div><CardTitle className="text-headline-sm">Ranked investigative leads</CardTitle><p className="mt-1 text-xs text-[var(--color-text-muted)]">Model-prioritized transactions from the active local import.</p></div>
              {alertsQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" />}
            </CardHeader>
            <CardContent className="pt-4">
              {alertsQuery.error ? <p className="py-8 text-center text-sm text-rose-200">{alertsQuery.error instanceof Error ? alertsQuery.error.message : 'Could not load imported leads.'}</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Priority</TableHead><TableHead>Transaction</TableHead><TableHead>Pattern</TableHead><TableHead>Confidence</TableHead><TableHead>Evidence</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {(alertsQuery.data ?? []).slice(0, 12).map((alert, index) => (
                        <TableRow key={alert.txid}>
                          <TableCell className="font-mono text-xs text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</TableCell>
                          <TableCell className="max-w-52 truncate font-mono text-xs text-[var(--color-text-primary)]" title={alert.txid}>{alert.txid}</TableCell>
                          <TableCell><Badge variant={alert.pattern_pred !== 'normal' ? 'risk-high' : 'outline'}>{alert.pattern_pred?.replaceAll('_', ' ') ?? 'ranked'}</Badge></TableCell>
                          <TableCell className="font-mono text-xs">{score(alert.risk_score)}</TableCell>
                          <TableCell className="max-w-72 truncate text-xs text-[var(--color-text-muted)]" title={alert.reason}>{alert.reason}</TableCell>
                          <TableCell><Button variant="ghost" size="sm" onClick={() => navigate(`/investigate/${encodeURIComponent(alert.txid)}`)} className="gap-1">Review <ArrowUpRight size={13} /></Button></TableCell>
                        </TableRow>
                      ))}
                      {(alertsQuery.data?.length ?? 0) === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-[var(--color-text-muted)]">No leads are available for this import.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="card-hover">
            <CardHeader className="border-b border-[var(--color-border)]"><CardTitle className="text-headline-sm">Parsed transaction sample</CardTitle></CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>TXID</TableHead><TableHead>Time</TableHead><TableHead>Source → peer</TableHead><TableHead>Inputs / outputs</TableHead><TableHead>Fee BTC</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {sample.map((transaction) => <TableRow key={transaction.txid}>
                      <TableCell className="max-w-48 truncate font-mono text-xs" title={transaction.txid}>{transaction.txid}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{transaction.timestamp ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{transaction.src_ip ?? '—'}:{transaction.src_port ?? '—'} → {transaction.dst_ip ?? '—'}:{transaction.dst_port ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{transaction.input_addresses?.length ?? transaction.num_inputs ?? 0} / {transaction.output_addresses?.length ?? transaction.num_outputs ?? 0}</TableCell>
                      <TableCell className="font-mono text-xs">{transaction.fee_btc?.toFixed(8) ?? '—'}</TableCell>
                    </TableRow>)}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!summary && !sessionQuery.isLoading && <section className="ingestion-guide" aria-labelledby="ingestion-guide-title">
        <div className="ingestion-guide-heading"><div><p className="eyebrow">A simple {isHostedDeployment ? 'session-based' : 'local'} workflow</p><h2 id="ingestion-guide-title">From raw file to reviewable evidence</h2></div><span className="ingestion-privacy"><CheckCircle2 size={15} />{isHostedDeployment ? 'Temporary session' : 'Processed on this device'}</span></div>
        <div className="ingestion-guide-steps">
          <article className="ingestion-guide-step"><span className="ingestion-step-number">01</span><div className="ingestion-step-icon"><UploadCloud size={18} /></div><h3>Select a source</h3><p>Import a CSV, JSON, or XML export up to 50 MB.</p></article>
          <article className="ingestion-guide-step"><span className="ingestion-step-number">02</span><div className="ingestion-step-icon"><Database size={18} /></div><h3>Map available fields</h3><p>Transaction, wallet, network, and timing fields are recognized automatically.</p></article>
          <article className="ingestion-guide-step"><span className="ingestion-step-number">03</span><div className="ingestion-step-icon"><ShieldAlert size={18} /></div><h3>Review the leads</h3><p>Inspect ranked findings with their scores and linked evidence.</p></article>
        </div>
      </section>}
    </div>
  );
}
