import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, GitBranch, Loader2, Network, RotateCcw, Search, ShieldAlert, Waypoints } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { PageHeading } from '../components/layout/PageHeading';
import { Slider } from '../components/ui/Slider';
import { CytoscapeGraph, type GraphMode } from '../components/graph';
import { api } from '../services/api';
import { useLinkAnalysis } from '../hooks/useGraph';
import { useGraphStore } from '../store/useStore';
import type { GraphData, GraphNode, TransactionTrace } from '../types';

type TraceDirection = 'upstream' | 'downstream';

function graphErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'The local analysis service could not complete this graph request.';
}

function mergeGraphData(current: GraphData | null, incoming: GraphData): GraphData {
  const nodes = new Map((current?.nodes || []).map((node) => [node.id, node]));
  for (const node of incoming.nodes) {
    const previous = nodes.get(node.id);
    nodes.set(node.id, previous
      ? { ...previous, ...node, highlighted: previous.highlighted || node.highlighted, risk: Math.max(previous.risk, node.risk), details: { ...previous.details, ...node.details } }
      : { ...node });
  }
  const edges = new Map<string, GraphData['edges'][number]>();
  for (const edge of [...(current?.edges || []), ...incoming.edges]) {
    const key = [edge.source, edge.target, edge.kind || '', edge.label || '', String(edge.details?.amount ?? '')].join('|');
    if (!edges.has(key)) edges.set(key, edge);
  }
  const nodeIds = new Set(nodes.keys());
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)) };
}

function positionTraceGraph(data: GraphData | null, path: string[], selectedIndex: number): GraphData | null {
  if (!data) return null;
  const indexByTx = new Map(path.map((txid, index) => [txid, index]));
  return {
    nodes: data.nodes.map((node) => {
      if (node.type !== 'transaction') return node;
      const txid = node.id.replace(/^tx:/, '');
      const pathIndex = indexByTx.get(txid);
      if (pathIndex == null) return { ...node, highlighted: false };
      const depth = pathIndex - selectedIndex;
      return { ...node, highlighted: depth === 0, details: { ...node.details, trace_depth: depth, trace_stage: depth === 0 ? 'current' : depth < 0 ? 'upstream' : 'downstream' } };
    }),
    edges: data.edges,
  };
}

function displayValue(value: unknown, fractionDigits = 6) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? 'Not supplied' : number.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

