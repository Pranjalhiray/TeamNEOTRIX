import { useDeferredValue, useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { Download, LocateFixed, Minus, Plus, RotateCcw, Tags } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { GraphData, GraphNode } from '../../types';

export type GraphMode = 'risk-network' | 'heuristic-trace' | 'neighborhood';
type EdgeWeightMode = 'amount' | 'risk' | 'connections';

const COMMUNITY_COLORS = ['#fb7185', '#fb923c', '#22d3ee', '#a78bfa', '#a3e635', '#f472b6', '#38bdf8', '#facc15', '#34d399', '#c084fc'];

function communityColorMap(data: GraphData) {
  const adjacency = new Map(data.nodes.map((node) => [node.id, [] as string[]]));
  const degrees = new Map(data.nodes.map((node) => [node.id, 0]));
  data.edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  });

  // A small local modularity pass keeps densely connected groups visually distinct,
  // even when a few bridge transactions connect the whole network.
  const labels = new Map(data.nodes.map((node, index) => [node.id, index]));
  const totals = new Map(data.nodes.map((node, index) => [index, degrees.get(node.id) || 0]));
  const edgeCount = Math.max(1, data.edges.filter((edge) => adjacency.has(edge.source) && adjacency.has(edge.target)).length);
  for (let pass = 0; pass < 18; pass += 1) {
    let moved = false;
    data.nodes.forEach((node) => {
      const degree = degrees.get(node.id) || 0;
      if (!degree) return;
      const currentLabel = labels.get(node.id)!;
      totals.set(currentLabel, (totals.get(currentLabel) || 0) - degree);
      const linksByLabel = new Map<number, number>();
      adjacency.get(node.id)?.forEach((neighbor) => {
        const label = labels.get(neighbor)!;
        linksByLabel.set(label, (linksByLabel.get(label) || 0) + 1);
      });
      linksByLabel.set(currentLabel, linksByLabel.get(currentLabel) || 0);
      let bestLabel = currentLabel;
      let bestScore = Number.NEGATIVE_INFINITY;
      linksByLabel.forEach((links, candidate) => {
        const score = links - (degree * (totals.get(candidate) || 0)) / (2 * edgeCount);
        if (score > bestScore || (score === bestScore && candidate < bestLabel)) {
          bestLabel = candidate;
          bestScore = score;
        }
      });
      labels.set(node.id, bestLabel);
      totals.set(bestLabel, (totals.get(bestLabel) || 0) + degree);
      if (bestLabel !== currentLabel) moved = true;
    });
    if (!moved) break;
  }

  const communityOrder = [...new Set(labels.values())].sort((left, right) => left - right);
  const palette = new Map(communityOrder.map((label, index) => [label, COMMUNITY_COLORS[index % COMMUNITY_COLORS.length]]));
  return new Map(data.nodes.map((node) => [node.id, palette.get(labels.get(node.id)!) || COMMUNITY_COLORS[0]]));
}

