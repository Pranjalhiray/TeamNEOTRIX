"""Ingestion, graph building, ML models and alert fusion."""
from pathlib import Path

import numpy as np
import pandas as pd
import networkx as nx
from scipy.sparse import coo_matrix
import duckdb
import shap

from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import TruncatedSVD, PCA
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    adjusted_rand_score, normalized_mutual_info_score, homogeneity_completeness_v_measure,
    roc_auc_score, average_precision_score, classification_report, confusion_matrix,
    roc_curve, precision_recall_curve,
)

NUM_COLS = ["num_inputs", "num_outputs", "total_input_btc", "total_output_btc", "fee_btc",
            "fee_rate", "avg_input_amount", "avg_output_amount", "io_ratio",
            "value_retained_frac", "is_round_output", "log_total_input",
            "asn_geo_diversity", "src_ip_tx_count"]


def load_data(data_dir: str | Path) -> dict:
    """Load all tables with pandas."""
    data_dir = Path(data_dir)
    tables = {
        "transactions": pd.read_csv(data_dir / "transactions.csv"),
        "tx_inputs": pd.read_csv(data_dir / "tx_inputs.csv"),
        "tx_outputs": pd.read_csv(data_dir / "tx_outputs.csv"),
        "tx_edges": pd.read_csv(data_dir / "tx_edges.csv"),
        "wallets": pd.read_csv(data_dir / "wallets.csv"),
        "entities": pd.read_csv(data_dir / "entities.csv"),
        "labels": pd.read_csv(data_dir / "labels.csv"),
        "features": pd.read_csv(data_dir / "features.csv"),
        "seed_illicit": pd.read_csv(data_dir / "seed_illicit_wallets.csv"),
    }
    return tables


def load_data_duckdb(data_dir: str | Path) -> dict:
    """Load all tables through DuckDB and build a network/blockchain correlated sample."""
    data_dir = Path(data_dir)
    con = duckdb.connect(database=":memory:")

    def q(sql):
        return con.execute(sql).df()

    tables = {
        "transactions": q(f"SELECT * FROM read_csv_auto('{data_dir}/transactions.csv')"),
        "tx_inputs": q(f"SELECT * FROM read_csv_auto('{data_dir}/tx_inputs.csv')"),
        "tx_outputs": q(f"SELECT * FROM read_csv_auto('{data_dir}/tx_outputs.csv')"),
        "tx_edges": q(f"SELECT * FROM read_csv_auto('{data_dir}/tx_edges.csv')"),
        "wallets": q(f"SELECT * FROM read_csv_auto('{data_dir}/wallets.csv')"),
        "entities": q(f"SELECT * FROM read_csv_auto('{data_dir}/entities.csv')"),
        "labels": q(f"SELECT * FROM read_csv_auto('{data_dir}/labels.csv')"),
        "features": q(f"SELECT * FROM read_csv_auto('{data_dir}/features.csv')"),
        "seed_illicit": q(f"SELECT * FROM read_csv_auto('{data_dir}/seed_illicit_wallets.csv')"),
    }

    tables["correlated_sample"] = q(f"""
        SELECT t.txid, t.timestamp, t.src_ip, t.src_port, t.geo_country, t.asn_owner,
               i.address AS input_address, i.amount_btc AS input_amount,
               l.pattern_type, l.is_illicit
        FROM read_csv_auto('{data_dir}/transactions.csv') t
        JOIN read_csv_auto('{data_dir}/tx_inputs.csv') i USING (txid)
        JOIN read_csv_auto('{data_dir}/labels.csv') l USING (txid)
        ORDER BY t.timestamp
        LIMIT 200
    """)

    con.close()
    return tables


def enrich_geoip(transactions: pd.DataFrame) -> pd.DataFrame:
    """Add offline GeoIP country and ASN columns for src_ip."""
    import geoip2fast
    geo = geoip2fast.GeoIP2Fast()

    def lookup(ip):
        try:
            r = geo.lookup(ip)
            return pd.Series({"real_geo_country": r.country_code, "real_asn_name": r.asn_name})
        except Exception:
            return pd.Series({"real_geo_country": None, "real_asn_name": None})

    enriched = transactions["src_ip"].apply(lookup)
    return pd.concat([transactions, enriched], axis=1)


def build_tx_graph(labels: pd.DataFrame, tx_edges: pd.DataFrame) -> nx.DiGraph:
    """Transaction-level money-flow graph."""
    G = nx.DiGraph()
    G.add_edges_from(zip(tx_edges.src_txid, tx_edges.dst_txid))
    G.add_nodes_from(labels.txid.tolist())
    return G


