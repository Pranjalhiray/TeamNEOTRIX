import { Fragment, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Slider } from '../components/ui/Slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useRankedAlerts, useDownloadAlerts } from '../hooks/useAlerts';
import { useAlertsStore } from '../store/useStore';
import { Download, RotateCw, ChevronDown, ChevronUp, Search, Funnel, X, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { PageHeading } from '../components/layout/PageHeading';

const PATTERN_OPTIONS = [
  'normal',
  'peeling_chain',
  'mixing',
  'exchange',
  'gambling',
  'darknet',
  'mining',
];

interface AlertRow {
  txid: string;
  confidence_pct: number;
  pattern_pred: string;
  is_illicit: number | null;
  reason: string;
  anomaly_score?: number;
  propagated_risk?: number;
  illicit_proba?: number;
  risk_score?: number;
}

const formatScore = (score: number | undefined) => {
  if (score === undefined || score === null) return '—';
  return score.toFixed(4);
};

export function Alerts() {
  const navigate = useNavigate();
  const { filters, setTopN, setPatternFilter } = useAlertsStore();
  const { data: alertsData, isLoading, error, refetch } = useRankedAlerts();
  const downloadAlerts = useDownloadAlerts();
  const [localTopN, setLocalTopN] = useState(filters.topN);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'risk_score', direction: 'desc' });

  const handleTopNChange = (value: number[]) => {
    const newValue = value[0];
    setLocalTopN(newValue);
    setTopN(newValue);
  };

  const toggleRow = (txid: string) => {
    setExpandedRow(expandedRow === txid ? null : txid);
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedData = useMemo(() => {
    if (!alertsData?.data) return [];
    return [...alertsData.data].sort((a, b) => {
      const aVal = a[sortConfig.key as keyof AlertRow];
      const bVal = b[sortConfig.key as keyof AlertRow];
      if (aVal === undefined || aVal === null) return 1;
      if (bVal === undefined || bVal === null) return -1;
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [alertsData?.data, sortConfig]);

  const filteredData = useMemo(() => {
    if (!sortedData) return [];
    return sortedData.filter(alert => {
      const matchesSearch = searchQuery === '' || 
        alert.txid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        alert.pattern_pred.toLowerCase().includes(searchQuery.toLowerCase()) ||
        alert.reason.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });
  }, [sortedData, searchQuery]);

  const hasActiveFilters = filters.patternFilter.length > 0 || searchQuery !== '';
  const patternCount = new Set((alertsData?.data ?? []).map((alert) => alert.pattern_pred)).size;

  return (
    <div className="space-y-6 animate-in">
      <PageHeading eyebrow="Risk intelligence" title="Ranked alerts" description="Review model-prioritized transactions, inspect score evidence, and export the current investigation set.">
          <Button onClick={downloadAlerts} variant="secondary" className="gap-2">
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
          <Button onClick={() => void refetch()} variant="outline" className="gap-2">
            <RotateCw className="h-4 w-4" />
            Refresh
          </Button>
      </PageHeading>

      <section className="alert-summary-grid" aria-label="Alert results summary">
        <div className="alert-summary-card"><span>Ranked findings</span><strong>{isLoading ? '…' : error ? '—' : (alertsData?.total ?? 0).toLocaleString()}</strong><small>in the current result set</small></div>
        <div className="alert-summary-card"><span>Visible now</span><strong>{isLoading ? '…' : filteredData.length.toLocaleString()}</strong><small>after search and filters</small></div>
        <div className="alert-summary-card"><span>Patterns represented</span><strong>{isLoading ? '…' : patternCount.toLocaleString()}</strong><small>across loaded findings</small></div>
      </section>
      {error && <div role="alert" className="workspace-error-banner"><ShieldAlert size={17} /><span><strong>Alert results are unavailable.</strong> {error instanceof Error ? error.message : 'The local analysis service did not return ranked findings.'}</span><Button variant="outline" size="sm" onClick={() => void refetch()} className="ml-auto shrink-0">Retry</Button></div>}

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm">Filters & Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="text-label-md text-[var(--color-text-muted)] block mb-2 flex items-center justify-between">
                Top N Alerts: <span className="font-mono text-[var(--color-text-primary)]">{localTopN}</span>
              </label>
              <Slider
                value={[localTopN]}
                onValueChange={handleTopNChange}
                max={500}
                min={10}
                step={10}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-label-md text-[var(--color-text-muted)] block mb-2">Filter by Pattern</label>
              <Select
                value={filters.patternFilter.join(',')}
                onValueChange={(value) => setPatternFilter(value.split(',').filter(Boolean))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All patterns" />
                </SelectTrigger>
                <SelectContent>
                  {PATTERN_OPTIONS.map((pattern) => (
                    <SelectItem key={pattern} value={pattern}>
                      {pattern.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-label-md text-[var(--color-text-muted)] block mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search TXID, pattern, reason..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input-field pl-10"
                />
              </div>
            </div>
          </div>
          
          {hasActiveFilters && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <Funnel className="h-4 w-4" />
              <span>Active filters: </span>
              {filters.patternFilter.map(p => (
                <Badge key={p} variant="accent" className="gap-1">
                  {p.replace('_', ' ')}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setPatternFilter(filters.patternFilter.filter(f => f !== p))} />
                </Badge>
              ))}
              {searchQuery && (
                <Badge variant="accent" className="gap-1">
                  " {searchQuery} "
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setSearchQuery('')} />
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => { setPatternFilter([]); setSearchQuery(''); }}>
                Clear all
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-[var(--color-text-muted)] pt-2 border-t border-[var(--color-border-muted)]">
            <span>Showing <strong className="text-[var(--color-text-primary)]">{filteredData.length}</strong> of <strong className="text-[var(--color-text-primary)]">{alertsData?.total || 0}</strong> alerts</span>
            <span>Filtered: <strong className="text-[var(--color-text-primary)]">{filteredData.length}</strong></span>
          </div>
        </CardContent>
      </Card>

      <Card className="card-hover overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[var(--color-surface-elevated)]">
                <TableHead className="w-10 cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('confidence_pct')}>
                  <div className="flex items-center justify-center gap-1">
                    <ChevronDown className={`h-4 w-4 transition-transform ${sortConfig.key === 'confidence_pct' && sortConfig.direction === 'desc' ? 'rotate-180' : ''}`} />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('txid')}>
                  TXID
                  {sortConfig.key === 'txid' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('confidence_pct')}>
                  Confidence
                  {sortConfig.key === 'confidence_pct' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('risk_score')}>
                  Risk Score
                  {sortConfig.key === 'risk_score' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('anomaly_score')}>
                  Anomaly Score
                  {sortConfig.key === 'anomaly_score' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('propagated_risk')}>
                  Prop. Risk
                  {sortConfig.key === 'propagated_risk' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('illicit_proba')}>
                  Illicit Proba
                  {sortConfig.key === 'illicit_proba' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => handleSort('pattern_pred')}>
                  Pattern
                  {sortConfig.key === 'pattern_pred' && (
                    <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </TableHead>
                <TableHead>Ground Truth</TableHead>
                <TableHead>Review</TableHead>
                <TableHead className="max-w-[400px]">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12">
                    <div className="flex items-center justify-center gap-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent)]" />
                      <span className="text-[var(--color-text-muted)]">Loading alerts...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={12} className="py-10 text-center text-sm text-[var(--color-text-muted)]">Reconnect to the local analysis service to review ranked findings.</TableCell></TableRow>
              ) : filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-[var(--color-text-muted)] py-12">
                    No alerts found matching your criteria
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((alert) => (
                  <Fragment key={alert.txid}>
                    <TableRow 
                      key={alert.txid}
                      className="cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
                      onClick={() => toggleRow(alert.txid)}
                    >
                      <TableCell className="text-center text-[var(--color-text-muted)]">
                        {expandedRow === alert.txid ? (
                          <ChevronUp className="h-4 w-4 mx-auto" />
                        ) : (
                          <ChevronDown className="h-4 w-4 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{alert.txid.slice(0, 16)}...</TableCell>
                      <TableCell className="font-medium text-[var(--color-text-primary)]">{alert.confidence_pct?.toFixed(1)}%</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-[var(--color-risk-low)] via-[var(--color-risk-medium)] to-[var(--color-risk-high)]"
                              style={{ width: `${Math.min((alert.risk_score || 0) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatScore(alert.risk_score)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{formatScore(alert.anomaly_score)}</TableCell>
                      <TableCell>{formatScore(alert.propagated_risk)}</TableCell>
                      <TableCell>{formatScore(alert.illicit_proba)}</TableCell>
                      <TableCell>
                        <Badge variant="neutral">{alert.pattern_pred.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell>
                        {alert.is_illicit == null ? (
                          <Badge variant="outline">Not supplied</Badge>
                        ) : alert.is_illicit ? (
                          <Badge variant="risk-high">Illicit</Badge>
                        ) : (
                          <Badge variant="risk-low">Licit/Unknown</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" aria-label={`Investigate ${alert.txid}`} onClick={(event) => { event.stopPropagation(); navigate(`/investigate/${encodeURIComponent(alert.txid)}`); }} className="gap-1">
                          Review <ArrowUpRight size={13} />
                        </Button>
                      </TableCell>
                      <TableCell className="max-w-[400px] text-sm text-[var(--color-text-muted)] truncate" title={alert.reason}>
                        {alert.reason}
                      </TableCell>
                    </TableRow>
                    {expandedRow === alert.txid && (
                      <TableRow>
                        <TableCell colSpan={12} className="p-0">
                          <div className="bg-[var(--color-background)] border-t border-[var(--color-border)] animate-in">
                            <div className="p-4 grid gap-4 md:grid-cols-4 text-sm">
                              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                                <p className="text-[var(--color-text-muted)]">Anomaly Score</p>
                                <p className="font-mono text-lg text-[var(--color-text-primary)] mt-1">{formatScore(alert.anomaly_score)}</p>
                              </div>
                              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                                <p className="text-[var(--color-text-muted)]">Propagated Risk (PageRank)</p>
                                <p className="font-mono text-lg text-[var(--color-text-primary)] mt-1">{formatScore(alert.propagated_risk)}</p>
                              </div>
                              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                                <p className="text-[var(--color-text-muted)]">Illicit Probability</p>
                                <p className="font-mono text-lg text-[var(--color-text-primary)] mt-1">{formatScore(alert.illicit_proba)}</p>
                              </div>
                              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                                <p className="text-[var(--color-text-muted)]">Composite Risk Score</p>
                                <p className="font-mono text-lg text-[var(--color-text-primary)] mt-1">{formatScore(alert.risk_score)}</p>
                              </div>
                            </div>
                            <div className="px-4 pb-4">
                              <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                                <p className="text-sm text-[var(--color-text-muted)]">Full TXID:</p>
                                <p className="font-mono text-xs text-[var(--color-text-primary)] break-all mt-1">{alert.txid}</p>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
