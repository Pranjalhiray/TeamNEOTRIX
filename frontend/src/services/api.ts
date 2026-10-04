import type {
  Transaction,
  Wallet,
  OverviewStats,
  Alert,
  GraphData,
  ClusterMetrics,
  AnomalyMetrics,
  PatternMetrics,
  RiskMetrics,
  SHAPExplanation,
  SHAPGlobal,
  PaginatedResponse,
  SupervisedAnomalyMetrics,
  RiskDistributionBin,
  IngestionResult,
  IngestionSession,
  TransactionTrace,
} from '../types';

// In production the API and dashboard share one local origin. Vite proxies the
// same paths during development, so the browser never needs a hard-coded host.
const API_BASE = '';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (typeof payload.detail === 'string') detail = payload.detail;
      else if (typeof payload.message === 'string') detail = payload.message;
    } catch {
      // Keep the readable HTTP status when the server has no JSON error body.
    }
    throw new Error(detail);
  }

  return response.json();
}

export const api = {
  system: {
    getHealth: () => fetchAPI<{ status: string; artifacts_loaded: boolean }>('/health'),
  },

  overview: {
    getStats: () => fetchAPI<OverviewStats>('/api/overview/stats'),
    getCorrelatedSample: (limit = 15) => fetchAPI<Transaction[]>(`/api/overview/correlated-sample?limit=${limit}`),
    getPatternComposition: () => fetchAPI<Array<{ pattern_type: string; count: number }>>('/api/overview/pattern-composition'),
    getIllicitVsLicit: () => fetchAPI<Array<{ label: string; count: number }>>('/api/overview/illicit-vs-licit'),
    getFocusAreas: () => fetchAPI<Array<{ focus_area: string; method: string; headline_metric: string }>>('/api/overview/focus-areas'),
  },

  investigate: {
    getTransaction: (txid: string) => fetchAPI<Transaction>(`/api/investigate/transaction/${encodeURIComponent(txid)}`),
    getWallet: (address: string) => fetchAPI<Wallet>(`/api/investigate/wallet/${encodeURIComponent(address)}`),
    getTransactionGraph: (txid: string) => fetchAPI<GraphData>(`/api/investigate/transaction/${encodeURIComponent(txid)}/graph`),
    getSHAPExplanation: (txid: string) => fetchAPI<SHAPExplanation>(`/api/investigate/transaction/${encodeURIComponent(txid)}/shap`),
  },

  alerts: {
    getRanked: (params: { top_n?: number; pattern_filter?: string[] } = {}) => {
      const searchParams = new URLSearchParams();
      if (params.top_n) searchParams.set('top_n', params.top_n.toString());
      if (params.pattern_filter?.length) searchParams.set('pattern_filter', params.pattern_filter.join(','));
      return fetchAPI<PaginatedResponse<Alert>>(`/api/alerts/ranked?${searchParams.toString()}`);
    },
    downloadCSV: (params: { top_n?: number; pattern_filter?: string[] } = {}) => {
      const searchParams = new URLSearchParams();
      if (params.top_n) searchParams.set('top_n', params.top_n.toString());
      if (params.pattern_filter?.length) searchParams.set('pattern_filter', params.pattern_filter.join(','));
      return fetch(`/api/alerts/download?${searchParams.toString()}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to download alerts (${response.status}).`);
        return response;
      });
    },
  },

  clusters: {
    getMetrics: () => fetchAPI<ClusterMetrics>('/api/clusters/metrics'),
    getEmbeddings: (sample = 4000) => fetchAPI<Wallet[]>(`/api/clusters/embeddings?sample=${sample}`),
    getCluster: (clusterId: number) => fetchAPI<Wallet[]>(`/api/clusters/${clusterId}`),
    getClusterIds: () => fetchAPI<number[]>('/api/clusters/ids'),
  },

  graph: {
    getLinkAnalysis: (topK = 60) => fetchAPI<GraphData>(`/api/graph/link-analysis?top_k=${topK}`),
    getTrace: (txid: string) => fetchAPI<TransactionTrace>(`/api/graph/trace/${encodeURIComponent(txid)}`),
    expandNode: (nodeId: string, topK = 10) => {
      const params = new URLSearchParams({ node_id: nodeId, top_k: String(topK) });
      return fetchAPI<GraphData>(`/api/graph/expand?${params.toString()}`);
    },
  },

  performance: {
    getAnomalyMetrics: () => fetchAPI<AnomalyMetrics>('/api/performance/anomaly'),
    getSupervisedAnomalyMetrics: () => fetchAPI<SupervisedAnomalyMetrics>('/api/performance/anomaly/supervised'),
    getPatternMetrics: () => fetchAPI<PatternMetrics>('/api/performance/pattern'),
    getRiskMetrics: () => fetchAPI<RiskMetrics>('/api/performance/risk'),
    getEnsembleAUC: () => fetchAPI<{ ensemble_auc: number }>('/api/performance/ensemble'),
    getRiskDistribution: () => fetchAPI<RiskDistributionBin[]>('/api/performance/risk-distribution'),
    getSHAPGlobal: () => fetchAPI<SHAPGlobal[]>('/api/performance/shap-global'),
  },

  ingestion: {
    analyze: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return fetchAPI<IngestionResult>('/api/ingestion/analyze', { method: 'POST', body: form });
    },
    getSession: () => fetchAPI<IngestionSession>('/api/ingestion/session'),
    getAlerts: (limit = 100) => fetchAPI<Alert[]>(`/api/ingestion/alerts?limit=${limit}`),
    getGraph: (topK = 20) => fetchAPI<GraphData>(`/api/ingestion/graph?top_k=${topK}`),
    clearSession: () => fetchAPI<{ active: boolean }>('/api/ingestion/session', { method: 'DELETE' }),
  },
};