def build_ip_wallet_tx_graph(transactions: pd.DataFrame, tx_inputs: pd.DataFrame,
                              tx_outputs: pd.DataFrame, max_edges: int = 200_000) -> nx.DiGraph:
    """Graph linking IPs, transactions and wallets."""
    G = nx.DiGraph()
    for _, r in transactions.iterrows():
        G.add_edge(f"ip:{r.src_ip}", f"tx:{r.txid}", kind="broadcast")
    n = 0
    for _, r in tx_inputs.iterrows():
        G.add_edge(f"tx:{r.txid}", f"wallet:{r.address}", kind="input", amount=r.amount_btc)
        n += 1
        if n >= max_edges:
            break
    n = 0
    for _, r in tx_outputs.iterrows():
        G.add_edge(f"wallet:{r.address}", f"tx:{r.txid}", kind="output", amount=r.amount_btc)
        n += 1
        if n >= max_edges:
            break
    return G


def cluster_entities(wallets: pd.DataFrame, tx_inputs: pd.DataFrame, tx_outputs: pd.DataFrame,
                      labels: pd.DataFrame, n_svd: int = 32, random_state: int = 42) -> dict:
    mixing_txids = set(labels.loc[labels.pattern_type == "mixing", "txid"])
    addr_list = wallets["address"].tolist()
    addr_idx = {a: i for i, a in enumerate(addr_list)}

    parent = list(range(len(addr_list)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    grouped = tx_inputs[~tx_inputs.txid.isin(mixing_txids)].groupby("txid")["address"].apply(list)
    for addrs in grouped:
        idxs = [addr_idx[a] for a in addrs if a in addr_idx]
        for i in range(1, len(idxs)):
            union(idxs[0], idxs[i])
    common_input_cluster = np.array([find(i) for i in range(len(addr_list))])

    tx_id_list = sorted(set(tx_inputs.txid) | set(tx_outputs.txid))
    tx_idx = {t: i for i, t in enumerate(tx_id_list)}
    rows, cols = [], []
    both = pd.concat([tx_inputs[["txid", "address"]], tx_outputs[["txid", "address"]]])
    for addr, txid in zip(both["address"], both["txid"]):
        if addr in addr_idx:
            rows.append(addr_idx[addr]); cols.append(tx_idx[txid])
    inc = coo_matrix((np.ones(len(rows)), (rows, cols)),
                      shape=(len(addr_list), len(tx_id_list))).tocsr()
    svd = TruncatedSVD(n_components=n_svd, random_state=random_state)
    addr_embeddings = svd.fit_transform(inc)

    kmeans = KMeans(n_clusters=min(3000, len(addr_list) // 2), n_init=3, random_state=random_state)
    embedding_cluster = kmeans.fit_predict(addr_embeddings)

    combo = pd.DataFrame({
        "address": addr_list,
        "common_input_cluster": common_input_cluster,
        "embedding_cluster": embedding_cluster,
        "true_entity": wallets["entity_id"].values,
        "entity_type": wallets["entity_type"].values,
        "is_illicit": wallets["is_illicit"].values,
    })
    combo["predicted_entity_cluster"] = combo.groupby(
        ["embedding_cluster", "common_input_cluster"]).ngroup()

    proj = PCA(n_components=2, random_state=random_state).fit_transform(addr_embeddings)
    combo["pc1"], combo["pc2"] = proj[:, 0], proj[:, 1]

    metrics = {
        "common_input_ari": adjusted_rand_score(combo.true_entity, common_input_cluster),
        "common_input_nmi": normalized_mutual_info_score(combo.true_entity, common_input_cluster),
        "embedding_ari": adjusted_rand_score(combo.true_entity, embedding_cluster),
        "embedding_nmi": normalized_mutual_info_score(combo.true_entity, embedding_cluster),
    }
    h, c, v = homogeneity_completeness_v_measure(combo.true_entity, embedding_cluster)
    metrics.update({"embedding_homogeneity": h, "embedding_completeness": c, "embedding_v_measure": v})

    return {"wallet_clusters": combo, "metrics": metrics}


def detect_anomalies(features: pd.DataFrame, contamination: float = 0.01,
                      random_state: int = 42) -> dict:
    f = features.copy()
    X = f[NUM_COLS].fillna(0).values
    Xs = StandardScaler().fit_transform(X)
    iso = IsolationForest(n_estimators=300, contamination=contamination,
                           random_state=random_state, n_jobs=-1)
    iso.fit(Xs)
    f["anomaly_score"] = -iso.score_samples(Xs)

    auc = roc_auc_score(f["is_anomaly"], f["anomaly_score"])
    ap = average_precision_score(f["is_anomaly"], f["anomaly_score"])
    fpr, tpr, _ = roc_curve(f["is_anomaly"], f["anomaly_score"])
    prec, rec, _ = precision_recall_curve(f["is_anomaly"], f["anomaly_score"])

    return {
        "features": f,
        "metrics": {"roc_auc": auc, "pr_auc": ap},
        "roc_curve": (fpr, tpr),
        "pr_curve": (prec, rec),
        "model": iso,
    }


def classify_patterns(features: pd.DataFrame, tx_graph: nx.DiGraph,
                       random_state: int = 42) -> dict:
    f = features.copy()
    indeg, outdeg = dict(tx_graph.in_degree()), dict(tx_graph.out_degree())
    f["graph_indeg"] = f["txid"].map(indeg).fillna(0)
    f["graph_outdeg"] = f["txid"].map(outdeg).fillna(0)
    f["out_in_ratio"] = f["graph_outdeg"] / (f["graph_indeg"] + 1)

    struct_cols = NUM_COLS + ["graph_indeg", "graph_outdeg", "out_in_ratio"]
    X = f[struct_cols].fillna(0)
    y = f["pattern_type"]

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=random_state,
                                           stratify=y)
    clf = RandomForestClassifier(n_estimators=100, max_depth=12, class_weight="balanced",
                                  random_state=random_state, n_jobs=-1)
    clf.fit(Xtr, ytr)
    pred = clf.predict(Xte)
    report = classification_report(yte, pred, output_dict=True)
    cm = confusion_matrix(yte, pred, labels=clf.classes_)

    full_proba = clf.predict_proba(X)
    classes = list(clf.classes_)
    f["illicit_proba"] = 1 - full_proba[:, classes.index("normal")]
    f["pattern_pred"] = clf.predict(X)

    imp = pd.Series(clf.feature_importances_, index=struct_cols).sort_values(ascending=False)

    explainer = shap.TreeExplainer(clf)

    return {
        "features": f,
        "model": clf,
        "classes": classes,
        "report": report,
        "confusion_matrix": cm,
        "feature_importance": imp,
        "struct_cols": struct_cols,
        "shap_explainer": explainer,
    }


def explain_with_shap(pattern_result: dict, txid: str, top_k: int = 5) -> dict:
    """SHAP attribution for one transaction's predicted class."""
    f = pattern_result["features"]
    row = f.loc[f.txid == txid]
    if row.empty:
        return {}
    struct_cols = pattern_result["struct_cols"]
    classes = pattern_result["classes"]
    X_row = row[struct_cols].fillna(0)
    pred_class = row.iloc[0]["pattern_pred"]
    class_idx = classes.index(pred_class)

    sv = pattern_result["shap_explainer"].shap_values(X_row, check_additivity=False)
    sv = np.array(sv)[0, :, class_idx]

    contrib = pd.DataFrame({
        "feature": struct_cols,
        "value": X_row.iloc[0].values,
        "shap_value": sv,
    }).sort_values("shap_value", key=abs, ascending=False).head(top_k)

    return {"predicted_class": pred_class, "contributions": contrib}


def shap_summary(pattern_result: dict, sample_txids: list) -> pd.DataFrame:
    """Mean absolute SHAP value per feature over a sample of transactions."""
    f = pattern_result["features"]
    struct_cols = pattern_result["struct_cols"]
    sample = f.loc[f.txid.isin(sample_txids), struct_cols].fillna(0)
    sv = pattern_result["shap_explainer"].shap_values(sample, check_additivity=False)
    sv = np.abs(np.array(sv)).mean(axis=(0, 2))
    return pd.Series(sv, index=struct_cols).sort_values(ascending=False)


def find_peeling_chains(tx_graph: nx.DiGraph, features: pd.DataFrame, min_length: int = 3) -> list:
    """Find multi-hop chains of 2-output transactions."""
    is_peelish = set(features.loc[features["num_outputs"] == 2, "txid"])
    visited, chains = set(), []
    for n in tx_graph.nodes():
        if n not in is_peelish or n in visited:
            continue
        if [p for p in tx_graph.predecessors(n) if p in is_peelish]:
            continue
        chain, cur = [n], n
        while True:
            succs = [s for s in tx_graph.successors(cur) if s in is_peelish]
            if len(succs) != 1 or succs[0] in visited:
                break
            cur = succs[0]
            chain.append(cur)
        if len(chain) >= min_length:
            chains.append(chain)
        visited.update(chain)
    return chains


def propagate_risk(tx_graph: nx.DiGraph, tx_inputs: pd.DataFrame, wallets: pd.DataFrame,
                    seed_illicit: pd.DataFrame, labels: pd.DataFrame,
                    direction: str = "backward", alpha: float = 0.5) -> dict:
    seed_addrs = set(seed_illicit.address)
    seed_txids = [t for t in set(tx_inputs.loc[tx_inputs.address.isin(seed_addrs), "txid"])
                  if t in tx_graph]

    graph = tx_graph.reverse() if direction == "backward" else tx_graph
    personalization = {n: (1.0 if n in seed_txids else 0.0) for n in graph.nodes()}
    pr = nx.pagerank(graph, alpha=alpha, personalization=personalization, max_iter=300)

    tx_illicit = dict(zip(labels.txid, labels.is_illicit))
    y = np.array([tx_illicit[t] for t in graph.nodes()])
    s = np.array([pr[t] for t in graph.nodes()])
    tx_auc = roc_auc_score(y, s)

    tx_risk = pd.Series(pr, name="propagated_risk").rename_axis("txid").reset_index()
    addr_tx = tx_inputs.merge(tx_risk, on="txid", how="left")
    wallet_risk = addr_tx.groupby("address")["propagated_risk"].max()
    w = wallets.merge(wallet_risk.rename("propagated_risk"), on="address", how="left")
    w["propagated_risk"] = w["propagated_risk"].fillna(0)

    wallet_auc = roc_auc_score(w["is_illicit"], w["propagated_risk"])
    wallet_ap = average_precision_score(w["is_illicit"], w["propagated_risk"])

    return {
        "tx_risk": tx_risk,
        "wallets": w,
        "metrics": {"tx_level_auc": tx_auc, "wallet_level_auc": wallet_auc,
                    "wallet_level_ap": wallet_ap},
        "seed_txids": seed_txids,
    }


def minmax(s: pd.Series) -> pd.Series:
    return (s - s.min()) / (s.max() - s.min() + 1e-9)


def fuse_alerts(features_anomaly: pd.DataFrame, features_pattern: pd.DataFrame,
                tx_risk: pd.DataFrame, chains: list,
                weights: dict | None = None) -> pd.DataFrame:
    weights = weights or {"anomaly_score_n": 0.30, "illicit_proba_n": 0.45, "propagated_risk_n": 0.25}
    chain_txids = set(t for c in chains for t in c)

    f = features_pattern.merge(tx_risk, on="txid", how="left")
    f["propagated_risk"] = f["propagated_risk"].fillna(0)

    f["anomaly_score_n"] = minmax(f["anomaly_score"])
    f["propagated_risk_n"] = minmax(f["propagated_risk"])
    f["illicit_proba_n"] = minmax(f["illicit_proba"])
    f["risk_score"] = sum(f[c] * w for c, w in weights.items())
    f["in_peeling_chain"] = f["txid"].isin(chain_txids)

    def explain(row):
        reasons = []
        if row["anomaly_score_n"] > 0.7:
            reasons.append("statistically unusual flow (Isolation Forest outlier)")
        if row["pattern_pred"] == "mixing":
            reasons.append(f"classified as CoinJoin-like mixing (p={row['illicit_proba']:.2f})")
        elif row["pattern_pred"] == "peeling_chain":
            reasons.append(f"classified as peeling-chain hop (p={row['illicit_proba']:.2f})")
        if row["in_peeling_chain"]:
            reasons.append("part of a detected multi-hop peeling chain")
        if row["propagated_risk_n"] > 0.7:
            reasons.append("high propagated risk from seed illicit wallets (PageRank)")
        if row.get("src_ip_tx_count", 99) <= 2 and row.get("asn_geo_diversity", 0) > 3:
            reasons.append("broadcast from a geographically-diverse / low-reuse IP pool")
        return "; ".join(reasons) if reasons else "elevated composite score, no single dominant signal"

    f["reason"] = f.apply(explain, axis=1)
    f["confidence_pct"] = (f["risk_score"] * 100).round(1)
    return f


def pyvis_offline_html(sub: nx.DiGraph, risk_map: dict, highlight_nodes: set | None = None,
                        height: str = "550px") -> str:
    """Render a subgraph as a self-contained Pyvis network with no external requests."""
    from pyvis.network import Network
    import re

    highlight_nodes = highlight_nodes or set()
    net = Network(height=height, width="100%", bgcolor="#0d1117", font_color="#e6edf3",
                   directed=True, cdn_resources="in_line")
    net.barnes_hut(gravity=-3000, spring_length=120, damping=0.5)

    for n in sub.nodes():
        r = risk_map.get(n, 0.0)
        color = f"rgb({int(60+195*r)},{int(90-70*r)},{int(90-70*r)})"
        net.add_node(n, label=n[:10] + "...", title=f"{n}\nrisk={r:.3f}",
                     color=color, size=22 if n in highlight_nodes else 12)
    for u, v in sub.edges():
        net.add_edge(u, v, color="#3a4256")

    html = net.generate_html()
    html = re.sub(r'<link[^>]*bootstrap[^>]*>', '', html)
    html = re.sub(r'<script[^>]*bootstrap[^>]*></script>', '', html)
    return html
