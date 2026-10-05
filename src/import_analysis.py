"""Correlate and score a locally imported transaction dataset with saved models."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

import runtime_pipeline as pl


def _epoch(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
        if abs(numeric) > 100_000_000_000:
            return numeric / 1000
        if abs(numeric) > 100_000_000:
            return numeric
        return numeric
    except (TypeError, ValueError):
        try:
            parsed = pd.to_datetime(value, utc=True, errors="coerce")
            if pd.isna(parsed):
                return None
            return float(parsed.timestamp())
        except (TypeError, ValueError, OverflowError):
            return None


def _number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if np.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _geoip_enrich(records: list[dict[str, Any]]) -> list[str]:
    warnings = []
    try:
        import geoip2fast
        geo = geoip2fast.GeoIP2Fast()
    except ImportError:
        if any(row.get("src_ip") and not row.get("geo_country") for row in records):
            warnings.append("The local GeoIP database is unavailable; imported country and ASN fields were left unknown.")
        return warnings

    cache = {}
    for row in records:
        ip = row.get("src_ip")
        if not ip or (row.get("geo_country") and row.get("asn_owner")):
            continue
        if ip not in cache:
            try:
                result = geo.lookup(ip)
                cache[ip] = {
                    "country": getattr(result, "country_code", None),
                    "asn": getattr(result, "asn", None),
                    "owner": getattr(result, "asn_name", None),
                }
            except Exception:
                cache[ip] = {"country": None, "asn": None, "owner": None}
        found = cache[ip]
        row["geo_country"] = row.get("geo_country") or found["country"]
        row["asn"] = row.get("asn") or found["asn"]
        row["asn_owner"] = row.get("asn_owner") or found["owner"]
    return warnings


def _make_graphs(records: list[dict[str, Any]], order: dict[str, int]):
    graph = nx.DiGraph()
    flow = nx.DiGraph()
    producers: dict[str, list[tuple[int, str, float | None]]] = defaultdict(list)
    consumers: dict[str, list[tuple[int, str, float | None]]] = defaultdict(list)
    for row in records:
        txid = row["txid"]
        attributes = {
            "type": "transaction", "label": txid[:12] + "…", "timestamp": row.get("timestamp"),
            "risk": 0.0, "highlighted": False,
        }
        graph.add_node(f"tx:{txid}", **attributes)
        flow.add_node(txid)
        source_ip, destination_ip = row.get("src_ip"), row.get("dst_ip")
        if source_ip:
            ip_node = f"ip:{source_ip}"
            graph.add_node(ip_node, type="ip", label=source_ip, risk=0.0, highlighted=False)
            graph.add_edge(ip_node, f"tx:{txid}", kind="broadcast", port=row.get("src_port"), timestamp=row.get("timestamp"))
        if destination_ip:
            ip_node = f"ip:{destination_ip}"
            graph.add_node(ip_node, type="ip", label=destination_ip, risk=0.0, highlighted=False)
            graph.add_edge(f"tx:{txid}", ip_node, kind="peer", port=row.get("dst_port"), timestamp=row.get("timestamp"))

        for index, address in enumerate(row["input_addresses"]):
            wallet = f"wallet:{address}"
            graph.add_node(wallet, type="wallet", label=address[:14] + "…", risk=0.0, highlighted=False)
            amount = row["input_amounts"][index] if index < len(row["input_amounts"]) else None
            graph.add_edge(wallet, f"tx:{txid}", kind="input", amount=amount, timestamp=row.get("timestamp"))
            consumers[address].append((order[txid], txid, amount))
        for index, address in enumerate(row["output_addresses"]):
            wallet = f"wallet:{address}"
            graph.add_node(wallet, type="wallet", label=address[:14] + "…", risk=0.0, highlighted=False)
            amount = row["output_amounts"][index] if index < len(row["output_amounts"]) else None
            graph.add_edge(f"tx:{txid}", wallet, kind="output", amount=amount, timestamp=row.get("timestamp"))
            producers[address].append((order[txid], txid, amount))

    # Attribute a wallet's latest observed earlier output to a later spend.
    # The relationship is marked as inferred because wallet-level data lacks
    # outpoints needed to prove the exact UTXO lineage.
    for address, spends in consumers.items():
        prior_outputs = sorted(producers.get(address, []), key=lambda entry: (entry[0], entry[1]))
        for spend_order, spend_txid, _ in sorted(spends, key=lambda entry: (entry[0], entry[1])):
            earlier = [entry for entry in prior_outputs if entry[0] <= spend_order and entry[1] != spend_txid]
            if earlier:
                _, source_txid, amount = earlier[-1]
                flow.add_edge(source_txid, spend_txid, shared_wallet=address)
                graph.add_edge(f"tx:{source_txid}", f"tx:{spend_txid}", kind="value_flow",
                               shared_wallet=address, amount=amount, inferred=True)
    return graph, flow


def _risk_from_seeds(graph: nx.DiGraph, txids: list[str], bundle: dict) -> dict[str, float]:
    seed_frame = bundle.get("tables", {}).get("seed_illicit")
    if seed_frame is None or "address" not in seed_frame:
        return {txid: 0.0 for txid in txids}
    seeds = {f"wallet:{address}" for address in seed_frame["address"].dropna().astype(str)}
    matched = seeds.intersection(graph.nodes)
    if not matched:
        return {txid: 0.0 for txid in txids}
    undirected = graph.to_undirected()
    personalization = {node: (1.0 if node in matched else 0.0) for node in undirected.nodes}
    scores = nx.pagerank(undirected, alpha=0.85, personalization=personalization, max_iter=150, tol=1e-7)
    tx_scores = {txid: float(scores.get(f"tx:{txid}", 0.0)) for txid in txids}
    values = np.array(list(tx_scores.values()), dtype=float)
    low, high = (float(values.min()), float(values.max())) if len(values) else (0.0, 0.0)
    if high > low:
        return {txid: (score - low) / (high - low) for txid, score in tx_scores.items()}
    return {txid: 0.0 for txid in txids}


def _build_features(records: list[dict[str, Any]], graph: nx.DiGraph, flow: nx.DiGraph) -> pd.DataFrame:
    timestamps = {row["txid"]: _epoch(row.get("timestamp")) for row in records}
    known_steps = {row["txid"]: _number(row.get("time_step"), -1) for row in records if row.get("time_step") is not None}
    time_values = [value for value in timestamps.values() if value is not None]
    min_time, max_time = (min(time_values), max(time_values)) if time_values else (0.0, 0.0)
    rows = []
    for record in records:
        txid = record["txid"]
        input_amounts = [amount for amount in record["input_amounts"] if amount is not None]
        output_amounts = [amount for amount in record["output_amounts"] if amount is not None]
        total_in = _number(record.get("total_input_btc"), sum(input_amounts))
        total_out = _number(record.get("total_output_btc"), sum(output_amounts))
        fee = _number(record.get("fee_btc"), max(0.0, total_in - total_out))
        input_count = int(record.get("num_inputs") or len(record["input_addresses"]))
        output_count = int(record.get("num_outputs") or len(record["output_addresses"]))
        step = known_steps.get(txid)
        if step is None or step < 0:
            current_time = timestamps[txid]
            step = 0.0 if current_time is None or max_time <= min_time else 48 * (current_time - min_time) / (max_time - min_time)
        indegree, outdegree = flow.in_degree(txid), flow.out_degree(txid)
        rows.append({
            "txid": txid, "time_step": float(np.clip(step, 0, 48)),
            "num_inputs": input_count, "num_outputs": output_count,
            "total_input_btc": total_in, "total_output_btc": total_out, "fee_btc": fee,
            "fee_rate": fee / total_in if total_in > 0 else 0.0,
            "avg_input_amount": total_in / input_count if input_count else 0.0,
            "avg_output_amount": total_out / output_count if output_count else 0.0,
            "io_ratio": input_count / output_count if output_count else 0.0,
            "value_retained_frac": total_out / total_in if total_in else 0.0,
            "is_round_output": int(round(total_out, 2) == total_out),
            "log_total_input": float(np.log1p(max(total_in, 0.0))),
            "src_ip": record.get("src_ip"), "geo_country": record.get("geo_country"),
            "asn_owner": record.get("asn_owner"), "script_type": record.get("script_type", "unknown"),
            "class": record.get("class", 3), "graph_indeg": indegree, "graph_outdeg": outdegree,
            "out_in_ratio": outdegree / (indegree + 1), "total_degree": indegree + outdegree,
            "log_indeg": float(np.log1p(indegree)), "log_outdeg": float(np.log1p(outdegree)),
            "indeg_outdeg_ratio": indegree / (outdegree + 1),
        })
    features = pd.DataFrame(rows)
    geo_diversity = features.groupby("asn_owner", dropna=False)["geo_country"].nunique()
    features["asn_geo_diversity"] = features["asn_owner"].map(geo_diversity).fillna(0)
    features["src_ip_tx_count"] = features["src_ip"].map(features["src_ip"].value_counts()).fillna(0)
    return features


def _known_wallet_embeddings(records: list[dict[str, Any]], bundle: dict,
                             dimensions: int = 32) -> dict[str, np.ndarray]:
    cluster = bundle.get("clustering", {})
    embeddings = cluster.get("embeddings")
    addresses = bundle.get("tables", {}).get("wallets", pd.DataFrame()).get("address", pd.Series(dtype=str)).tolist()
    if embeddings is None or len(addresses) != len(embeddings):
        return {record["txid"]: np.zeros(dimensions, dtype=float) for record in records}
    lookup = {str(address): embeddings[index] for index, address in enumerate(addresses)}
    result = {}
    for record in records:
        sender = record["input_addresses"][0] if record["input_addresses"] else None
        result[record["txid"]] = np.asarray(lookup.get(sender, np.zeros(embeddings.shape[1])), dtype=float)
    return result


def _score_records(records: list[dict[str, Any]], features: pd.DataFrame, bundle: dict,
                   graph: nx.DiGraph, flow: nx.DiGraph) -> tuple[pd.DataFrame, dict, dict[str, list[str]]]:
    pattern = bundle["pattern"]
    pattern_x = features[pattern["struct_cols"]].fillna(0)
    classes = list(pattern["model"].classes_)
    pattern_probabilities = pattern["model"].predict_proba(pattern_x)
    normal_index = classes.index("normal") if "normal" in classes else 0
    pattern_features = features.copy()
    pattern_features["pattern_pred"] = pattern["model"].predict(pattern_x)
    pattern_features["illicit_proba"] = 1 - pattern_probabilities[:, normal_index]

    risk_by_txid = _risk_from_seeds(graph, features["txid"].tolist(), bundle)
    pattern_features["propagated_risk"] = pattern_features["txid"].map(risk_by_txid).fillna(0)
    anomaly = bundle["anomaly"]
    feature_columns = anomaly.get("FEATURE_COLS", [])
    if feature_columns:
        anomaly_frame = pattern_features.copy()
        embedding_columns = [column for column in feature_columns
                             if column.startswith("emb_") and column[4:].isdigit()]
        embedding_dimensions = max((int(column[4:]) for column in embedding_columns), default=-1) + 1
        embeddings_by_txid = _known_wallet_embeddings(records, bundle, embedding_dimensions)
        for column in embedding_columns:
            index = int(column[4:])
            anomaly_frame[column] = anomaly_frame["txid"].map(
                lambda txid: embeddings_by_txid[txid][index]
                if index < len(embeddings_by_txid[txid]) else 0.0
            )
        anomaly_features = anomaly.get("features")
        for name in ("script_type", "class"):
            if name not in anomaly_frame:
                anomaly_frame[name] = "unknown"
            reference = anomaly_features[name] if anomaly_features is not None and name in anomaly_features else None
            categories = list(reference.cat.categories) if reference is not None and isinstance(reference.dtype, pd.CategoricalDtype) else None
            if categories is not None:
                codes = pd.Categorical(anomaly_frame[name], categories=categories).codes.astype(float)
                codes[codes < 0] = np.nan
                anomaly_frame[name] = codes
            else:
                anomaly_frame[name] = pd.to_numeric(anomaly_frame[name], errors="coerce")
        matrix = anomaly_frame.reindex(columns=feature_columns).copy()
        for column in matrix:
            matrix[column] = pd.to_numeric(matrix[column], errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
        model = anomaly.get("best_model")
        if model is None:
            raise ValueError("The saved supervised anomaly model could not be loaded.")
        probabilities = model.predict_proba(matrix)
        model_classes = list(getattr(model, "classes_", [0, 1]))
        anomaly_index = model_classes.index(1) if 1 in model_classes else len(model_classes) - 1
        anomaly_score = probabilities[:, anomaly_index]
    else:
        # Older bundles and builds that fell back during supervised training
        # contain an Isolation Forest instead of FEATURE_COLS/best_model.
        model = anomaly.get("model") or anomaly.get("models", {}).get("iso")
        if model is None:
            raise ValueError("The saved anomaly model does not include a usable scoring model.")
        matrix = pattern_features.reindex(columns=pl.NUM_COLS).copy()
        for column in matrix:
            matrix[column] = pd.to_numeric(matrix[column], errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
        scaler = anomaly.get("scaler")
        if scaler is None:
            training_features = anomaly.get("features")
            if training_features is None or not set(pl.NUM_COLS).issubset(training_features.columns):
                raise ValueError("The saved Isolation Forest has no compatible feature scaler.")
            # Older Isolation Forest bundles fit StandardScaler but did not
            # persist it. Refit on their original training features.
            scaler = StandardScaler().fit(training_features[pl.NUM_COLS].fillna(0))
        raw_scores = -model.score_samples(scaler.transform(matrix))
        low, high = float(raw_scores.min()), float(raw_scores.max())
        anomaly_score = (raw_scores - low) / (high - low) if high > low else np.zeros(len(raw_scores))

    scored = pattern_features.copy()
    scored["anomaly_score"] = anomaly_score
    scored["anomaly_score_n"] = anomaly_score
    values = scored["propagated_risk"].to_numpy(dtype=float)
    spread = values.max() - values.min() if len(values) else 0.0
    scored["propagated_risk_n"] = (values - values.min()) / spread if spread > 0 else 0.0
    scored["illicit_proba_n"] = scored["illicit_proba"]
    scored["in_peeling_chain"] = False
    chains = pl.find_peeling_chains(flow, scored, min_length=3)
    chain_txids = {txid for chain in chains for txid in chain}
    scored["in_peeling_chain"] = scored["txid"].isin(chain_txids)
    scored["is_illicit"] = None
    scored["risk_score"] = (
        0.25 * scored["anomaly_score_n"]
        + 0.50 * scored["illicit_proba_n"]
        + 0.25 * scored["propagated_risk_n"]
    )
    scored["confidence_pct"] = (scored["risk_score"] * 100).round(1)

    anomaly_cutoff = float(scored["anomaly_score"].quantile(0.95)) if len(scored) else 1.0
    reasons, evidence = [], []
    by_txid = {record["txid"]: record for record in records}
    for row in scored.to_dict(orient="records"):
        record = by_txid[row["txid"]]
        risk_components = [
            {"model": "Anomaly detector", "finding": "Unusual transaction profile", "score": float(row["anomaly_score_n"]), "raw_score": float(row["anomaly_score"]), "weight": 0.25, "contribution": float(row["anomaly_score_n"]) * 0.25},
            {"model": "Pattern classifier", "finding": f"Pattern: {str(row['pattern_pred']).replace('_', ' ')}", "score": float(row["illicit_proba_n"]), "raw_score": float(row["illicit_proba"]), "weight": 0.50, "contribution": float(row["illicit_proba_n"]) * 0.50},
            {"model": "Graph propagation", "finding": "Seed-wallet neighborhood risk", "score": float(row["propagated_risk_n"]), "raw_score": float(row["propagated_risk"]), "weight": 0.25, "contribution": float(row["propagated_risk_n"]) * 0.25},
        ]
        signals = []
        if row["pattern_pred"] != "normal":
            signals.append({"model": "Pattern classifier", "finding": str(row["pattern_pred"]).replace("_", " "), "score": float(row["illicit_proba"])})
        if row["anomaly_score"] >= anomaly_cutoff:
            signals.append({"model": "Supervised anomaly ensemble", "finding": "unusual transaction profile", "score": float(row["anomaly_score"])})
        if row["propagated_risk"] > 0:
            signals.append({"model": "Seed-wallet graph propagation", "finding": "connected to a provided seed wallet", "score": float(row["propagated_risk"])})
        if row["in_peeling_chain"]:
            signals.append({"model": "Transaction-flow graph", "finding": "member of an inferred multi-hop peeling chain", "score": 1.0})
        reason = "; ".join(signal["finding"] for signal in signals) or "Prioritized by the combined model score; no individual signal crossed its alert threshold."
        reasons.append(reason)
        evidence.append({
            "signals": signals,
            "risk_components": risk_components,
            "network": {key: record.get(key) for key in ("src_ip", "src_port", "dst_ip", "dst_port", "timestamp", "geo_country", "asn", "asn_owner")},
            "input_addresses": record["input_addresses"], "input_amounts": record["input_amounts"],
            "output_addresses": record["output_addresses"], "output_amounts": record["output_amounts"],
            "transaction": {key: record.get(key) for key in ("num_inputs", "num_outputs", "total_input_btc", "total_output_btc", "fee_btc", "script_type")},
        })
    scored["reason"] = reasons
    scored["evidence"] = evidence

    pattern_result = {**pattern, "features": pattern_features}
    chains_by_txid: dict[str, list[str]] = defaultdict(list)
    for chain in chains:
        for txid in chain:
            chains_by_txid[txid] = chain
    return scored, pattern_result, dict(chains_by_txid)


def _reference_rows(frame: pd.DataFrame | None) -> dict[str, list[tuple[str, float | None]]]:
    """Build exact-TXID wallet row lookups from the bundled offline dataset."""
    if frame is None or frame.empty or not {"txid", "address"}.issubset(frame.columns):
        return {}
    amount_column = "amount_btc" if "amount_btc" in frame.columns else None
    result: dict[str, list[tuple[str, float | None]]] = defaultdict(list)
    columns = ["txid", "address"] + ([amount_column] if amount_column else [])
    for row in frame[columns].itertuples(index=False, name=None):
        txid, address = row[:2]
        if pd.isna(txid) or pd.isna(address):
            continue
        amount = _number(row[2], float("nan")) if amount_column else float("nan")
        result[str(txid)].append((str(address), amount if np.isfinite(amount) else None))
    return dict(result)


def _merge_reference_wallet_rows(record: dict[str, Any], side: str,
                                 reference_rows: list[tuple[str, float | None]]) -> int:
    """Fill missing imported address/amount fields, retaining supplied values."""
    address_key = f"{side}_addresses"
    amount_key = f"{side}_amounts"
    addresses = list(record.get(address_key) or [])
    amounts = list(record.get(amount_key) or [])
    amounts.extend([None] * max(0, len(addresses) - len(amounts)))
    original_count = len(addresses)
    known_pairs = {(str(address), amounts[index]) for index, address in enumerate(addresses)}

    for address, amount in reference_rows:
        # If an imported address has no amount, use the exact-TXID local amount.
        replaced = False
        if amount is not None:
            for index, existing in enumerate(addresses):
                if str(existing) == address and amounts[index] is None:
                    amounts[index] = amount
                    known_pairs.add((address, amount))
                    replaced = True
                    break
        if replaced:
            continue
        marker = (address, amount)
        if marker not in known_pairs:
            addresses.append(address)
            amounts.append(amount)
            known_pairs.add(marker)

    record[address_key] = addresses
    record[amount_key] = amounts
    return max(0, len(addresses) - original_count)


def _enrich_from_offline_reference(records: list[dict[str, Any]], bundle: dict) -> dict[str, Any]:
    """Correlate imported network observations to bundled wallet and label data by TXID."""
    tables = bundle.get("tables", {})
    input_rows = _reference_rows(tables.get("tx_inputs"))
    output_rows = _reference_rows(tables.get("tx_outputs"))
    labels = tables.get("labels")
    label_lookup: dict[str, bool] = {}
    if labels is not None and not labels.empty and {"txid", "is_illicit"}.issubset(labels.columns):
        for txid, value in labels[["txid", "is_illicit"]].itertuples(index=False, name=None):
            if pd.isna(txid) or pd.isna(value):
                continue
            label_lookup[str(txid)] = bool(int(value))

    matched_wallet_txids = 0
    matched_label_txids = 0
    for record in records:
        txid = str(record["txid"])
        local_inputs = input_rows.get(txid, [])
        local_outputs = output_rows.get(txid, [])
        input_additions = _merge_reference_wallet_rows(record, "input", local_inputs)
        output_additions = _merge_reference_wallet_rows(record, "output", local_outputs)
        if local_inputs or local_outputs:
            matched_wallet_txids += 1
        local_input_total = sum(amount for _, amount in local_inputs if amount is not None)
        local_output_total = sum(amount for _, amount in local_outputs if amount is not None)
        if _number(record.get("total_input_btc")) <= 0 and local_input_total > 0:
            record["total_input_btc"] = round(local_input_total, 8)
        if _number(record.get("total_output_btc")) <= 0 and local_output_total > 0:
            record["total_output_btc"] = round(local_output_total, 8)
        if _number(record.get("fee_btc")) <= 0:
            record["fee_btc"] = round(max(0.0, _number(record.get("total_input_btc")) - _number(record.get("total_output_btc"))), 8)
        if not record.get("num_inputs") and local_inputs:
            record["num_inputs"] = len(local_inputs)
        if not record.get("num_outputs") and local_outputs:
            record["num_outputs"] = len(local_outputs)
        record["reference_input_addresses_added"] = input_additions
        record["reference_output_addresses_added"] = output_additions

        # Ground truth is carried for display/evaluation only; it is not an ML feature.
        supplied_label = record.get("is_illicit")
        label = bool(supplied_label) if supplied_label is not None else label_lookup.get(txid)
        record["ground_truth_is_illicit"] = label
        if supplied_label is None and label is not None and txid in label_lookup:
            matched_label_txids += 1

    return {
        "wallet_txids_matched": matched_wallet_txids,
        "label_txids_matched": matched_label_txids,
        "label_lookup": label_lookup,
    }


def analyze_records(imported: dict[str, Any], bundle: dict) -> dict[str, Any]:
    records = imported["records"]
    warnings = list(imported.get("warnings", []))
    reference = _enrich_from_offline_reference(records, bundle)
    if reference["wallet_txids_matched"]:
        warnings.append(
            f"Correlated {reference['wallet_txids_matched']:,} imported TXIDs with local wallet input/output tables using exact TXID matches."
        )
    if reference["label_txids_matched"]:
        warnings.append(
            f"Attached ground-truth labels to {reference['label_txids_matched']:,} exact TXID matches from the local reference dataset; labels are not used as model features."
        )
    warnings.extend(_geoip_enrich(records))
    missing_fields = list(imported.get("missing_fields", []))
    field_available = {
        "input_addresses": any(record["input_addresses"] for record in records),
        "output_addresses": any(record["output_addresses"] for record in records),
        "input_amounts": any(any(amount is not None for amount in record["input_amounts"]) for record in records),
        "output_amounts": any(any(amount is not None for amount in record["output_amounts"]) for record in records),
        "geo_country": any(record.get("geo_country") for record in records),
        "asn": any(record.get("asn") is not None for record in records),
        "asn_owner": any(record.get("asn_owner") for record in records),
    }
    missing_fields = [field for field in missing_fields if not field_available.get(field, False)]
    warnings = [warning for warning in warnings if not warning.startswith("Some standard fields are missing;")]
    if missing_fields:
        warnings.append(
            "Some standard fields remain unavailable after local correlation: " + ", ".join(missing_fields)
        )
    timestamp_order = sorted(
        range(len(records)),
        key=lambda index: (_epoch(records[index].get("timestamp")) is None,
                           _epoch(records[index].get("timestamp")) or index, index),
    )
    order = {records[index]["txid"]: rank for rank, index in enumerate(timestamp_order)}
    graph, flow = _make_graphs(records, order)
    features = _build_features(records, graph, flow)
    scored, pattern_result, chains_by_txid = _score_records(records, features, bundle, graph, flow)
    ground_truth_by_txid = {record["txid"]: record.get("ground_truth_is_illicit") for record in records}
    scored["is_illicit"] = scored["txid"].map(ground_truth_by_txid)

    score_by_txid = scored.set_index("txid").to_dict(orient="index")
    records_by_txid = {}
    for record in records:
        txid = record["txid"]
        score = score_by_txid[txid]
        enriched = dict(record)
        for key in ("pattern_pred", "illicit_proba", "illicit_proba_n", "anomaly_score", "anomaly_score_n", "propagated_risk", "propagated_risk_n", "risk_score", "confidence_pct", "reason", "in_peeling_chain"):
            value = score.get(key)
            enriched[key] = value.item() if isinstance(value, np.generic) else value
        enriched["is_illicit"] = record.get("ground_truth_is_illicit")
        enriched["evidence"] = score["evidence"]
        enriched["peeling_chain"] = chains_by_txid.get(txid, [])
        records_by_txid[txid] = enriched
        graph.nodes[f"tx:{txid}"]["risk"] = float(score["risk_score"])
        graph.nodes[f"tx:{txid}"]["highlighted"] = False
        for address in record["input_addresses"] + record["output_addresses"]:
            wallet = f"wallet:{address}"
            if wallet in graph:
                graph.nodes[wallet]["risk"] = max(float(graph.nodes[wallet].get("risk", 0)), float(score["risk_score"]))

    pattern_distribution = scored["pattern_pred"].value_counts().to_dict()
    unique_wallets = {address for record in records for address in record["input_addresses"] + record["output_addresses"]}
    ips = {address for record in records for address in (record.get("src_ip"), record.get("dst_ip")) if address}
    labeled_records = [record for record in records if record.get("ground_truth_is_illicit") is not None]
    illicit_records = sum(bool(record["ground_truth_is_illicit"]) for record in labeled_records)
    licit_records = len(labeled_records) - illicit_records
    flagged_count = max(1, int(np.ceil(len(scored) * 0.10))) if len(scored) else 0
    summary = {
        "source_rows": int(imported["source_rows"]),
        "transactions_analyzed": len(records),
        "wallets_correlated": len(unique_wallets),
        "wallet_txids_matched": reference["wallet_txids_matched"],
        "ground_truth_labeled": len(labeled_records),
        "ground_truth_licit": licit_records,
        "ground_truth_illicit": illicit_records,
        "ground_truth_unlabeled": len(records) - len(labeled_records),
        "ground_truth_available": bool(labeled_records),
        "ip_addresses_observed": len(ips),
        "input_address_links": int(sum(len(record["input_addresses"]) for record in records)),
        "output_address_links": int(sum(len(record["output_addresses"]) for record in records)),
        "flow_links_inferred": flow.number_of_edges(),
        "peeling_chain_count": len(set(tuple(chain) for chain in chains_by_txid.values())),
        "prioritized_leads": flagged_count,
        "pattern_distribution": {str(key): int(value) for key, value in pattern_distribution.items()},
        "missing_fields": missing_fields,
        "warnings": warnings,
        "score_method": "Saved supervised anomaly ensemble + pattern Random Forest + seed-wallet PageRank, weighted 0.25 / 0.50 / 0.25.",
        "geoip_enriched": sum(bool(record.get("geo_country")) for record in records),
    }
    return {
        "summary": summary,
        "records": records_by_txid,
        "scored": scored,
        "features": features,
        "pattern_result": pattern_result,
        "graph": graph,
        "flow_graph": flow,
        "chains_by_txid": chains_by_txid,
    }


def graph_payload(
    session: dict[str, Any],
    top_k: int = 20,
    focus_txid: str | None = None,
    focus_node_id: str | None = None,
) -> dict[str, Any]:
    graph = session["graph"]
    records = session["records"]
    ranked = session["scored"].sort_values("risk_score", ascending=False)
    if focus_txid and not focus_node_id:
        focus_node_id = f"tx:{focus_txid}"

    if focus_node_id and focus_node_id in graph:
        root_node_id = focus_node_id
        first_hop = set(graph.predecessors(root_node_id)) | set(graph.successors(root_node_id))
        transaction_candidates = {node for node in first_hop if graph.nodes[node].get("type") == "transaction"}
        entity_hop = first_hop
        for node in first_hop:
            if graph.nodes[node].get("type") in {"wallet", "ip"}:
                transaction_candidates.update(
                    neighbor for neighbor in set(graph.predecessors(node)) | set(graph.successors(node))
                    if graph.nodes[neighbor].get("type") == "transaction"
                )

        if graph.nodes[root_node_id].get("type") == "transaction":
            transaction_candidates.add(root_node_id)
        ranked_ids = [f"tx:{txid}" for txid in ranked["txid"].astype(str).tolist()]
        ordered = [node for node in ranked_ids if node in transaction_candidates]
        root_tx = root_node_id if graph.nodes[root_node_id].get("type") == "transaction" else None
        keep_transactions = set(ordered[:max(1, top_k)])
        if root_tx:
            keep_transactions.add(root_tx)
        focus_nodes = {root_node_id} | keep_transactions
        for tx_node in keep_transactions:
            focus_nodes |= set(graph.predecessors(tx_node)) | set(graph.successors(tx_node))
        focus_nodes &= set(graph.nodes)
    elif focus_node_id:
        raise ValueError(f"Graph node {focus_node_id} was not found in the imported dataset")
    else:
        focus_ids = ranked.head(max(1, min(top_k, 50)))["txid"].astype(str).tolist()
        root_node_id = f"tx:{focus_ids[0]}" if focus_ids else None
        focus_nodes = set()
        for txid in focus_ids:
            tx_node = f"tx:{txid}"
            focus_nodes.add(tx_node)
            neighbours = set(graph.predecessors(tx_node)) | set(graph.successors(tx_node))
            focus_nodes |= neighbours
    focus_nodes = {node for node in focus_nodes if node in graph}
    if len(focus_nodes) > 500:
        focus_nodes.discard(root_node_id)
        focus_nodes = set(list(focus_nodes)[:499])
        if root_node_id in graph:
            focus_nodes.add(root_node_id)
    subgraph = graph.subgraph(focus_nodes)
    nodes = []
    for node, data in subgraph.nodes(data=True):
        details = {key: data.get(key) for key in ("timestamp", "src_ip", "src_port", "dst_ip", "dst_port", "geo_country", "asn", "asn_owner") if data.get(key) is not None}
        node_risk = float(data.get("risk", 0.0))
        if data.get("type") == "transaction":
            txid = node.removeprefix("tx:")
            record = records[txid]
            features = {
                key: record.get(key) for key in (
                    "num_inputs", "num_outputs", "total_input_btc", "total_output_btc",
                    "fee_btc", "fee_rate", "io_ratio", "script_type", "src_ip_tx_count",
                    "asn_geo_diversity",
                ) if record.get(key) is not None
            }
            details.update({
                "risk_score": record.get("risk_score"),
                "confidence_pct": record.get("confidence_pct"),
                "pattern_pred": record.get("pattern_pred"),
                "reason": record.get("reason"),
                "anomaly_score": record.get("anomaly_score"),
                "anomaly_score_normalized": record.get("anomaly_score_n"),
                "illicit_proba": record.get("illicit_proba"),
                "illicit_proba_normalized": record.get("illicit_proba_n"),
                "propagated_risk": record.get("propagated_risk"),
                "propagated_risk_normalized": record.get("propagated_risk_n"),
                "in_peeling_chain": record.get("in_peeling_chain"),
                "risk_formula": "25% anomaly score + 50% pattern probability + 25% graph-propagated risk (normalized in model fusion)",
                "evidence_signals": (record.get("evidence") or {}).get("risk_components", []),
                "transaction_features": features,
            })
        elif data.get("type") == "wallet":
            related_ids = [
                neighbor.removeprefix("tx:")
                for neighbor in set(graph.predecessors(node)) | set(graph.successors(node))
                if graph.nodes[neighbor].get("type") == "transaction"
            ]
            propagated = max((float(records[txid].get("propagated_risk") or 0) for txid in related_ids), default=0.0)
            node_risk = max(node_risk, propagated, max((float(records[txid].get("risk_score") or 0) for txid in related_ids), default=0.0))
            details.update({"address": node.removeprefix("wallet:"), "propagated_risk": propagated, "related_transaction_count": len(related_ids)})
        elif data.get("type") == "ip":
            related_ids = [neighbor.removeprefix("tx:") for neighbor in set(graph.predecessors(node)) | set(graph.successors(node))
                           if graph.nodes[neighbor].get("type") == "transaction"]
            linked_transactions = len(related_ids)
            node_risk = max(node_risk, max((float(records[txid].get("risk_score") or 0) for txid in related_ids), default=0.0))
            details.update({"address": node.removeprefix("ip:"), "related_transaction_count": linked_transactions})
        nodes.append({"id": node, "label": data.get("label", node), "type": data.get("type", "transaction"),
                      "risk": node_risk,
                      "highlighted": bool(node == root_node_id),
                      "details": details})
    edges = []
    for source, target, data in subgraph.edges(data=True):
        edges.append({"source": source, "target": target, "kind": data.get("kind", "related"),
                      "label": data.get("shared_wallet", ""),
                      "details": {key: data.get(key) for key in ("port", "amount", "timestamp", "shared_wallet", "inferred") if data.get(key) is not None}})
    return {"nodes": nodes, "edges": edges}
