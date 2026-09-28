import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import networkx as nx
import streamlit as st
import streamlit.components.v1 as components
import plotly.graph_objects as go
import plotly.express as px

sys.path.insert(0, str(Path(__file__).parent / "src"))
import pipeline as pl

ROOT = Path(__file__).parent
ARTIFACT_PATH = ROOT / "artifacts" / "bundle.joblib"

st.set_page_config(page_title="Bitcoin Transaction Forensics | SIH PS-5",
                    page_icon="\u20BF", layout="wide",
                    initial_sidebar_state="expanded")

st.markdown("""
<style>
    :root {
        --surface: #11141b;
        --border: #232833;
        --text-muted: #8b93a3;
        --accent: #5b7cfa;
        --risk-high: #e5484d;
        --risk-medium: #f5a623;
        --risk-low: #30a46c;
    }

    .block-container { padding-top: 4.5rem; }

    .app-header {
        display: flex; align-items: center; gap: 14px;
        padding: 2px 0 16px 0; margin-bottom: 10px;
        border-bottom: 1px solid var(--border);
    }
    .app-header .mark {
        font-size: 1.15rem; font-weight: 700; line-height: 1;
        background: var(--surface); border: 1px solid var(--border);
        color: var(--accent);
        width: 40px; height: 40px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
    }
    .app-header .title { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; }

    div[data-testid="stMetric"] {
        background: var(--surface); border: 1px solid var(--border);
        border-top: 2px solid var(--accent);
        border-radius: 8px; padding: 12px 16px 8px 16px;
    }
    div[data-testid="stMetricLabel"] { color: var(--text-muted) !important; }

    .risk-high   { color: var(--risk-high); font-weight: 600; }
    .risk-medium { color: var(--risk-medium); font-weight: 600; }
    .risk-low    { color: var(--risk-low); font-weight: 600; }

    .reason-box {
        background: var(--surface); border: 1px solid var(--border);
        border-left: 3px solid var(--accent);
        padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 0.93rem;
        margin: 6px 0 14px 0;
    }
    .reason-box b { font-weight: 600; }
    .caption-dim { color: var(--text-muted); font-size: 0.85rem; }

    button[data-baseweb="tab"] { font-size: 0.95rem; }

    section[data-testid="stSidebar"] div[role="radiogroup"] > label {
        padding: 6px 8px; border-radius: 6px; margin-bottom: 2px;
    }
</style>
""", unsafe_allow_html=True)


@st.cache_resource(show_spinner="Loading trained models & data (first launch only)...")
def load_bundle():
    if not ARTIFACT_PATH.exists():
        return None
    return joblib.load(ARTIFACT_PATH)


bundle = load_bundle()

if bundle is None:
    st.error(
        "No trained artifacts found at `artifacts/bundle.joblib`.\n\n"
        "Run this once first (needs internet only to `pip install -r requirements.txt`, "
        "the build itself is fully offline):\n\n"
        "```bash\npython src/build_artifacts.py\n```"
    )
    st.stop()

tables = bundle["tables"]
tx_graph: nx.DiGraph = bundle["tx_graph"]
clustering = bundle["clustering"]
anomaly = bundle["anomaly"]
pattern = bundle["pattern"]
chains = bundle["chains"]
risk = bundle["risk"]
fused = bundle["fused"]
ensemble_auc = bundle["ensemble_auc"]

chain_txids = set(t for c in chains for t in c)


def risk_badge(score_0_1: float) -> str:
    if score_0_1 >= 0.66:
        return '<span class="risk-high">HIGH</span>'
    if score_0_1 >= 0.33:
        return '<span class="risk-medium">MEDIUM</span>'
    return '<span class="risk-low">LOW</span>'


st.markdown("""
<div class="app-header">
    <div class="mark">&#8383;</div>
    <div class="title">Bitcoin transaction forensics</div>
</div>
""", unsafe_allow_html=True)

