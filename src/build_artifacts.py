"""Train all models once and cache results to artifacts/bundle.joblib."""
import sys
import time
from pathlib import Path

import joblib
import networkx as nx
import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import pipeline as pl

DATA_DIR = Path(__file__).parent.parent / "data"
ARTIFACT_PATH = Path(__file__).parent.parent / "artifacts" / "bundle.joblib"


def main():
    t0 = time.time()
    print("[1/6] Loading data (DuckDB ingestion layer) ...")
    tables = pl.load_data_duckdb(DATA_DIR)
    print("      sample network<->blockchain correlated view (SQL JOIN):")
    print(tables["correlated_sample"].head(3).to_string(index=False))

    print("[2/6] GeoIP-enriching transactions (offline geoip2fast db) ...")
    try:
        tables["transactions"] = pl.enrich_geoip(tables["transactions"])
    except ImportError:
        print("  geoip2fast not installed - skipping enrichment "
              "(run: pip install geoip2fast). App will still work, just "
              "without the 'real_geo_country' column.")

    print("[3/6] Building graphs ...")
    tx_graph = pl.build_tx_graph(tables["labels"], tables["tx_edges"])

    print("[4/6] Entity clustering ...")
    clustering = pl.cluster_entities(tables["wallets"], tables["tx_inputs"],
                                      tables["tx_outputs"], tables["labels"])
    print("      ", clustering["metrics"])

    print("[5/6] Risk propagation (PageRank from seed illicit wallets) ...")
    risk = pl.propagate_risk(tx_graph, tables["tx_inputs"], tables["wallets"],
                              tables["seed_illicit"], tables["labels"],
                              direction="both", alpha=0.85)
    print("      risk propagation:", risk["metrics"])

    print("[6/6] Pattern classification + anomaly detection (supervised ensemble) + fuse alerts ...")
    # First classify patterns to add graph structural features to features dataframe
    print("  Classifying patterns (RandomForest + graph features)...")
    pattern = pl.classify_patterns(tables["features"], tx_graph)
    chains = pl.find_peeling_chains(tx_graph, pattern["features"])
    print(f"      peeling chains detected: {len(chains)}")

    # Then run supervised anomaly detection with enriched features
    print("  Attempting supervised anomaly detection (XGBoost + LightGBM + RF)...")
    try:
        # Prepare embeddings DataFrame
        addr_emb_df = None
        if clustering.get("embeddings") is not None:
            addr_emb_df = pd.DataFrame(
                clustering["embeddings"],
                columns=[f"emb_{i}" for i in range(clustering["embeddings"].shape[1])],
                index=tables["wallets"]["address"].tolist()
            ).reset_index().rename(columns={"index": "address"})

        anomaly = pl.detect_anomalies_supervised(
            pattern["features"],
            embeddings=clustering.get("embeddings"),
            addr_list=tables["wallets"]["address"].tolist(),
            addr_emb_df=addr_emb_df,
            best_pr=risk.get("best_pr") if "best_pr" in risk else dict(zip(risk["tx_risk"]["txid"], risk["tx_risk"]["propagated_risk"])),
            tx_inputs=tables["tx_inputs"]
        )
        print(f"  supervised anomaly: ensemble AUC={anomaly.get('ensemble_roc_auc', 0):.3f}")
    except Exception as e:
        print(f"  supervised anomaly failed ({e}), falling back to Isolation Forest")
        anomaly = pl.detect_anomalies(pattern["features"])
        print("      anomaly:", anomaly["metrics"])

    print("[7/7] Fusing alerts + precomputing SHAP explanations for top alerts ...")
    fused = pl.fuse_alerts(anomaly["features"], pattern["features"], risk["tx_risk"], chains)

    from sklearn.metrics import roc_auc_score
    ensemble_auc = roc_auc_score(fused["is_illicit"], fused["risk_score"])
    print("      ensemble ROC-AUC:", ensemble_auc)

    top_alert_txids = fused.nlargest(500, "risk_score")["txid"].tolist()
    shap_global = pl.shap_summary(pattern, top_alert_txids)
    print("      SHAP top global features (top-500 alerts):")
    print(shap_global.head(8).to_string())

    # Store the best_pr in risk for API access
    if "best_pr" not in risk:
        risk["best_pr"] = dict(zip(risk["tx_risk"]["txid"], risk["tx_risk"]["propagated_risk"]))

    # Requests use the calibrated model for imported datasets. Keep it, but
    # discard the other evaluation-only models and retain only the two
    # categorical reference columns needed to encode imported values.
    anomaly.pop("models", None)
    if "features" in anomaly:
        anomaly["features"] = anomaly["features"][["script_type", "class"]].copy()

    # These source tables and intermediate risk results are already represented
    # by the serving tables, transaction graph, and fused predictions.
    for key in ("features", "tx_edges", "entities"):
        tables.pop(key, None)
    tables["labels"] = tables["labels"][["is_illicit", "pattern_type"]].copy()
    tables["wallets"] = tables["wallets"][["address"]].copy()
    risk.pop("tx_risk", None)
    risk.pop("best_pr", None)
    risk.pop("seed_txids", None)

    # SHAP only needs the transaction ID, predicted class, and structural inputs.
    pattern["features"] = pattern["features"][
        ["txid", "pattern_pred", *pattern["struct_cols"]]
    ].copy()

    bundle = {
        "tables": tables,
        "tx_graph": tx_graph,
        "clustering": clustering,
        "anomaly": anomaly,
        "pattern": pattern,
        "chains": chains,
        "risk": risk,
        "fused": fused,
        "ensemble_auc": ensemble_auc,
        "shap_global": shap_global,
        "top_alert_txids": top_alert_txids,
        "build_seconds": time.time() - t0,
    }

    ARTIFACT_PATH.parent.mkdir(exist_ok=True, parents=True)
    joblib.dump(bundle, ARTIFACT_PATH, compress=3)
    print(f"\nSaved {ARTIFACT_PATH}  ({ARTIFACT_PATH.stat().st_size/1e6:.1f} MB, "
          f"built in {bundle['build_seconds']:.1f}s)")


if __name__ == "__main__":
    main()
