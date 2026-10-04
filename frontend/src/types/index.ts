export interface Transaction {
  txid: string;
  timestamp: number | string | null;
  src_ip: string | null;
  src_port: number | null;
  dst_ip?: string | null;
  dst_port?: number | null;
  script_type?: string | null;
  geo_country: string | null;
  asn?: number | string | null;
  asn_owner: string | null;
  num_inputs: number;
  num_outputs: number;
  total_input_btc: number;
  total_output_btc: number;
  fee_btc: number;
  fee_rate: number;
  avg_input_amount: number;
  avg_output_amount: number;
  io_ratio: number;
  value_retained_frac: number;
  is_round_output: number;
  log_total_input: number;
  asn_geo_diversity: number;
  src_ip_tx_count: number;
  pattern_type: string;
  is_illicit: number | null;
  is_anomaly: number;
  anomaly_score: number;
  anomaly_score_n: number;
  propagated_risk: number;
  propagated_risk_n: number;
  illicit_proba: number;
  illicit_proba_n: number;
  risk_score: number;
  confidence_pct: number;
  pattern_pred: string;
  in_peeling_chain: boolean;
  reason: string;
  input_address?: string;
  input_amount?: number;
  input_addresses?: string[];
  input_amounts?: Array<number | null>;
  output_addresses?: string[];
  output_amounts?: Array<number | null>;
  evidence?: {
    signals: Array<{ model: string; finding: string; score: number }>;
    network?: Record<string, unknown>;
    transaction?: Record<string, unknown>;
    input_addresses?: string[];
    input_amounts?: Array<number | null>;
    output_addresses?: string[];
    output_amounts?: Array<number | null>;
  };
  peeling_chain?: string[];
  transaction_features?: Record<string, unknown>;
  risk_evidence_signals?: Array<{ model?: string; finding?: string; score?: number | null; weight?: number | null; contribution?: number | null }>;
}

export interface Wallet {
  address: string;
  entity_id: number;
  entity_type: string;
  is_illicit: number | null;
  propagated_risk: number;
  predicted_entity_cluster?: number;
  common_input_cluster?: number;
  embedding_cluster?: number;
  pc1?: number;
  pc2?: number;
  true_entity?: number;
  transaction_count?: number;
  related_txids?: string[];
  related_transactions?: Array<Pick<Alert, 'txid' | 'risk_score' | 'confidence_pct' | 'pattern_pred' | 'reason'>>;
  note?: string;
}

export interface ClusterMetrics {
  embedding_nmi: number;
  embedding_ari: number;
  embedding_homogeneity: number;
  embedding_completeness: number;
  embedding_v_measure: number;
  common_input_nmi: number;
  common_input_ari: number;
}

export interface AnomalyMetrics {
  roc_auc: number;
  pr_auc: number;
  roc_curve: [number[], number[]];
  pr_curve: [number[], number[]];
  xgb_roc_auc?: number;
  xgb_pr_auc?: number;
  lgb_roc_auc?: number;
  lgb_pr_auc?: number;
  rf_roc_auc?: number;
  rf_pr_auc?: number;
  ensemble_roc_auc?: number;
  ensemble_pr_auc?: number;
  iso_roc_auc?: number;
  iso_pr_auc?: number;
  cal_roc_auc?: number;
  cal_pr_auc?: number;
  feature_importance?: Record<string, number>;
  threshold_analysis?: Array<{ threshold: number; flagged: number; precision: number }>;
  precision_at_k?: Array<{ k: number; precision: number; recall: number }>;
}

export interface SupervisedAnomalyMetrics {
  ensemble_roc_auc: number;
  ensemble_pr_auc: number;
  xgb_roc_auc: number;
  xgb_pr_auc: number;
  lgb_roc_auc: number;
  lgb_pr_auc: number;
  rf_roc_auc: number;
  rf_pr_auc: number;
  iso_roc_auc: number;
  iso_pr_auc: number;
  cal_roc_auc: number;
  cal_pr_auc: number;
  ensemble_roc_curve: [number[], number[]];
  ensemble_pr_curve: [number[], number[]];
  feature_importance: Record<string, number>;
  threshold_analysis: Array<{ threshold: number; flagged: number; precision: number }>;
  precision_at_k: Array<{ k: number; precision: number; recall: number }>;
}

export interface PatternMetrics {
  report: Record<string, Record<string, number>>;
  confusion_matrix: number[][];
  classes: string[];
  feature_importance: Record<string, number>;
}

export interface RiskMetrics {
  tx_level_auc: number;
  wallet_level_auc: number;
  wallet_level_ap: number;
}

export interface RiskDistributionBin {
  bin: string;
  licit: number;
  illicit: number;
}

export interface OverviewStats {
  transactions_analyzed: number;
  wallets_tracked: number;
  seed_illicit_wallets: number | null;
  peeling_chains_found: number | null;
  ensemble_auc: number | null;
  wallet_data_available?: boolean;
  flow_data_available?: boolean;
  seed_wallet_data_available?: boolean;
  ground_truth_available?: boolean;
  dataset_mode?: 'import' | 'reference';
}

export interface Alert {
  txid: string;
  timestamp?: number | string | null;
  src_ip?: string | null;
  src_port?: number | null;
  dst_ip?: string | null;
  dst_port?: number | null;
  input_addresses?: string[];
  output_addresses?: string[];
  num_inputs?: number;
  num_outputs?: number;
  fee_btc?: number;
  confidence_pct: number;
  pattern_pred: string;
  is_illicit: number | null;
  reason: string;
  anomaly_score?: number;
  propagated_risk?: number;
  illicit_proba?: number;
  risk_score?: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type?: 'transaction' | 'wallet' | 'ip' | 'endpoint' | string;
  risk: number;
  highlighted: boolean;
  details?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind?: string;
  label?: string;
  details?: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TraceInput {
  index: number;
  address: string;
  amount_btc: number | null;
  previous_txid: string | null;
  linkage_basis: string | null;
  linkage_inferred: boolean;
}

export interface TraceOutput {
  index: number;
  address: string;
  amount_btc: number | null;
  spent_by_txid: string | null;
  linkage_basis: string | null;
  linkage_inferred: boolean;
  likely_change: boolean;
  change_signals: string[];
}

export interface TransactionTrace {
  txid: string;
  transaction: Partial<Transaction> & { txid: string; block?: string | number | null; risk_evidence?: string | null };
  inputs: TraceInput[];
  outputs: TraceOutput[];
  heuristics: {
    common_input_applicable: boolean;
    common_ownership_node_id: string | null;
    common_input_note: string;
    change_note: string;
  };
  graph: GraphData;
}

export interface SHAPContribution {
  feature: string;
  value: number;
  shap_value: number;
}

export interface SHAPExplanation {
  predicted_class: string;
  contributions: SHAPContribution[];
}

export interface SHAPGlobal {
  feature: string;
  importance: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  filtered: number;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface IngestionSummary {
  source_rows: number;
  transactions_analyzed: number;
  wallets_correlated: number;
  ip_addresses_observed: number;
  input_address_links: number;
  output_address_links: number;
  flow_links_inferred: number;
  peeling_chain_count: number;
  prioritized_leads: number;
  pattern_distribution: Record<string, number>;
  missing_fields: string[];
  warnings: string[];
  score_method: string;
  geoip_enriched: number;
}

export interface IngestionResult {
  filename: string;
  summary: IngestionSummary;
  sample: Transaction[];
  top_alerts: Alert[];
}

export interface IngestionSession {
  active: boolean;
  filename: string | null;
  summary: IngestionSummary | null;
}