st.sidebar.markdown("### Bitcoin forensics")
page = st.sidebar.radio("Navigate", [
    "Overview",
    "Investigate a TXID / Wallet",
    "Ranked Alerts",
    "Entity Clusters",
    "Link-Analysis Graph",
    "Model Performance",
], label_visibility="collapsed")
st.sidebar.markdown("---")
st.sidebar.markdown(
    '<span class="caption-dim">All models were trained offline from '
    'artifacts/bundle.joblib. No internet is used at run time.</span>',
    unsafe_allow_html=True)


if page == "Overview":
    st.markdown("#### AI-powered monitoring & analysis of Bitcoin transaction traffic")
    st.caption("National Technical Research Organisation · Cryptocurrency theme")

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Transactions analyzed", f"{len(tables['transactions']):,}")
    c2.metric("Wallets tracked", f"{len(tables['wallets']):,}")
    c3.metric("Seed illicit wallets", f"{len(tables['seed_illicit']):,}")
    c4.metric("Peeling chains found", f"{len(chains):,}")
    c5.metric("Ensemble risk AUC", f"{ensemble_auc:.3f}")

    st.markdown("### Pipeline")
    st.graphviz_chart(r"""
    digraph {
        rankdir=LR;
        node [shape=box, style="rounded,filled", fillcolor="#1c2333", fontcolor="#e6edf3", color="#2a3244"];
        edge [color="#5b6577"];
        A [label="Ingest\nDuckDB over CSV/JSON/XML\n(zero server, single laptop)"];
        B [label="Correlate\nIP <-> Wallet <-> TXID graph (NetworkX)\n+ offline GeoIP (geoip2fast)"];
        C [label="AI/ML models\nClustering | Isolation Forest | RandomForest | Personalized PageRank"];
        D [label="Fuse & rank\nExplainable alerts\n(rules + SHAP)"];
        E [label="Dashboard\nStreamlit + Pyvis (offline)"];
        A -> B -> C -> D -> E;
    }
    """)

    with st.expander("Ingestion architecture: sample DuckDB correlated view (network-layer <-> blockchain-layer)"):
        st.caption("Produced by a single DuckDB SQL query joining network fields "
                   "(src_ip, geo, timing) with wallet and amount fields.")
        st.dataframe(tables["correlated_sample"].head(15), use_container_width=True, hide_index=True)

    colA, colB = st.columns(2)
    with colA:
        st.markdown("#### Transaction pattern composition")
        vc = tables["labels"]["pattern_type"].value_counts().reset_index()
        vc.columns = ["pattern_type", "count"]
        fig = px.bar(vc, x="pattern_type", y="count", color="pattern_type",
                     color_discrete_sequence=px.colors.qualitative.Set2)
        fig.update_layout(template="plotly_dark", showlegend=False, height=340)
        st.plotly_chart(fig, use_container_width=True)
    with colB:
        st.markdown("#### Illicit vs licit (ground truth, for evaluation only)")
        vc2 = tables["wallets"]["is_illicit"].map({0: "licit/unknown", 1: "illicit"}).value_counts().reset_index()
        vc2.columns = ["label", "count"]
        fig2 = px.pie(vc2, names="label", values="count", hole=0.5,
                      color_discrete_sequence=["#6fcf97", "#ff5c5c"])
        fig2.update_layout(template="plotly_dark", height=340)
        st.plotly_chart(fig2, use_container_width=True)

    st.markdown("### What each focus area contributes")
    st.table(pd.DataFrame([
        ["Entity Clustering", "Union-Find (common-input) + graph embedding (SVD) + K-Means",
         f"NMI {clustering['metrics']['embedding_nmi']:.2f}"],
        ["Anomaly Detection", "Isolation Forest on engineered tx features",
         f"ROC-AUC {anomaly['metrics']['roc_auc']:.2f}"],
        ["Peeling-Chain / Mixing", "RandomForest + graph-structural features + chain-walk detector",
         f"macro-F1 {pattern['report']['macro avg']['f1-score']:.2f}"],
        ["Risk Scoring", "Personalized PageRank from seed illicit wallets",
         f"wallet ROC-AUC {risk['metrics']['wallet_level_auc']:.2f}"],
    ], columns=["Focus area", "Method", "Headline metric"]))


