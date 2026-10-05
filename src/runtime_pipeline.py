"""Small inference-time helpers shared by the API and import analysis."""

import numpy as np
import pandas as pd


NUM_COLS = [
    "num_inputs", "num_outputs", "total_input_btc", "total_output_btc", "fee_btc",
    "fee_rate", "avg_input_amount", "avg_output_amount", "io_ratio",
    "value_retained_frac", "is_round_output", "log_total_input",
    "asn_geo_diversity", "src_ip_tx_count",
]


def explain_with_shap(pattern_result: dict, txid: str, top_k: int = 5) -> dict:
    """Return the same local SHAP explanation as the training pipeline."""
    f = pattern_result["features"]
    row = f.loc[f.txid == txid]
    if row.empty:
        return {}

    struct_cols = pattern_result["struct_cols"]
    classes = pattern_result["classes"]
    X_row = row[struct_cols].fillna(0)
    pred_class = row.iloc[0]["pattern_pred"]
    class_idx = classes.index(pred_class)

    import shap

    explainer = shap.TreeExplainer(pattern_result["model"])
    values = explainer.shap_values(X_row, check_additivity=False)
    values = np.array(values)[0, :, class_idx]

    contributions = pd.DataFrame({
        "feature": struct_cols,
        "value": X_row.iloc[0].values,
        "shap_value": values,
    }).sort_values("shap_value", key=abs, ascending=False).head(top_k)

    return {"predicted_class": pred_class, "contributions": contributions}


def find_peeling_chains(tx_graph, features: pd.DataFrame, min_length: int = 3) -> list:
    """Find multi-hop chains of 2-output transactions."""
    is_peelish = set(features.loc[features["num_outputs"] == 2, "txid"])
    visited, chains = set(), []
    for node in tx_graph.nodes():
        if node not in is_peelish or node in visited:
            continue
        if any(parent in is_peelish for parent in tx_graph.predecessors(node)):
            continue
        chain, current = [node], node
        while True:
            successors = [child for child in tx_graph.successors(current) if child in is_peelish]
            if len(successors) != 1 or successors[0] in visited:
                break
            current = successors[0]
            chain.append(current)
        if len(chain) >= min_length:
            chains.append(chain)
        visited.update(chain)
    return chains
