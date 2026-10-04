import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import { BarChart } from '../components/charts';
import { chartTheme } from '../components/charts/chartTheme';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { ScrollArea } from '../components/ui/ScrollArea';
import { PageHeading } from '../components/layout/PageHeading';
import { CytoscapeGraph } from '../components/graph';
import { useTransaction, useWallet, useTransactionGraph, useSHAPExplanation } from '../hooks';
import { useInvestigationStore } from '../store/useStore';
import { Search, AlertTriangle, Share2, ExternalLink, ChevronRight, Loader2, RadioTower } from 'lucide-react';

const getRiskBadge = (score: number) => {
  if (score >= 0.66) return <Badge variant="risk-high">HIGH</Badge>;
  if (score >= 0.33) return <Badge variant="risk-medium">MEDIUM</Badge>;
  return <Badge variant="risk-low">LOW</Badge>;
};

export function Investigate() {
  const { selectedTxId, selectedWallet, setSelectedTxId, setSelectedWallet } = useInvestigationStore();
  const navigate = useNavigate();
  const { txid } = useParams<{ txid?: string }>();
  const [searchParams] = useSearchParams();
  const walletParam = searchParams.get('wallet');
  const [txidInput, setTxidInput] = useState(txid || selectedTxId || '');
  const [walletInput, setWalletInput] = useState(selectedWallet || '');
  const [activeTxId, setActiveTxId] = useState(txid || selectedTxId || '');
  const [activeWallet, setActiveWallet] = useState(selectedWallet || '');
  const [activeTab, setActiveTab] = useState<'tx' | 'wallet'>(walletParam || selectedWallet ? 'wallet' : 'tx');

  const { data: txData, isLoading: txLoading, error: txError } = useTransaction(activeTxId || null);
  const { data: walletData, isLoading: walletLoading, error: walletError } = useWallet(activeWallet || null);
  const { data: graphData } = useTransactionGraph(activeTxId || null);
  const { data: shapData } = useSHAPExplanation(activeTxId || null);
  const hasInputWallets = Boolean(txData?.input_addresses?.length);
  const hasOutputWallets = Boolean(txData?.output_addresses?.length);

  useEffect(() => {
    if (!txid) return;
    setTxidInput(txid);
    setActiveTxId(txid);
    setSelectedTxId(txid);
    setActiveTab('tx');
  }, [txid, setSelectedTxId]);

  useEffect(() => {
    if (!walletParam) return;
    setWalletInput(walletParam);
    setActiveWallet(walletParam);
    setSelectedWallet(walletParam);
    setActiveTab('wallet');
  }, [walletParam, setSelectedWallet]);

  const handleTxSearch = () => {
    if (txidInput.trim()) {
      const value = txidInput.trim();
      setSelectedTxId(value);
      setActiveTxId(value);
      setActiveTab('tx');
    }
  };

  const handleWalletSearch = () => {
    if (walletInput.trim()) {
      const value = walletInput.trim();
      setSelectedWallet(value);
      setActiveWallet(value);
      setActiveTab('wallet');
    }
  };

  return (
    <div className="space-y-6 animate-in">
      <PageHeading eyebrow="Case workspace" title="Investigate" description="Trace a transaction or wallet through its observed activity, linked entities, and model evidence." />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'tx' | 'wallet')} className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-[var(--color-surface-elevated)] p-1 rounded-2xl border border-[var(--color-border)]">
          <TabsTrigger value="tx" className="tab-trigger tab-trigger-inactive data-[state=active]:tab-trigger-active">
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              By Transaction (TXID)
            </span>
          </TabsTrigger>
          <TabsTrigger value="wallet" className="tab-trigger tab-trigger-inactive data-[state=active]:tab-trigger-active">
            <span className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              By Wallet Address
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tx" className="space-y-6 animate-in">
          <Card className="card-hover">
            <CardHeader className="border-b border-[var(--color-border)]">
              <CardTitle className="text-headline-sm flex items-center gap-2">
                <Search className="h-5 w-5" />
                Search Transaction
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <div className="flex-1">
                  <Input
                    placeholder="Enter TXID (64-character hex)..."
                    value={txidInput}
                    onChange={(e) => setTxidInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleTxSearch()}
                    className="font-mono"
                  />
                </div>
                <Button onClick={handleTxSearch} disabled={!txidInput.trim() || txLoading} className="w-full shrink-0 gap-2 sm:w-auto">
                  <Search className="h-4 w-4" />
                  Search
                </Button>
              </div>
            </CardContent>
          </Card>

          {txLoading && (
            <Card className="card-hover">
              <CardContent className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent)]" />
                  <span className="text-[var(--color-text-muted)]">Loading transaction data...</span>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTxId && txError && !txLoading && (
            <Card className="card-hover">
              <CardContent className="flex items-center gap-3 py-5 text-[var(--risk-high)]">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="text-body-md">{txError instanceof Error ? txError.message : 'Could not load this transaction from the local dataset.'}</p>
              </CardContent>
            </Card>
          )}

          {txData && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="metric-card-accent hover-lift">
                  <CardContent className="pt-6">
                    <p className="text-label-md text-[var(--color-text-muted)]">Confidence</p>
                    <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{txData.confidence_pct?.toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card className="metric-card-accent hover-lift">
                  <CardContent className="pt-6">
                    <p className="text-label-md text-[var(--color-text-muted)]">Predicted Pattern</p>
                    <p className="text-headline-sm font-bold text-[var(--color-text-primary)] mt-1">{txData.pattern_pred.replace('_', ' ')}</p>
                  </CardContent>
                </Card>
                <Card className="metric-card-accent hover-lift">
                  <CardContent className="pt-6">
                    <p className="text-label-md text-[var(--color-text-muted)]">Risk Tier</p>
                    <div className="mt-1">{getRiskBadge(txData.risk_score || 0)}</div>
                  </CardContent>
                </Card>
              </div>

              <Card className="card-hover">
                <CardHeader className="border-b border-[var(--color-border)]">
                  <CardTitle className="text-headline-sm flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    Why This Transaction Was Flagged
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-border)] border-l-3 border-[var(--color-accent)] rounded-xl p-4">
                    <p className="text-body-md text-[var(--color-text-primary)]">{txData.reason}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="card-hover">
                <CardHeader className="border-b border-[var(--color-border)]">
                  <CardTitle className="text-headline-sm flex items-center gap-2"><RadioTower className="h-5 w-5" /> Network-layer observation</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Source IP', txData.src_ip], ['Source port', txData.src_port],
                    ['Peer IP', txData.dst_ip], ['Peer port', txData.dst_port],
                    ['Observed at', txData.timestamp], ['Country', txData.geo_country],
                    ['ASN', txData.asn], ['ASN owner', txData.asn_owner],
                    ['Script type', txData.script_type], ['Total input (BTC)', txData.total_input_btc?.toFixed(8)],
                    ['Total output (BTC)', txData.total_output_btc?.toFixed(8)], ['Fee (BTC)', txData.fee_btc?.toFixed(8)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
                      <p className="mt-1 truncate font-mono text-xs text-[var(--color-text-primary)]" title={value == null ? undefined : String(value)}>{value == null || value === '' ? '—' : String(value)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {txData.evidence?.signals && (
                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]"><CardTitle className="text-headline-sm">Model evidence for this lead</CardTitle></CardHeader>
                  <CardContent className="space-y-2 pt-4">
                    {txData.evidence.signals.length ? txData.evidence.signals.map((signal) => (
                      <div key={`${signal.model}-${signal.finding}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2.5">
                        <div><p className="text-xs font-semibold text-[var(--color-text-primary)]">{signal.finding}</p><p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{signal.model}</p></div>
                        <Badge variant="accent">{(signal.score * 100).toFixed(1)}%</Badge>
                      </div>
                    )) : <p className="text-sm text-[var(--color-text-muted)]">No individual model signal crossed its alert threshold. The transaction remains ranked by the combined score.</p>}
                  </CardContent>
                </Card>
              )}

              {shapData && (
                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm flex items-center gap-2">
                      <ExternalLink className="h-5 w-5" />
                      SHAP Feature Attribution
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-body-sm text-[var(--color-text-muted)] mb-4">
                      Why predicted <strong className="text-[var(--color-text-primary)]">{shapData.predicted_class.replace('_', ' ')}</strong> — feature contributions
                    </p>
                    {shapData.contributions.length > 0 && (
                      <BarChart
                        data={shapData.contributions.map(c => ({
                          label: c.feature,
                          value: c.shap_value,
                        }))}
                        xKey="value"
                        yKey="label"
                        color={chartTheme.primary}
                        height={320}
                        indexAxis="y"
                      />
                    )}
                    <p className="text-body-sm text-[var(--color-text-muted)] mt-3">
                      Positive values (blue) push toward this pattern; negative values push away.
                    </p>
                  </CardContent>
                </Card>
              )}

              {hasInputWallets || hasOutputWallets ? (
                <div className="grid gap-6 lg:grid-cols-2">
                {hasInputWallets && <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm flex items-center gap-2">
                      <Share2 className="h-5 w-5" />
                      Input Addresses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Address</TableHead>
                            <TableHead>Amount (BTC)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {txData.input_addresses!.map((address, index) => (
                            <TableRow key={`${address}-${index}`}>
                              <TableCell className="max-w-56 truncate font-mono text-xs" title={address}><button type="button" className="text-left text-[var(--color-accent)] hover:underline" onClick={() => { setWalletInput(address); setActiveWallet(address); setSelectedWallet(address); setActiveTab('wallet'); }}>{address}</button></TableCell>
                              <TableCell className="font-mono text-xs">{txData.input_amounts?.[index]?.toFixed(8) ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>}

                {hasOutputWallets && <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm flex items-center gap-2">
                      <ChevronRight className="h-5 w-5" />
                      Output Addresses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Address</TableHead>
                            <TableHead>Amount (BTC)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {txData.output_addresses!.map((address, index) => (
                            <TableRow key={`${address}-${index}`}>
                              <TableCell className="max-w-56 truncate font-mono text-xs" title={address}><button type="button" className="text-left text-[var(--color-accent)] hover:underline" onClick={() => { setWalletInput(address); setActiveWallet(address); setSelectedWallet(address); setActiveTab('wallet'); }}>{address}</button></TableCell>
                              <TableCell className="font-mono text-xs">{txData.output_amounts?.[index]?.toFixed(8) ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>}
                </div>
              ) : (
                <Card className="card-hover">
                  <CardContent className="flex items-start gap-3 py-5">
                    <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                    <div><p className="text-sm font-medium text-[var(--color-text-primary)]">Wallet flow data was not supplied</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">This transaction can still be analyzed from its network and transaction metadata. Add input_addresses and output_addresses columns to the import to enable wallet tracing.</p></div>
                  </CardContent>
                </Card>
              )}

              {graphData && (
                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm flex items-center gap-2">
                      <Share2 className="h-5 w-5" />
                      IP, Wallet & Transaction Neighbourhood
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-body-sm text-[var(--color-text-muted)] mb-4">
                      Drag nodes to move them, search the local graph, and review network ports and wallet flow relationships without external explorers.
                    </p>
                    <CytoscapeGraph data={graphData} height="420px" initialLayout="neighborhood" />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="wallet" className="space-y-6 animate-in">
            <Card className="card-hover">
              <CardHeader className="border-b border-[var(--color-border)]">
                <CardTitle className="text-headline-sm flex items-center gap-2">
                  <Share2 className="h-5 w-5" />
                  Search Wallet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                  <div className="flex-1">
                    <Input
                      placeholder="Enter wallet address..."
                      value={walletInput}
                      onChange={(e) => setWalletInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleWalletSearch()}
                    />
                  </div>
                  <Button onClick={handleWalletSearch} disabled={!walletInput.trim() || walletLoading} className="w-full shrink-0 gap-2 sm:w-auto">
                    <Search className="h-4 w-4" />
                    Search
                  </Button>
                </div>
              </CardContent>
            </Card>

          {walletLoading && (
              <Card className="card-hover">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent)]" />
                    <span className="text-[var(--color-text-muted)]">Loading wallet data...</span>
                  </div>
                </CardContent>
              </Card>
          )}

          {activeWallet && walletError && !walletLoading && (
            <Card className="card-hover">
              <CardContent className="flex items-center gap-3 py-5 text-[var(--risk-high)]">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="text-body-md">{walletError instanceof Error ? walletError.message : 'Could not load this wallet from the local dataset.'}</p>
              </CardContent>
            </Card>
          )}

            {walletData && (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <Card className="metric-card-accent hover-lift">
                    <CardContent className="pt-6">
                      <p className="text-label-md text-[var(--color-text-muted)]">Propagated Risk (PageRank)</p>
                      <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{walletData.propagated_risk?.toFixed(4)}</p>
                    </CardContent>
                  </Card>
                  <Card className="metric-card-accent hover-lift">
                    <CardContent className="pt-6">
                      <p className="text-label-md text-[var(--color-text-muted)]">Entity Type</p>
                      <p className="text-headline-sm font-bold text-[var(--color-text-primary)] mt-1">{walletData.entity_type}</p>
                    </CardContent>
                  </Card>
                  <Card className="metric-card-accent hover-lift">
                    <CardContent className="pt-6">
                      <p className="text-label-md text-[var(--color-text-muted)]">Ground-Truth Illicit</p>
                      <div className="mt-1">
                        {walletData.is_illicit === null || walletData.is_illicit === undefined ? (
                          <Badge variant="secondary">UNKNOWN</Badge>
                        ) : walletData.is_illicit ? (
                          <Badge variant="risk-high">YES</Badge>
                        ) : (
                          <Badge variant="risk-low">NO</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {walletData.predicted_entity_cluster !== undefined && (
                  <Card className="card-hover">
                    <CardHeader className="border-b border-[var(--color-border)]">
                      <CardTitle className="text-headline-sm flex items-center gap-2">
                        <Share2 className="h-5 w-5" />
                        Cluster Assignment
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                          <span className="text-xl font-bold text-[var(--color-accent)]">{walletData.predicted_entity_cluster}</span>
                        </div>
                        <div>
                          <p className="text-body-md text-[var(--color-text-primary)]">Predicted Entity Cluster ID</p>
                          <p className="text-body-sm text-[var(--color-text-muted)]">This wallet belongs to cluster <strong>{walletData.predicted_entity_cluster}</strong> based on graph embeddings and co-spending analysis</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="card-hover">
                  <CardHeader className="border-b border-[var(--color-border)]">
                    <CardTitle className="text-headline-sm flex items-center gap-2">
                      <Share2 className="h-5 w-5" />
                      Related Transactions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>TXID</TableHead>
                            <TableHead>Risk Score</TableHead>
                            <TableHead>Pattern</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {walletData.related_transactions?.length ? walletData.related_transactions.map((transaction) => (
                            <TableRow key={transaction.txid}>
                              <TableCell><button type="button" className="font-mono text-xs text-[var(--color-accent)] hover:underline" onClick={() => { setTxidInput(transaction.txid); setActiveTxId(transaction.txid); setSelectedTxId(transaction.txid); setActiveTab('tx'); navigate(`/investigate/${encodeURIComponent(transaction.txid)}`); }}>{transaction.txid.slice(0, 18)}…</button></TableCell>
                              <TableCell>{getRiskBadge(Number(transaction.risk_score ?? 0))} <span className="ml-1 text-xs">{transaction.risk_score == null ? '—' : `${(transaction.risk_score * 100).toFixed(1)}%`}</span></TableCell>
                              <TableCell className="capitalize">{transaction.pattern_pred?.replaceAll('_', ' ') || '—'}</TableCell>
                              <TableCell className="max-w-sm truncate" title={transaction.reason}>{transaction.reason || '—'}</TableCell>
                            </TableRow>
                          )) : <TableRow><TableCell colSpan={4} className="py-8 text-center text-[var(--color-text-muted)]">No related transaction records were found for this wallet.</TableCell></TableRow>}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                    {walletData.note && <p className="mt-3 text-xs text-[var(--color-text-muted)]">{walletData.note}</p>}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
    </div>
  );
}