elif page == "Investigate a TXID / Wallet":
    st.markdown("### Investigate")
    tab1, tab2 = st.tabs(["By Transaction (TXID)", "By Wallet Address"])

    with tab1:
        default_txid = fused.sort_values("risk_score", ascending=False).iloc[0]["txid"]
        txid = st.text_input("Enter a TXID (or leave the default, the current top alert):",
                              value=default_txid)
        row = fused.loc[fused.txid == txid]
        if row.empty:
            st.warning("TXID not found in the dataset.")
        else:
            row = row.iloc[0]
            c1, c2, c3 = st.columns(3)
            c1.metric("Confidence", f"{row['confidence_pct']:.1f}%")
            c2.metric("Predicted pattern", row["pattern_pred"])
            c3.markdown(f"**Risk tier:** {risk_badge(row['risk_score'])}", unsafe_allow_html=True)

            st.markdown(f'<div class="reason-box"><b>Why flagged:</b> {row["reason"]}</div>',
                        unsafe_allow_html=True)
            st.write("")

            shap_expl = pl.explain_with_shap(pattern, txid)
            if shap_expl:
                st.markdown(f"#### SHAP feature attribution (why predicted **{shap_expl['predicted_class']}**)")
                contrib = shap_expl["contributions"].copy()
                contrib["direction"] = np.where(contrib["shap_value"] >= 0, "pushes towards", "pushes away from")
                fig = px.bar(contrib, x="shap_value", y="feature", orientation="h", color="direction",
                             color_discrete_map={"pushes towards": "#ff5c5c", "pushes away from": "#6fcf97"},
                             hover_data=["value"])
                fig.update_layout(template="plotly_dark", height=280, yaxis_title="",
                                   xaxis_title="SHAP value (impact on prediction)",
                                   legend_title="", margin=dict(t=10, b=10))
                st.plotly_chart(fig, use_container_width=True)
                st.caption("Red bars push the prediction towards this pattern; "
                           "green bars push away from it.")

            tx_row = tables["transactions"].loc[tables["transactions"].txid == txid]
            if not tx_row.empty:
                st.markdown("#### Raw transaction / network metadata")
                st.dataframe(tx_row.T.rename(columns={tx_row.index[0]: "value"}),
                             use_container_width=True)

            colI, colO = st.columns(2)
            with colI:
                st.markdown("#### Input addresses")
                st.dataframe(tables["tx_inputs"].loc[tables["tx_inputs"].txid == txid,
                                                       ["address", "amount_btc"]],
                             use_container_width=True, hide_index=True)
            with colO:
                st.markdown("#### Output addresses")
                st.dataframe(tables["tx_outputs"].loc[tables["tx_outputs"].txid == txid,
                                                        ["address", "amount_btc"]],
                             use_container_width=True, hide_index=True)

            if txid in tx_graph:
                neigh = {txid} | set(tx_graph.predecessors(txid)) | set(tx_graph.successors(txid))
                sub = tx_graph.subgraph(neigh)
                risk_map = dict(zip(fused.txid, fused.risk_score))
                st.markdown("#### 1-hop money-flow neighbourhood (drag nodes, hover for risk)")
                html = pl.pyvis_offline_html(sub, risk_map, highlight_nodes={txid}, height="420px")
                components.html(html, height=440, scrolling=True)

    with tab2:
        wdf = risk["wallets"]
        default_wallet = wdf.sort_values("propagated_risk", ascending=False).iloc[0]["address"]
        addr = st.text_input("Enter a wallet address:", value=default_wallet)
        wrow = wdf.loc[wdf.address == addr]
        if wrow.empty:
            st.warning("Address not found.")
        else:
            wrow = wrow.iloc[0]
            cdf = clustering["wallet_clusters"].loc[
                clustering["wallet_clusters"].address == addr]
            c1, c2, c3 = st.columns(3)
            c1.metric("Propagated risk (PageRank)", f"{wrow['propagated_risk']:.4f}")
            c2.metric("Entity type", wrow["entity_type"])
            c3.metric("Ground-truth illicit (dataset only)", "YES" if wrow["is_illicit"] else "no")
            if not cdf.empty:
                st.write(f"Predicted entity cluster id: **{cdf.iloc[0]['predicted_entity_cluster']}**")

            st.markdown("#### Transactions where this wallet is an input (it signed)")
            spent = tables["tx_inputs"].loc[tables["tx_inputs"].address == addr, "txid"]
            st.dataframe(fused.loc[fused.txid.isin(spent),
                                     ["txid", "risk_score", "pattern_pred", "reason"]]
                         .sort_values("risk_score", ascending=False),
                         use_container_width=True, hide_index=True)