function displayTimestamp(value: unknown) {
  if (value == null || value === '') return 'Not supplied';
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function riskLabel(value: number) {
  return value >= 0.7 ? 'High risk' : value >= 0.35 ? 'Elevated' : 'Low risk';
}

function riskVariant(value: number): 'risk-high' | 'risk-medium' | 'risk-low' {
  return value >= 0.7 ? 'risk-high' : value >= 0.35 ? 'risk-medium' : 'risk-low';
}

export function Graph() {
  const navigate = useNavigate();
  const { highlightedNodes, toggleNodeHighlight, setHighlightedNodes } = useGraphStore();
  const [topK, setTopK] = useState(20);
  const [mode, setMode] = useState<GraphMode>('risk-network');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [network, setNetwork] = useState<GraphData | null>(null);
  const [traceGraph, setTraceGraph] = useState<GraphData | null>(null);
  const [trace, setTrace] = useState<TransactionTrace | null>(null);
  const [tracePath, setTracePath] = useState<string[]>([]);
  const [traceIndex, setTraceIndex] = useState(0);
  const [traceHistory, setTraceHistory] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [requestError, setRequestError] = useState('');
  const autoTraceAttemptedRef = useRef('');
  const { data: graphData, isLoading, isFetching, isError, error, refetch } = useLinkAnalysis(topK);

  useEffect(() => {
    if (!graphData) return;
    setNetwork(graphData);
    setSelectedNode((current) => current && graphData.nodes.some((node) => node.id === current.id) ? current : null);
  }, [graphData]);

  const visibleTrace = useMemo(() => positionTraceGraph(traceGraph, tracePath, traceIndex), [traceGraph, tracePath, traceIndex]);
  const visibleGraph = mode === 'heuristic-trace' ? visibleTrace : network;
  const selectedDetails = selectedNode?.details || {};
  const transaction = trace?.transaction;
  const traceFeatures = transaction?.transaction_features || {};
  const traceSignals = transaction?.risk_evidence_signals || [];
  const currentTxRisk = Number(transaction?.risk_score ?? selectedNode?.risk ?? 0);
  const features = (selectedDetails.transaction_features || {}) as Record<string, unknown>;

  const loadTrace = async (txid: string, direction?: TraceDirection) => {
    const cleanId = txid.trim().replace(/^tx:/, '');
    if (!cleanId) return;
    setBusy(true);
    setRequestError('');
    setMessage('');
    try {
      const result = await api.graph.getTrace(cleanId);
      const resolvedTxid = result.txid;
      setTrace(result);
      setSelectedNode(result.graph.nodes.find((node) => node.id === `tx:${resolvedTxid}`) || null);
      setTraceGraph((current) => mergeGraphData(current, result.graph));
      if (direction && trace?.txid && trace.txid !== resolvedTxid) setTraceHistory((current) => [...current, trace.txid].slice(-20));
      else if (!direction) setTraceHistory([]);
      setTracePath((current) => {
        if (!current.length || !direction) return [resolvedTxid];
        if (current.includes(resolvedTxid)) return current;
        return direction === 'upstream' ? [resolvedTxid, ...current] : [...current, resolvedTxid];
      });
      setTraceIndex(direction === 'upstream' ? 0 : direction === 'downstream' && tracePath.length ? tracePath.length : 0);
      if (!direction) setTraceIndex(0);
      setMode('heuristic-trace');
    } catch (errorValue) {
      setRequestError(graphErrorMessage(errorValue));
    } finally {
      setBusy(false);
      setFollowBusy(null);
    }
  };

  const searchTransaction = async (event: FormEvent) => {
    event.preventDefault();
    if (!search.trim()) return;
    const searchedId = search.trim().replace(/^tx:/, '');
    await loadTrace(searchedId);
    // In the risk view, retain the richer mixed IP/wallet graph for the result.
    if (mode === 'risk-network') {
      try {
        const found = await api.graph.getTrace(searchedId);
        const result = await api.investigate.getTransactionGraph(found.txid);
        setNetwork(result);
        const root = result.nodes.find((node) => node.id === `tx:${found.txid}`);
        if (root) setSelectedNode(root);
        setMode('risk-network');
      } catch (errorValue) {
        setRequestError(graphErrorMessage(errorValue));
      }
    }
  };

  const enterTrace = (node: GraphNode) => {
    const txid = node.id.replace(/^tx:/, '');
    void loadTrace(txid);
  };

  const selectPathItem = async (index: number) => {
    const txid = tracePath[index];
    if (!txid) return;
    setTraceIndex(index);
    setBusy(true);
    setRequestError('');
    try {
      const result = await api.graph.getTrace(txid);
      if (trace?.txid && trace.txid !== txid) setTraceHistory((current) => [...current, trace.txid].slice(-20));
      setTrace(result);
      setSelectedNode(result.graph.nodes.find((node) => node.id === `tx:${txid}`) || null);
      setTraceGraph((current) => mergeGraphData(current, result.graph));
    } catch (errorValue) {
      setRequestError(graphErrorMessage(errorValue));
    } finally {
      setBusy(false);
    }
  };

  const returnToPreviousTransaction = async () => {
    const previousTxid = traceHistory.at(-1);
    if (!previousTxid) return;
    setBusy(true);
    setRequestError('');
    try {
      const result = await api.graph.getTrace(previousTxid);
      setTrace(result);
      setSelectedNode(result.graph.nodes.find((node) => node.id === `tx:${previousTxid}`) || null);
      setTraceGraph((current) => mergeGraphData(current, result.graph));
      const existing = tracePath.indexOf(previousTxid);
      if (existing >= 0) setTraceIndex(existing);
      else { setTracePath([previousTxid]); setTraceIndex(0); }
      setTraceHistory((current) => current.slice(0, -1));
    } catch (errorValue) {
      setRequestError(graphErrorMessage(errorValue));
    } finally {
      setBusy(false);
    }
  };

  const followTransaction = (txid: string | null | undefined, direction: TraceDirection) => {
    if (!txid) return;
    const existingIndex = tracePath.indexOf(txid);
    if (existingIndex >= 0) {
      void selectPathItem(existingIndex);
      return;
    }
    setFollowBusy(txid);
    void loadTrace(txid, direction);
  };

  const followFromInput = (txid: string | null, key: string) => {
    if (!txid) {
      setMessage('A previous transaction is not linked to this input in the local dataset. The input address and amount remain available, but no prevout is invented.');
      return;
    }
    followTransaction(txid, 'upstream');
    setFollowBusy(key);
  };

  const followFromOutput = (txid: string | null, key: string) => {
    if (!txid) {
      setMessage('No later spend for this output is present in the local dataset.');
      return;
    }
    followTransaction(txid, 'downstream');
    setFollowBusy(key);
  };

  const expandNetworkNode = async (node: GraphNode) => {
    if (!['transaction', 'wallet', 'ip'].includes(node.type || '')) return;
    setFollowBusy(node.id);
    setRequestError('');
    try {
      const expanded = await api.graph.expandNode(node.id, 10);
      setNetwork((current) => mergeGraphData(current, expanded));
      setSelectedNode(node);
    } catch (errorValue) {
      setRequestError(graphErrorMessage(errorValue));
    } finally {
      setFollowBusy(null);
    }
  };

  const changeMode = (nextMode: GraphMode) => {
    setMode(nextMode);
    setMessage('');
    if (nextMode === 'heuristic-trace' && !trace) {
      const candidate = selectedNode?.type === 'transaction'
        ? selectedNode
        : network?.nodes.find((node) => node.type === 'transaction' && node.highlighted)
          || [...(network?.nodes || [])].filter((node) => node.type === 'transaction').sort((a, b) => b.risk - a.risk)[0];
      if (candidate) enterTrace(candidate);
    }
  };

  // If the user opens trace mode while the network is still loading, start it
  // as soon as real transaction nodes become available.
  useEffect(() => {
    if (mode !== 'heuristic-trace' || trace || busy || !network) return;
    const candidate = selectedNode?.type === 'transaction'
      ? selectedNode
      : network.nodes.find((node) => node.type === 'transaction' && node.highlighted)
        || [...network.nodes].filter((node) => node.type === 'transaction').sort((a, b) => b.risk - a.risk)[0];
    if (candidate && autoTraceAttemptedRef.current !== candidate.id) {
      autoTraceAttemptedRef.current = candidate.id;
      void loadTrace(candidate.id);
    }
  }, [mode, trace, busy, network, selectedNode]);

  const contextPairs: Array<[string, unknown]> = [
    ['Timestamp', transaction?.timestamp ?? selectedDetails.timestamp],
    ['Block', transaction?.block],
    ['Input value', transaction?.total_input_btc ?? features.total_input_btc],
    ['Output value', transaction?.total_output_btc ?? features.total_output_btc],
    ['Fee', transaction?.fee_btc ?? features.fee_btc],
    ['Inputs', transaction?.num_inputs ?? features.num_inputs],
    ['Outputs', transaction?.num_outputs ?? features.num_outputs],
    ['Script type', transaction?.script_type ?? features.script_type],
  ];
  const availableContextPairs = contextPairs;
  const activeRisk = Number(selectedNode?.risk ?? transaction?.risk_score ?? 0);
  const selectedObservationFields: Array<[string, unknown]> = selectedNode?.type === 'transaction'
    ? [['Source IP', selectedDetails.src_ip], ['Source port', selectedDetails.src_port], ['Peer IP', selectedDetails.dst_ip], ['Peer port', selectedDetails.dst_port], ['Observed at', selectedDetails.timestamp], ['Country', selectedDetails.geo_country], ['ASN', selectedDetails.asn], ['ASN owner', selectedDetails.asn_owner]]
    : [['Address', selectedDetails.address], ['Observed at', selectedDetails.timestamp], ['Country', selectedDetails.geo_country], ['ASN', selectedDetails.asn], ['ASN owner', selectedDetails.asn_owner], ['Linked transactions', selectedDetails.related_transaction_count], ['Propagated risk', selectedDetails.propagated_risk == null ? null : `${(Number(selectedDetails.propagated_risk) * 100).toFixed(1)}%`]];
  const visibleObservationFields = selectedObservationFields.filter(([, value]) => value != null && value !== '');

  return (
    <div className="page-stack animate-in graph-analysis-page">
      <PageHeading eyebrow="Network intelligence" title="Graph analysis" description="Explore model-ranked network exposure or trace a transaction through its observed inputs and outputs.">
        <div className="page-intro-note"><ShieldAlert size={16} /><span>Risk and ownership heuristics are investigative signals, not proof of wrongdoing or control.</span></div>
      </PageHeading>

      <Card className="control-card graph-analysis-controls">
        <CardContent className="graph-workflow-controls">
          <label className="graph-mode-control"><span className="eyebrow">Investigation mode</span>
            <select className="graph-mode-select" value={mode} onChange={(event) => changeMode(event.target.value as GraphMode)} aria-label="Graph analysis mode">
              <option value="risk-network">Risk Network</option><option value="heuristic-trace">Heuristic Trace</option>
            </select>
            <small>{mode === 'risk-network' ? 'Where is suspicious activity?' : 'Trace transaction inputs and outputs'}</small>
          </label>
          <form className="graph-transaction-search" onSubmit={(event) => void searchTransaction(event)}>
            <label htmlFor="graph-tx-search">Transaction ID</label>
            <div><Search size={16} /><input id="graph-tx-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter a TXID or unambiguous prefix" /><Button type="submit" size="sm" disabled={busy || !search.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : 'Investigate'}</Button></div>
          </form>
          {mode === 'risk-network' && <div className="graph-scope-control">
            <div><span className="eyebrow">Initial scope</span><strong>{topK} high-risk transactions</strong></div>
            <Slider value={[topK]} onValueChange={(value) => setTopK(value[0])} max={40} min={10} step={5} aria-label="Initial transactions in risk network" />
          </div>}
          <div className="graph-stat-pills graph-page-stats">
            <span><i className="stat-dot stat-dot-nodes" />{visibleGraph?.nodes.length.toLocaleString() ?? '—'} nodes</span>
            <span><i className="stat-dot stat-dot-edges" />{visibleGraph?.edges.length.toLocaleString() ?? '—'} connections</span>
            {mode === 'risk-network' && <Button variant="outline" size="sm" onClick={() => { setHighlightedNodes(new Set()); setSelectedNode(null); }} disabled={highlightedNodes.size === 0} className="graph-clear-button"><RotateCcw size={14} /> Clear marks</Button>}
            {mode === 'risk-network' && <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RotateCcw size={14} /> Refresh</Button>}
            {mode === 'heuristic-trace' && trace && <Button variant="outline" size="sm" onClick={() => void loadTrace(trace.txid)} disabled={busy}><RotateCcw size={14} /> Refresh trace</Button>}
            {mode === 'heuristic-trace' && tracePath.length > 1 && <div className="trace-path-history" aria-label="Trace path">
              {tracePath.map((txid, index) => <button type="button" key={`${txid}-${index}`} className={index === traceIndex ? 'active' : ''} onClick={() => void selectPathItem(index)} title={txid}>{index > 0 ? <ArrowRight size={12} /> : null}{txid.slice(0, 8)}…</button>)}
            </div>}
          </div>
        </CardContent>
      </Card>

      {requestError && <div className="graph-request-error" role="alert"><ShieldAlert size={16} />{requestError}</div>}
      {message && <div className="graph-request-message" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="Dismiss message">×</button></div>}

      <div className="graph-investigation-layout">
        <Card className="graph-panel graph-canvas-card">
          <CardHeader className="graph-panel-header">
            <div>
              <CardTitle className="graph-panel-title">{mode === 'risk-network' ? 'Risk network' : 'Heuristic transaction trace'}</CardTitle>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{mode === 'risk-network' ? 'High-risk and highly connected entities are emphasized. Select nodes to inspect evidence and expand local links.' : 'Follow only relationships observed in this imported dataset. Missing prevout links stay explicitly unavailable.'}</p>
            </div>
            <div className="graph-live-label">{(mode === 'risk-network' && isFetching) || busy ? <span className="status-pulse" /> : <span className="live-dot" />}{busy ? 'Tracing locally' : isFetching ? 'Updating network' : 'Local analysis'}</div>
          </CardHeader>
          <CardContent className="graph-panel-content">
            {mode === 'risk-network' && isLoading ? <div className="graph-loading"><span className="loading-mark" /><span>Mapping model-ranked relationships</span></div>
              : mode === 'risk-network' && isError ? <div className="graph-error"><ShieldAlert size={22} /><p>{graphErrorMessage(error)}</p><Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button></div>
                : <CytoscapeGraph
                  data={visibleGraph}
                  height="100%"
                  mode={mode}
                  showSearch={false}
                  showLegend
                  showWeightControl={mode === 'risk-network'}
                  highlightedNodes={highlightedNodes}
                  onNodeClick={(node) => {
                    setSelectedNode(node);
                    if (mode === 'risk-network') {
                      toggleNodeHighlight(node.id);
                      void expandNetworkNode(node);
                    } else if (node.type === 'transaction') {
                      void loadTrace(node.id);
                    } else if (node.type === 'wallet') {
                      setMessage(String(node.details?.address || node.id.replace(/^wallet:/, '')));
                    }
                  }}
                />}
            {mode === 'heuristic-trace' && !trace && !busy && <div className="trace-empty-overlay"><Waypoints size={24} /><strong>Search a transaction to begin a trace</strong><span>Inputs, outputs, observed related transactions, and ML risk evidence will appear here.</span></div>}
          </CardContent>
        </Card>

        <Card className="graph-details-card">
          <CardHeader className="graph-panel-header"><div><CardTitle className="graph-panel-title">Investigation details</CardTitle><p className="mt-1 text-xs text-[var(--text-muted)]">Risk evidence and observed transaction lineage</p></div></CardHeader>
          <CardContent className="graph-details-content">
            {mode === 'heuristic-trace' && trace && transaction ? <>
              <div className="trace-current-heading"><div><span className="eyebrow">Selected transaction</span><strong className="trace-txid">{trace.txid}</strong></div><Button variant="outline" size="sm" onClick={() => navigate(`/investigate/${encodeURIComponent(trace.txid)}`)}><ArrowUpRight size={14} /> Full case</Button></div>
              <div className="trace-risk-strip"><div><small>Model risk</small><strong>{(currentTxRisk * 100).toFixed(1)}%</strong></div><Badge variant={riskVariant(currentTxRisk)}>{riskLabel(currentTxRisk)}</Badge></div>
              <div className="trace-detail-metrics">{availableContextPairs.map(([label, value]) => {
                const formattedValue = value == null || value === ''
                  ? 'Not supplied'
                  : label === 'Timestamp'
                    ? displayTimestamp(value)
                  : label.toLowerCase().includes('value') || label === 'Fee'
                    ? `${displayValue(value)} BTC`
                    : String(value);
                return <div key={label}><small>{label}</small><strong>{formattedValue}</strong></div>;
              })}</div>
              <div className="trace-prediction"><div><small>Pattern prediction</small><strong>{transaction.pattern_pred || 'Not supplied'}</strong></div><div><small>Confidence</small><strong>{transaction.confidence_pct == null ? 'Not supplied' : `${displayValue(transaction.confidence_pct, 1)}%`}</strong></div><div><small>Anomaly score</small><strong>{transaction.anomaly_score == null ? 'Not supplied' : `${(Number(transaction.anomaly_score) * 100).toFixed(1)}%`}</strong></div></div>
              {transaction.risk_evidence && <div className="trace-reason"><small>Why it was flagged</small><p>{transaction.risk_evidence}</p></div>}
              {traceSignals.length > 0 && <div className="trace-section"><div className="trace-section-title"><span>Model evidence</span><Badge variant="neutral">{traceSignals.length} signals</Badge></div>
                {traceSignals.map((signal, index) => <div className="trace-model-signal" key={`${signal.model}-${index}`}><div><strong>{signal.model || 'Model signal'}</strong><small>{signal.finding || 'Model feature score'}</small></div><div><strong>{signal.score == null ? '—' : `${(Number(signal.score) * 100).toFixed(1)}%`}</strong>{signal.weight != null && <small>Weight {(Number(signal.weight) * 100).toFixed(0)}%</small>}</div></div>)}
              </div>}
              {Object.keys(traceFeatures).some((key) => !['num_inputs', 'num_outputs', 'total_input_btc', 'total_output_btc', 'fee_btc'].includes(key)) && <div className="trace-section"><div className="trace-section-title"><span>Model parameters</span></div><div className="trace-detail-metrics">
                {Object.entries(traceFeatures).filter(([key, value]) => value != null && !['num_inputs', 'num_outputs', 'total_input_btc', 'total_output_btc', 'fee_btc'].includes(key)).map(([key, value]) => <div key={key}><small>{key.replaceAll('_', ' ')}</small><strong>{key === 'script_type' ? String(value) : displayValue(value, 4)}</strong></div>)}
              </div></div>}
              <div className="trace-section"><div className="trace-section-title"><span>Inputs</span><Badge variant="neutral">{trace.inputs.length}</Badge></div>
                {trace.inputs.length ? trace.inputs.map((input) => <div className="trace-io-row" key={`in-${input.index}-${input.address}`}>
                  <div><small>Input #{input.index}</small><strong title={input.address}>{input.address}</strong><span>{input.amount_btc == null ? 'Amount not supplied' : `${displayValue(input.amount_btc)} BTC`}</span>
                    <small className="trace-linkage-note">{input.previous_txid ? input.linkage_inferred ? 'Inferred shared-address lineage' : input.linkage_basis : 'Previous transaction ID not available in this dataset'}</small>
                  </div><Button variant="outline" size="sm" disabled={!input.previous_txid || followBusy === `in-${input.index}`} onClick={() => followFromInput(input.previous_txid, `in-${input.index}`)} title={input.previous_txid ? `Trace previous ${input.previous_txid}` : 'No previous transaction was linked in this data'}>{followBusy === `in-${input.index}` ? <Loader2 size={14} className="animate-spin" /> : <><ArrowLeft size={14} /> Trace</>}</Button>
                </div>) : <p className="trace-no-data">No input address rows were supplied for this transaction.</p>}
              </div>
              <div className="trace-section"><div className="trace-section-title"><span>Outputs</span><Badge variant="neutral">{trace.outputs.length}</Badge></div>
                {trace.outputs.length ? trace.outputs.map((output) => <div className="trace-io-row" key={`out-${output.index}-${output.address}`}>
                  <div><small>Output #{output.index}{output.likely_change ? ' · likely change output' : ''}</small><strong title={output.address}>{output.address}</strong><span>{output.amount_btc == null ? 'Amount not supplied' : `${displayValue(output.amount_btc)} BTC`}</span>
                    <small className="trace-linkage-note">{output.spent_by_txid ? output.linkage_inferred ? 'Inferred shared-address spend' : `Observed later spend: ${output.spent_by_txid}` : 'No later spend for this output in the dataset'}</small>
                    {output.change_signals.length > 0 && <small className="trace-linkage-note">Weak signal: {output.change_signals.join(', ')}</small>}
                  </div><Button variant="outline" size="sm" disabled={!output.spent_by_txid || followBusy === `out-${output.index}`} onClick={() => followFromOutput(output.spent_by_txid, `out-${output.index}`)} title={output.spent_by_txid ? `Follow spend ${output.spent_by_txid}` : 'No later spend is present in this data'}>{followBusy === `out-${output.index}` ? <Loader2 size={14} className="animate-spin" /> : <><ArrowRight size={14} /> Follow</>}</Button>
                </div>) : <p className="trace-no-data">No output address rows were supplied for this transaction.</p>}
              </div>
              <div className="trace-heuristics"><div className="trace-section-title"><span>Heuristics & limits</span><GitBranch size={15} /></div>
                <p>{trace.heuristics.common_input_note}</p>
                {trace.heuristics.common_input_applicable && <Badge variant="accent">Likely common ownership</Badge>}
                {trace.outputs.some((output) => output.likely_change) && <p>Possible change is marked only because the same address occurs among inputs and outputs; this weak signal does not establish change ownership.</p>}
                <p>{trace.heuristics.change_note}</p>
                {traceHistory.length > 0 && <Button variant="outline" size="sm" onClick={() => void returnToPreviousTransaction()} disabled={busy}><ArrowDownLeft size={14} /> Return to previous transaction</Button>}
              </div>
        </> : selectedNode ? <>
              <div className="trace-current-heading"><div><span className="eyebrow">Selected {selectedNode.type || 'entity'}</span><strong className="trace-txid">{selectedNode.id.replace(/^(tx|wallet|ip):/, '')}</strong></div></div>
              <div className="trace-risk-strip"><div><small>{selectedNode.type === 'transaction' ? 'Model risk' : 'Highest linked transaction risk'}</small><strong>{(activeRisk * 100).toFixed(1)}%</strong></div><Badge variant={riskVariant(activeRisk)}>{riskLabel(activeRisk)}</Badge></div>
              {selectedDetails.reason && <div className="trace-reason"><small>Why it was flagged</small><p>{String(selectedDetails.reason)}</p></div>}
              <div className="trace-prediction"><div><small>Pattern prediction</small><strong>{String(selectedDetails.pattern_pred || 'Not supplied')}</strong></div><div><small>Confidence</small><strong>{selectedDetails.confidence_pct == null ? 'Not supplied' : `${displayValue(selectedDetails.confidence_pct, 1)}%`}</strong></div></div>
              {visibleObservationFields.length > 0 && <div className="trace-detail-metrics">{visibleObservationFields.map(([label, value]) => <div key={label}><small>{label}</small><strong>{String(value)}</strong></div>)}</div>}
              <div className="trace-detail-metrics">{Object.entries(features).filter(([, value]) => value != null).slice(0, 8).map(([key, value]) => <div key={key}><small>{key.replaceAll('_', ' ')}</small><strong>{key.includes('btc') ? `${displayValue(value)} BTC` : String(value)}</strong></div>)}</div>
              {selectedNode.type === 'transaction' && <Button onClick={() => enterTrace(selectedNode)}><Waypoints size={14} /> Open in Heuristic Trace</Button>}
              {selectedNode.type === 'transaction' && <Button variant="outline" onClick={() => navigate(`/investigate/${encodeURIComponent(selectedNode.id.replace(/^tx:/, ''))}`)}><ArrowUpRight size={14} /> Open investigation</Button>}
              {selectedNode.type !== 'transaction' && <Button variant="outline" onClick={() => void expandNetworkNode(selectedNode)} disabled={followBusy === selectedNode.id}>{followBusy === selectedNode.id ? <Loader2 size={14} className="animate-spin" /> : <><Network size={14} /> Expand relationships</>}</Button>}
            </> : <div className="graph-details-empty"><Waypoints size={24} /><strong>{mode === 'heuristic-trace' ? 'No transaction selected' : 'Select a network node'}</strong><span>{mode === 'heuristic-trace' ? 'Search a TXID above to inspect inputs and outputs.' : 'Click a transaction, wallet, or IP to review its real evidence.'}</span></div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