function mixColor(start: string, end: string, amount: number) {
  const t = Math.max(0, Math.min(1, amount));
  const from = start.match(/[\da-f]{2}/gi)?.map((part) => parseInt(part, 16)) || [0, 0, 0];
  const to = end.match(/[\da-f]{2}/gi)?.map((part) => parseInt(part, 16)) || [255, 255, 255];
  const channels = from.map((value, index) => Math.round(value + ((to[index] ?? 255) - value) * t));
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

interface CytoscapeGraphProps {
  data: GraphData | null;
  height?: string;
  className?: string;
  onNodeClick?: (node: GraphNode) => void;
  highlightedNodes?: Set<string>;
  mode?: GraphMode;
  initialLayout?: GraphMode;
  showSearch?: boolean;
  showLegend?: boolean;
  showWeightControl?: boolean;
}

function tracePositions(cy: cytoscape.Core) {
  const positions = new Map<string, { x: number; y: number }>();
  const root = cy.nodes('[?highlighted]').first();
  const stageRoot = cy.nodes().filter((node) => node.data('details')?.trace_stage === 'current').first();
  const centerId = root.length ? root.id() : stageRoot.id();
  const center = centerId ? cy.getElementById(centerId) : cy.nodes().first();
  const txNodes = cy.nodes('[type = "transaction"]');
  const depthOf = (node: cytoscape.NodeSingular) => Number(node.data('details')?.trace_depth || 0);
  const upstream = txNodes.filter((node) => node.id() !== center.id() && (depthOf(node) < 0 || node.data('details')?.trace_stage === 'upstream'));
  const downstream = txNodes.filter((node) => node.id() !== center.id() && (depthOf(node) > 0 || node.data('details')?.trace_stage === 'downstream'));
  const free = txNodes.filter((node) => node.id() !== center.id() && !upstream.contains(node) && !downstream.contains(node));
  const inputNodes = cy.nodes().filter((node) => node.data('type') === 'wallet' && node.data('details')?.trace_stage === 'input');
  const outputNodes = cy.nodes().filter((node) => node.data('type') === 'wallet' && node.data('details')?.trace_stage === 'output');
  const largestRow = Math.max(upstream.length, downstream.length, free.length, inputNodes.length, outputNodes.length);
  const rowGap = largestRow > 1 ? Math.max(24, Math.min(68, (cy.height() - 180) / (largestRow - 1))) : 68;
  const rowPositions = (nodes: cytoscape.NodeCollection, xFor: (node: cytoscape.NodeSingular) => number, offset = 0) => {
    const sorted = nodes.toArray().sort((a, b) => depthOf(a) - depthOf(b) || a.id().localeCompare(b.id()));
    sorted.forEach((node, index) => {
      const y = (index - (sorted.length - 1) / 2) * rowGap + offset;
      positions.set(node.id(), { x: xFor(node), y });
    });
  };
  positions.set(center.id(), { x: 0, y: 0 });
  rowPositions(upstream, (node) => -Math.max(1, Math.abs(depthOf(node))) * 310, -10);
  rowPositions(downstream, (node) => Math.max(1, Math.abs(depthOf(node))) * 310, 10);
  rowPositions(free, (node) => node.data('details')?.trace_stage === 'upstream' ? -310 : 310);

  rowPositions(inputNodes, () => -145, -5);
  rowPositions(outputNodes, () => 145, 5);
  const ownerNodes = cy.nodes('[type = "ownership"]');
  rowPositions(ownerNodes, () => 0, 230);
  const otherNodes = cy.nodes().filter((node) => !positions.has(node.id()));
  rowPositions(otherNodes, () => 0, 310);
  return positions;
}

function applyLayout(cy: cytoscape.Core, mode: GraphMode, animate = true, randomize = false) {
  if (mode === 'heuristic-trace') {
    const positions = tracePositions(cy);
    cy.layout({ name: 'preset', positions: (node: cytoscape.NodeSingular) => positions.get(node.id()) || node.position(), fit: true, padding: 75, animate, animationDuration: 380 } as cytoscape.LayoutOptions).run();
    return;
  }
  if (mode === 'neighborhood') {
    cy.layout({
      name: 'concentric', fit: true, padding: 65, animate,
      startAngle: -Math.PI / 2, clockwise: true, minNodeSpacing: 38,
      concentric: (node: cytoscape.NodeSingular) => Number(node.data('risk')) * 100 + node.degree(),
      levelWidth: () => 2,
    } as cytoscape.LayoutOptions).run();
    return;
  }
  cy.layout({
    name: 'cose', fit: true, padding: 70, animate, randomize,
    nodeRepulsion: (node: cytoscape.NodeSingular) => 6500 + Number(node.data('size')) * 360,
    idealEdgeLength: (edge: cytoscape.EdgeSingular) => 115 - Number(edge.data('weight')) * 34,
    edgeElasticity: 95, nestingFactor: 0.1, gravity: 0.17, numIter: 500,
    initialTemp: 170, coolingFactor: 0.96, minTemp: 1,
  } as cytoscape.LayoutOptions).run();
}

function edgeId(edge: GraphData['edges'][number]) {
  return `edge:${encodeURIComponent([edge.source, edge.target, edge.kind || '', edge.label || '', String(edge.details?.amount ?? '')].join('|'))}`;
}

function nodeElement(node: GraphNode, degree: number, communityColor: string) {
  const details = node.details || {};
  const features = details.transaction_features as Record<string, unknown> | undefined;
  const btc = Math.max(0, Number(features?.total_input_btc ?? details.total_input_btc ?? details.amount_btc) || 0);
  const size = Math.max(13, Math.min(52, 14 + Math.max(0, node.risk) * 16 + Math.min(18, degree * 2.1) + Math.min(9, Math.log1p(btc) * 2.2)));
  return { data: {
    id: node.id, label: node.label, type: node.type || 'transaction', details,
    risk: Math.max(0, Math.min(1, node.risk)), size, degree,
    communityColor, labelByDefault: degree >= 4 || node.risk >= 0.7 || Boolean(node.highlighted),
    likelyChange: Boolean(details.likely_change),
    riskBand: node.risk >= 0.7 ? 'high' : node.risk >= 0.35 ? 'medium' : 'low',
    highlighted: Boolean(node.highlighted),
  } };
}

function edgeElement(edge: GraphData['edges'][number], communityColor: string) {
  return { data: {
    id: edgeId(edge), source: edge.source, target: edge.target,
    kind: edge.kind || 'related', label: edge.label || '',
    amount: Math.max(0, Number(edge.details?.amount) || 0),
    risk: Math.max(0, Number(edge.details?.risk) || 0), weight: 0, riskWeight: 0,
    communityColor, edgeColor: communityColor,
    inferred: Boolean(edge.details?.inferred), details: edge.details || {},
  } };
}

function applyEdgeWeights(cy: cytoscape.Core, mode: EdgeWeightMode) {
  const amounts = cy.edges().map((edge) => Math.max(0, Number(edge.data('amount')) || 0));
  const maxAmount = Math.max(0, ...amounts);
  const denominator = Math.log1p(maxAmount) || 1;
  const maxDegree = Math.max(1, ...cy.nodes().map((node) => node.degree()));
  cy.edges().forEach((edge) => {
    const amountWeight = Math.log1p(Math.max(0, Number(edge.data('amount')) || 0)) / denominator;
    const riskWeight = Math.max(Number(edge.source().data('risk')) || 0, Number(edge.target().data('risk')) || 0);
    const connectionWeight = Math.max(edge.source().degree(), edge.target().degree()) / maxDegree;
    edge.data('weight', mode === 'amount' ? amountWeight : mode === 'risk' ? riskWeight : connectionWeight);
    edge.data('riskWeight', riskWeight);
    const communityColor = String(edge.data('communityColor') || '#94a3b8');
    const edgeColor = mode === 'risk'
      ? mixColor('#38bdf8', '#fb7185', riskWeight)
      : mode === 'connections'
        ? mixColor('#818cf8', '#22d3ee', connectionWeight)
        : communityColor;
    edge.data('edgeColor', edgeColor);
  });
}

export function CytoscapeGraph({ data, height = '550px', className, onNodeClick, highlightedNodes, mode, initialLayout = 'risk-network', showSearch = true, showLegend = true, showWeightControl = true }: CytoscapeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<cytoscape.Core | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const [showLabels, setShowLabels] = useState(false);
  const [edgeWeightMode, setEdgeWeightMode] = useState<EdgeWeightMode>('amount');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase());
  const lastAppliedDataRef = useRef<GraphData | null>(null);
  const activeMode = mode || initialLayout;

  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);

  useEffect(() => {
    if (!containerRef.current || !data) return;
    const validIds = new Set(data.nodes.map((node) => node.id));
    const degrees = new Map<string, number>();
    data.edges.forEach((edge) => {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
    });
    const communityColors = communityColorMap(data);
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map((node) => nodeElement(node, degrees.get(node.id) || 0, communityColors.get(node.id) || COMMUNITY_COLORS[0])),
        ...data.edges.filter((edge) => validIds.has(edge.source) && validIds.has(edge.target)).map((edge) => edgeElement(edge, communityColors.get(edge.source) || COMMUNITY_COLORS[0])),
      ],
      style: [
        { selector: 'node', style: {
          label: '', color: '#f8fafc', 'font-size': 10, 'font-family': 'system-ui, sans-serif',
          'text-outline-width': 3, 'text-outline-color': '#05070c', 'text-valign': 'bottom', 'text-margin-y': 6,
          width: 'data(size)', height: 'data(size)', 'background-color': 'data(communityColor)',
          'border-width': 1.5, 'border-color': '#94a3b8', 'overlay-padding': 5, 'z-index': 2,
          'transition-property': 'background-color, border-color, opacity, width, height', 'transition-duration': 160,
        } },
        { selector: 'node[type = "wallet"]', style: { shape: 'round-rectangle' } },
        { selector: 'node[type = "ip"]', style: { shape: 'hexagon' } },
        { selector: 'node[type = "endpoint"]', style: { shape: 'triangle' } },
        { selector: 'node[type = "ownership"]', style: { shape: 'diamond', width: 24, height: 24 } },
        { selector: 'node[riskBand = "low"]', style: { 'border-color': '#4ade80', 'border-width': 1.5 } },
        { selector: 'node[riskBand = "medium"]', style: { 'border-color': '#fbbf24', 'border-width': 2.25 } },
        { selector: 'node[riskBand = "high"]', style: { 'border-color': '#fb7185', 'border-width': 3 } },
        { selector: 'node[?likelyChange]', style: { 'border-width': 3, 'border-color': '#fbbf24' } },
        { selector: 'node[?labelByDefault]', style: { label: 'data(label)' } },
        { selector: 'node[?highlighted]', style: { label: 'data(label)', 'border-width': 4, 'border-color': '#ffffff', 'z-index': 100 } },
        { selector: 'node.label-visible', style: { label: 'data(label)' } },
        { selector: 'node.user-highlighted', style: { 'border-width': 3, 'border-color': '#2563eb', 'z-index': 90 } },
        { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f8fafc', 'z-index': 110 } },
        { selector: 'node.search-dim', style: { opacity: 0.12 } },
        { selector: 'edge', style: {
          width: 'mapData(weight, 0, 1, 1, 5.5)',
          'line-color': 'data(edgeColor)',
          'target-arrow-color': 'data(edgeColor)',
          'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
          'curve-style': 'bezier', opacity: 0.76, label: 'data(label)', color: '#dbeafe',
          'font-size': 7, 'font-family': 'system-ui, sans-serif', 'text-outline-width': 2,
          'text-outline-color': '#05070c', 'text-rotation': 'autorotate', 'z-index': 1,
        } },
        { selector: 'edge[kind = "broadcast"], edge[kind = "peer"]', style: { 'line-style': 'dashed', opacity: 0.55 } },
        { selector: 'edge[kind = "heuristic"]', style: { 'line-style': 'dotted', opacity: 0.9, 'line-color': '#c084fc', 'target-arrow-color': '#c084fc', 'target-arrow-shape': 'none', width: 1.8 } },
        { selector: 'edge[?inferred]', style: { 'line-style': 'dashed', opacity: 0.58 } },
        { selector: 'edge.search-dim', style: { opacity: 0.06 } },
        { selector: ':selected', style: { label: 'data(label)', 'border-width': 4, 'border-color': '#ffffff' } },
      ],
      layout: { name: 'preset', fit: true },
      minZoom: 0.18, maxZoom: 3.2, pixelRatio: 'auto',
    });

    graphRef.current = cy;
    lastAppliedDataRef.current = data;
    applyEdgeWeights(cy, edgeWeightMode);
    applyLayout(cy, activeMode, false, true);
    cy.on('tap', 'node', (event) => {
      const selected = event.target;
      cy.nodes().unselect();
      selected.select();
      onNodeClickRef.current?.({ id: selected.id(), label: selected.data('label'), risk: selected.data('risk'), highlighted: selected.data('highlighted'), type: selected.data('type'), details: selected.data('details') });
    });
    cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      if (containerRef.current) containerRef.current.title = `${node.data('type')} · ${node.id()} · Risk ${(Number(node.data('risk')) * 100).toFixed(1)}%`;
    });
    cy.on('tap', (event) => { if (event.target === cy) cy.elements().unselect(); });
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); cy.destroy(); graphRef.current = null; };
  }, [Boolean(data)]);

  useEffect(() => {
    const cy = graphRef.current;
    if (!cy || !data || data === lastAppliedDataRef.current) return;
    const ids = new Set(data.nodes.map((node) => node.id));
    cy.batch(() => {
      cy.elements().remove();
      const degrees = new Map<string, number>();
      data.edges.forEach((edge) => {
        degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
        degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
      });
      const communityColors = communityColorMap(data);
      data.nodes.forEach((node) => cy.add(nodeElement(node, degrees.get(node.id) || 0, communityColors.get(node.id) || COMMUNITY_COLORS[0])));
      data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).forEach((edge) => cy.add({ group: 'edges', data: edgeElement(edge, communityColors.get(edge.source) || COMMUNITY_COLORS[0]).data }));
    });
    lastAppliedDataRef.current = data;
    applyEdgeWeights(cy, edgeWeightMode);
    applyLayout(cy, activeMode, true, false);
  }, [data]);

  useEffect(() => { if (graphRef.current) applyLayout(graphRef.current, activeMode, true, false); }, [activeMode]);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !highlightedNodes) return;
    graph.nodes().forEach((node) => { node.toggleClass('user-highlighted', highlightedNodes.has(node.id())); });
  }, [highlightedNodes, data]);
  useEffect(() => {
    graphRef.current?.nodes().forEach((node) => { node.toggleClass('label-visible', showLabels); });
  }, [showLabels, data]);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const matches = new Set<string>();
    graph.nodes().forEach((node) => {
      const found = !deferredSearch || node.id().toLowerCase().includes(deferredSearch) || String(node.data('label')).toLowerCase().includes(deferredSearch);
      if (found) matches.add(node.id());
      node.toggleClass('search-match', Boolean(deferredSearch && found));
      node.toggleClass('search-dim', Boolean(deferredSearch && !found));
    });
    graph.edges().forEach((edge) => { edge.toggleClass('search-dim', Boolean(deferredSearch && !matches.has(edge.source().id()) && !matches.has(edge.target().id()))); });
  }, [deferredSearch, data]);
  useEffect(() => { if (graphRef.current) applyEdgeWeights(graphRef.current, edgeWeightMode); }, [edgeWeightMode, data]);

  const adjustZoom = (factor: number) => {
    const graph = graphRef.current;
    if (graph) graph.zoom({ level: graph.zoom() * factor, renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } });
  };
  const fitNetwork = () => {
    const graph = graphRef.current;
    if (!graph) return;
    const selected = graph.nodes(':selected');
    graph.fit(selected.length ? selected : graph.elements(), selected.length ? 150 : 55);
  };
  const recenter = () => {
    const graph = graphRef.current;
    if (!graph) return;
    const root = graph.nodes('[?highlighted]').first();
    if (root.length) graph.center(root);
    else graph.center(graph.elements());
  };
  const rerunLayout = () => { if (graphRef.current) applyLayout(graphRef.current, activeMode, true, true); };
  const exportNetwork = () => {
    if (!graphRef.current) return;
    const link = document.createElement('a');
    link.href = graphRef.current.png({ output: 'base64uri', bg: '#030407', full: true, scale: 2 });
    link.download = `bitcoin-${activeMode}-graph.png`;
    link.click();
  };

  return (
    <div className={cn('graph-viewport relative w-full overflow-hidden', className)} style={{ height }}>
      {showSearch && <div className="graph-search-wrap">
        <span className="graph-search-icon"><Tags size={14} /></span>
        <input aria-label="Search graph entities" className="graph-search-input" placeholder="Find a transaction…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        {deferredSearch && <span className="graph-match-count">{graphRef.current?.nodes().filter((node) => node.id().toLowerCase().includes(deferredSearch)).length ?? 0} found</span>}
      </div>}
      {showLegend && <div className="graph-legend" aria-label="Graph node and risk legend">
        <span><i className="legend-dot legend-dot-low" />Low risk</span><span><i className="legend-dot legend-dot-medium" />Elevated</span><span><i className="legend-dot legend-dot-high" />High risk</span>
        <span><i className="legend-shape legend-shape-wallet" />Wallet</span><span><i className="legend-shape legend-shape-ip" />IP</span><span><i className="legend-shape legend-shape-transaction" />Transaction</span>
        <span><i className="legend-community" />Community</span>
        {activeMode === 'heuristic-trace' && <><span><i className="legend-flow-arrow" />BTC flow</span><span><i className="legend-heuristic-mark" />Ownership heuristic</span></>}
      </div>}
      <div className="graph-toolbar" aria-label="Graph controls">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => adjustZoom(1.2)}><Plus size={16} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => adjustZoom(0.82)}><Minus size={16} /></button>
        <span className="graph-toolbar-divider" />
        <button type="button" aria-label={showLabels ? 'Show key graph labels' : 'Show all graph labels'} title={showLabels ? 'Show key labels only' : 'Show all labels'} onClick={() => setShowLabels((value) => !value)} className={showLabels ? 'graph-tool-active' : ''}><Tags size={16} /></button>
        {showWeightControl && <select className="graph-layout-select graph-weight-select" aria-label="Graph edge weighting" title="Choose what edge width and color represent" value={edgeWeightMode} onChange={(event) => setEdgeWeightMode(event.target.value as EdgeWeightMode)}>
          <option value="amount">Weight: amount</option><option value="risk">Weight: risk</option><option value="connections">Weight: connections</option>
        </select>}
        <button type="button" aria-label="Fit graph to view" title="Fit graph" onClick={fitNetwork}><LocateFixed size={16} /></button>
        <button type="button" aria-label="Center investigation" title="Center selected transaction" onClick={recenter}><span className="graph-layout-icon">⊙</span></button>
        <button type="button" aria-label="Reorganize graph" title="Reorganize graph" onClick={rerunLayout}><RotateCcw size={15} /></button>
        <button type="button" aria-label="Save graph as image" title="Export graph image" onClick={exportNetwork}><Download size={16} /></button>
      </div>
      <div ref={containerRef} className="graph-canvas" role="img" aria-label={activeMode === 'heuristic-trace' ? 'Interactive transaction input and output trace' : 'Interactive risk relationship network'} />
      {(!data || data.nodes.length === 0) && <div className="graph-empty-state">No network is available for this selection.</div>}
    </div>
  );
}