elif page == "Ranked Alerts":
    st.markdown("### Ranked, explainable alerts")
    st.caption("Each alert carries a plain-English reason for why it was flagged.")

    top_n = st.slider("Show top N alerts", 10, 500, 50, step=10)
    pattern_filter = st.multiselect("Filter by predicted pattern",
                                     options=sorted(fused.pattern_pred.unique()),
                                     default=list(sorted(fused.pattern_pred.unique())))

    view = fused[fused.pattern_pred.isin(pattern_filter)].sort_values(
        "risk_score", ascending=False).head(top_n)
    show_cols = ["txid", "confidence_pct", "pattern_pred", "is_illicit", "reason"]
    display = view[show_cols].rename(columns={
        "confidence_pct": "confidence_%", "pattern_pred": "predicted_pattern",
        "is_illicit": "ground_truth_illicit"})
    st.dataframe(display, use_container_width=True, hide_index=True, height=560)

    st.download_button("Download this alert list as CSV",
                        display.to_csv(index=False).encode("utf-8"),
                        file_name="ranked_alerts.csv", mime="text/csv")


elif page == "Entity Clusters":
    st.markdown("### Entity clustering")
    m = clustering["metrics"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Embedding NMI", f"{m['embedding_nmi']:.3f}")
    c2.metric("Homogeneity", f"{m['embedding_homogeneity']:.3f}")
    c3.metric("Completeness", f"{m['embedding_completeness']:.3f}")
    c4.metric("V-measure", f"{m['embedding_v_measure']:.3f}")

    st.info("**Method:** addresses that co-spend in the same non-mixing transaction are merged "
            "(Union-Find). Each address is also embedded from its transaction graph "
            "(TruncatedSVD) and clustered with K-Means. The two results are combined.")

    combo = clustering["wallet_clusters"]
    sample = combo.sample(min(4000, len(combo)), random_state=42)
    fig = px.scatter(sample, x="pc1", y="pc2", color="entity_type", opacity=0.65,
                      hover_data=["address", "predicted_entity_cluster"],
                      color_discrete_sequence=px.colors.qualitative.Set2,
                      title="Address graph-embedding space (PCA projection)")
    fig.update_layout(template="plotly_dark", height=520)
    st.plotly_chart(fig, use_container_width=True)

    st.markdown("#### Inspect a predicted cluster")
    cluster_id = st.selectbox("Predicted cluster id",
                               sorted(combo.predicted_entity_cluster.value_counts().head(50).index))
    st.dataframe(combo.loc[combo.predicted_entity_cluster == cluster_id,
                            ["address", "entity_type", "is_illicit", "true_entity"]],
                 use_container_width=True, hide_index=True)


elif page == "Link-Analysis Graph":
    st.markdown("### Link-analysis: top flagged transactions")
    top_k = st.slider("How many top-risk transactions to visualize", 10, 150, 60, step=10)

    top_nodes = set(fused.nlargest(top_k, "risk_score")["txid"])
    neighbourhood = set(top_nodes)
    for n in top_nodes:
        if n in tx_graph:
            neighbourhood.update(tx_graph.predecessors(n))
            neighbourhood.update(tx_graph.successors(n))
    sub = tx_graph.subgraph(neighbourhood)
    risk_map = dict(zip(fused.txid, fused.risk_score))

    st.caption(f"{sub.number_of_nodes()} nodes, {sub.number_of_edges()} edges. "
               "Drag nodes to move them, hover for TXID and risk score, scroll to zoom.")
    with st.spinner("Laying out graph..."):
        html = pl.pyvis_offline_html(sub, risk_map, highlight_nodes=top_nodes, height="650px")
    components.html(html, height=670, scrolling=True)


elif page == "Model Performance":
    st.markdown("### Model performance & explainability")

    st.markdown("### Anomaly detector (Isolation Forest)")
    c1, c2 = st.columns(2)
    fpr, tpr = anomaly["roc_curve"]
    prec, rec = anomaly["pr_curve"]
    with c1:
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=fpr, y=tpr, mode="lines",
                                  name=f"AUC={anomaly['metrics']['roc_auc']:.3f}"))
        fig.add_trace(go.Scatter(x=[0, 1], y=[0, 1], mode="lines",
                                  line=dict(dash="dash", color="grey"), showlegend=False))
        fig.update_layout(template="plotly_dark", height=350, title="ROC curve vs is_anomaly")
        st.plotly_chart(fig, use_container_width=True)
    with c2:
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=rec, y=prec, mode="lines"))
        fig.update_layout(template="plotly_dark", height=350, title="Precision-Recall curve")
        st.plotly_chart(fig, use_container_width=True)

    st.markdown("### Peeling-chain / mixing classifier (RandomForest)")
    c1, c2 = st.columns([1, 1])
    with c1:
        cm = pattern["confusion_matrix"]
        fig = px.imshow(cm, text_auto=True, x=pattern["classes"], y=pattern["classes"],
                         labels=dict(x="Predicted", y="Actual", color="count"),
                         color_continuous_scale="Blues")
        fig.update_layout(template="plotly_dark", height=380, title="Confusion matrix")
        st.plotly_chart(fig, use_container_width=True)
    with c2:
        imp = pattern["feature_importance"]
        fig = px.bar(imp, orientation="h", title="Feature importance")
        fig.update_layout(template="plotly_dark", height=380, showlegend=False,
                           yaxis_title="", xaxis_title="importance")
        st.plotly_chart(fig, use_container_width=True)

    rep = pd.DataFrame(pattern["report"]).T.round(3)
    st.dataframe(rep, use_container_width=True)

    st.markdown("#### SHAP global feature importance (mean |SHAP value| over the top-500 alerts)")
    shap_global = bundle["shap_global"]
    fig = px.bar(shap_global, orientation="h",
                 title="Which features drive the model's flags, dataset-wide")
    fig.update_layout(template="plotly_dark", height=380, showlegend=False,
                       yaxis_title="", xaxis_title="mean |SHAP value|")
    st.plotly_chart(fig, use_container_width=True)
    st.caption("SHAP-based importance, shown alongside the RandomForest's built-in importance above.")

    st.markdown("### Risk propagation (Personalized PageRank)")
    st.json(risk["metrics"])

    st.markdown("### Ensemble (fused) score")
    st.metric("Ensemble ROC-AUC vs ground-truth is_illicit", f"{ensemble_auc:.3f}")
    fig = px.histogram(fused, x="risk_score",
                        color=fused["is_illicit"].map({0: "licit/unknown", 1: "illicit (GT)"}),
                        nbins=60, barmode="overlay", opacity=0.65,
                        color_discrete_sequence=["#6fcf97", "#ff5c5c"])
    fig.update_layout(template="plotly_dark", height=380,
                       title="Ensemble risk_score distribution by ground truth", legend_title="")
    st.plotly_chart(fig, use_container_width=True)