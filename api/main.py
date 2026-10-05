"""FastAPI backend for Bitcoin Transaction Forensics."""
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from contextvars import ContextVar
import secrets
import time

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import pandas as pd
import numpy as np
import joblib
import networkx as nx
import io
import json
import logging
import math

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
import runtime_pipeline as pl
import ingestion as local_ingestion
import import_analysis

ROOT = Path(__file__).parent.parent
ARTIFACT_PATH = ROOT / "artifacts" / "bundle.joblib"
FRONTEND_DIST = ROOT / "frontend" / "dist"

bundle = None
ingestion_sessions: dict[str, tuple[dict, float]] = {}
current_ingestion_session: ContextVar[dict | None] = ContextVar("current_ingestion_session", default=None)
SESSION_COOKIE = "sift_session"
SESSION_TTL_SECONDS = 4 * 60 * 60
MAX_INGESTION_SESSIONS = 4
logger = logging.getLogger(__name__)


def current_session_data() -> dict | None:
    return current_ingestion_session.get()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bundle
    if not ARTIFACT_PATH.exists():
        print(f"ERROR: No trained artifacts found at {ARTIFACT_PATH}")
        print("Run: python src/build_artifacts.py")
    else:
        print(f"Loading artifacts from {ARTIFACT_PATH}...")
        bundle = joblib.load(ARTIFACT_PATH)
        print("Artifacts loaded successfully!")
    yield


app = FastAPI(
    title="Bitcoin Transaction Forensics API",
    description="API for Bitcoin transaction monitoring and forensics dashboard",
    version="1.0.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def bind_private_ingestion_session(request: Request, call_next):
    """Keep imported datasets scoped to an anonymous, short-lived browser session."""
    now = time.monotonic()
    for session_id, (_, last_used) in list(ingestion_sessions.items()):
        if now - last_used > SESSION_TTL_SECONDS:
            ingestion_sessions.pop(session_id, None)

    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id or len(session_id) > 100:
        session_id = secrets.token_urlsafe(32)
    request.state.session_id = session_id

    entry = ingestion_sessions.get(session_id)
    session = entry[0] if entry else None
    if entry:
        ingestion_sessions[session_id] = (session, now)

    token = current_ingestion_session.set(session)
    try:
        response = await call_next(request)
    finally:
        current_ingestion_session.reset(token)

    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
    )
    if request.url.path.startswith("/api/"):
        vary = response.headers.get("Vary")
        response.headers["Vary"] = f"{vary}, Cookie" if vary and "cookie" not in vary.lower() else (vary or "Cookie")
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_bundle():
    if bundle is None:
        raise HTTPException(status_code=503, detail="Artifacts not loaded. Run build_artifacts.py first.")
    return bundle


def df_to_records(df: pd.DataFrame) -> list[dict]:
    """Convert DataFrame to list of dicts, handling NaN and numpy types."""
    df = df.copy()
    for col in df.columns:
        if df[col].dtype == np.float64 or df[col].dtype == np.float32:
            df[col] = df[col].replace({np.nan: None, np.inf: None, -np.inf: None})
        elif df[col].dtype == np.int64 or df[col].dtype == np.int32:
            df[col] = df[col].replace({np.nan: None})
    return df.to_dict(orient="records")


def json_safe(value):
    """Convert common NumPy containers and scalar types to standard JSON values."""
    if isinstance(value, np.ndarray):
        return [json_safe(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return json_safe(value.item())
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _transaction_trace_payload(txid: str, b: dict | None = None, session: dict | None = None) -> dict:
    """Build a bounded, evidence-backed transaction trace from locally loaded data."""
    if session:
        records = session["records"]
        if txid not in records:
            # Accept an unambiguous TXID prefix, matching the graph search UX.
            matches = [key for key in records if key.startswith(txid)]
            if len(matches) != 1:
                raise HTTPException(status_code=404, detail=f"TXID {txid} not found or prefix is ambiguous")
            txid = matches[0]
        record = records[txid]
        tx_graph = session["flow_graph"]
        input_addresses = list(record.get("input_addresses") or [])
        input_amounts = list(record.get("input_amounts") or [])
        output_addresses = list(record.get("output_addresses") or [])
        output_amounts = list(record.get("output_amounts") or [])
        previous = list(tx_graph.predecessors(txid)) if txid in tx_graph else []
        following = list(tx_graph.successors(txid)) if txid in tx_graph else []
        inferred = True
        tx = record
        risk = float(record.get("risk_score") or 0)
        pattern = str(record.get("pattern_pred") or "unknown")
        common_edges = list(session["graph"].edges(data=True))
        input_parent_by_wallet = {}
        output_spenders_by_wallet = {}
        for source, target, edge in common_edges:
            if edge.get("kind") != "value_flow":
                continue
            if target == f"tx:{txid}": input_parent_by_wallet[str(edge.get("shared_wallet"))] = source.removeprefix("tx:")
            if source == f"tx:{txid}": output_spenders_by_wallet[str(edge.get("shared_wallet"))] = target.removeprefix("tx:")
    else:
        assert b is not None
        tx_frame = b["tables"]["transactions"]
        exact = tx_frame.loc[tx_frame.txid.astype(str) == txid]
        if exact.empty:
            matches = tx_frame.loc[tx_frame.txid.astype(str).str.startswith(txid), "txid"].astype(str).tolist()
            if len(matches) != 1:
                raise HTTPException(status_code=404, detail=f"TXID {txid} not found or prefix is ambiguous")
            txid = matches[0]
            exact = tx_frame.loc[tx_frame.txid.astype(str) == txid]
        tx = exact.iloc[0]
        tx_graph = b["tx_graph"]
        input_frame = b["tables"]["tx_inputs"]
        output_frame = b["tables"]["tx_outputs"]
        input_frame = input_frame.loc[input_frame.txid.astype(str) == txid]
        output_frame = output_frame.loc[output_frame.txid.astype(str) == txid]
        input_addresses = input_frame.address.astype(str).tolist()
        input_amounts = [json_safe(value) for value in input_frame.amount_btc.tolist()]
        output_addresses = output_frame.address.astype(str).tolist()
        output_amounts = [json_safe(value) for value in output_frame.amount_btc.tolist()]
        previous = list(tx_graph.predecessors(txid)) if txid in tx_graph else []
        following = list(tx_graph.successors(txid)) if txid in tx_graph else []
        # tx_edges gives transaction-level lineage but not the exact prevout;
        # the address match is therefore still an input/output-level inference.
        inferred = True
        input_parent_by_wallet = {}
        output_spenders_by_wallet = {}
        # tx_edges preserves transaction lineage; address matches make the input/output
        # association more specific when those rows are present.
        outputs_all = b["tables"]["tx_outputs"]
        for parent in previous:
            addresses = set(outputs_all.loc[outputs_all.txid.astype(str) == str(parent), "address"].astype(str))
            for address in input_addresses:
                if address in addresses:
                    input_parent_by_wallet[address] = str(parent)
        inputs_all = b["tables"]["tx_inputs"]
        for spender in following:
            addresses = set(inputs_all.loc[inputs_all.txid.astype(str) == str(spender), "address"].astype(str))
            for address in output_addresses:
                if address in addresses:
                    output_spenders_by_wallet[address] = str(spender)

        fused = b["fused"].loc[b["fused"].txid.astype(str) == txid]
        if fused.empty:
            raise HTTPException(status_code=404, detail=f"Risk model result for TXID {txid} is unavailable")
        scored = fused.iloc[0]
        risk = float(scored.get("risk_score", 0) or 0)
        pattern = str(scored.get("pattern_pred", "unknown"))

    inputs = []
    outputs = []
    for index, address in enumerate(input_addresses):
        amount = input_amounts[index] if index < len(input_amounts) else None
        inputs.append({"index": index + 1, "address": address, "amount_btc": amount,
                       "previous_txid": input_parent_by_wallet.get(address),
                       "linkage_basis": ("shared address and observed transaction-flow edge" if session else "observed transaction edge and matching address") if input_parent_by_wallet.get(address) else None,
                       "linkage_inferred": inferred})
    for index, address in enumerate(output_addresses):
        amount = output_amounts[index] if index < len(output_amounts) else None
        spender = output_spenders_by_wallet.get(address)
        outputs.append({"index": index + 1, "address": address, "amount_btc": amount,
                        "spent_by_txid": spender,
                        "linkage_basis": "shared address and observed transaction-flow edge" if session and spender else "observed transaction edge and matching address" if spender else None,
                        "linkage_inferred": inferred,
                        "likely_change": address in input_addresses,
                        "change_signals": ["Address appears in both this transaction's inputs and outputs"] if address in input_addresses else []})

    common_ownership_applicable = len(set(input_addresses)) > 1 and pattern.lower() not in {"mixing", "coinjoin", "coinjoin_like"}
    graph_nodes = []
    graph_edges = []
    transaction_ids = list(dict.fromkeys([*previous[:6], txid, *following[:6]]))
    trace_details = {}
    if session:
        feature_rows = session["features"].loc[session["features"].txid.astype(str) == txid]
        feature_row = feature_rows.iloc[0] if not feature_rows.empty else {}
        feature_keys = ("num_inputs", "num_outputs", "total_input_btc", "total_output_btc", "fee_btc", "fee_rate", "io_ratio", "script_type", "src_ip_tx_count", "asn_geo_diversity")
        trace_details = {"risk_score": risk, "pattern_pred": pattern, "reason": record.get("reason"),
                         "confidence_pct": record.get("confidence_pct"), "anomaly_score": record.get("anomaly_score"),
                         "propagated_risk": record.get("propagated_risk"), "timestamp": record.get("timestamp"),
                         "transaction_features": {key: json_safe(feature_row.get(key)) for key in feature_keys if feature_row.get(key) is not None},
                         "evidence_signals": (record.get("evidence") or {}).get("risk_components", [])}
    else:
        scored = b["fused"].loc[b["fused"].txid.astype(str) == txid].iloc[0]
        trace_details = {"risk_score": risk, "pattern_pred": pattern, "reason": scored.get("reason"),
                         "confidence_pct": scored.get("confidence_pct"), "anomaly_score": scored.get("anomaly_score"),
                         "propagated_risk": scored.get("propagated_risk"), "timestamp": json_safe(tx.get("timestamp")),
                         "transaction_features": {
                             **{key: json_safe(tx.get(key)) for key in ("num_inputs", "num_outputs", "total_input_btc", "total_output_btc", "fee_btc", "script_type")},
                             **{key: json_safe(scored.get(key)) for key in ("fee_rate", "io_ratio", "src_ip_tx_count", "asn_geo_diversity")},
                         },
                         "evidence_signals": [
                             {"model": "Anomaly detector", "finding": "Unusual transaction profile", "score": json_safe(scored.get("anomaly_score_n", scored.get("anomaly_score"))), "weight": 0.25},
                             {"model": "Pattern classifier", "finding": f"Pattern: {pattern.replace('_', ' ')}", "score": json_safe(scored.get("illicit_proba_n", scored.get("illicit_proba"))), "weight": 0.50},
                             {"model": "Graph propagation", "finding": "Seed-wallet neighborhood risk", "score": json_safe(scored.get("propagated_risk_n", scored.get("propagated_risk"))), "weight": 0.25},
                         ]}
    for item in transaction_ids:
        is_current = item == txid
        if session:
            row = records.get(item, {})
            item_risk = float(row.get("risk_score") or 0)
            item_pattern = str(row.get("pattern_pred") or "unknown")
            details = {"risk_score": item_risk, "pattern_pred": item_pattern, "reason": row.get("reason"),
                       "confidence_pct": row.get("confidence_pct"), "timestamp": row.get("timestamp")}
        else:
            row = b["fused"].loc[b["fused"].txid.astype(str) == str(item)].iloc[0]
            item_risk = float(row.get("risk_score", 0) or 0)
            item_pattern = str(row.get("pattern_pred", "unknown"))
            details = {"risk_score": item_risk, "pattern_pred": item_pattern, "reason": row.get("reason"),
                       "confidence_pct": json_safe(row.get("confidence_pct"))}
        details["trace_stage"] = "current" if is_current else "upstream" if item in previous else "downstream"
        graph_nodes.append({"id": f"tx:{item}", "label": str(item)[:12] + "…", "type": "transaction",
                            "risk": item_risk, "highlighted": is_current, "details": details})
    for item in inputs:
        wallet_id = f"wallet:{item['address']}"
        graph_nodes.append({"id": wallet_id, "label": str(item["address"])[:14] + "…", "type": "wallet", "risk": 0,
                            "highlighted": False, "details": {"address": item["address"], "trace_stage": "input", "amount_btc": item["amount_btc"]}})
        parent = item["previous_txid"]
        graph_edges.append({"source": f"tx:{parent}" if parent else wallet_id, "target": wallet_id if parent else f"tx:{txid}",
                            "kind": "input" if not parent else "value_flow", "label": f"{item['amount_btc']} BTC" if item["amount_btc"] is not None else "",
                            "details": {"amount": item["amount_btc"], "inferred": item["linkage_inferred"]}})
        if parent:
            graph_edges.append({"source": wallet_id, "target": f"tx:{txid}", "kind": "input", "label": "input", "details": {"amount": item["amount_btc"]}})
    for item in outputs:
        wallet_id = f"wallet:{item['address']}"
        graph_nodes.append({"id": wallet_id, "label": str(item["address"])[:14] + "…", "type": "wallet", "risk": 0,
                            "highlighted": False, "details": {"address": item["address"], "trace_stage": "output", "amount_btc": item["amount_btc"], "likely_change": item["likely_change"]}})
        graph_edges.append({"source": f"tx:{txid}", "target": wallet_id, "kind": "output", "label": f"{item['amount_btc']} BTC" if item["amount_btc"] is not None else "",
                            "details": {"amount": item["amount_btc"], "likely_change": item["likely_change"]}})
        if item["spent_by_txid"]:
            graph_edges.append({"source": wallet_id, "target": f"tx:{item['spent_by_txid']}", "kind": "value_flow", "label": "observed spend",
                                "details": {"inferred": item["linkage_inferred"]}})
    if common_ownership_applicable:
        owner_id = f"ownership:{txid}"
        graph_nodes.append({"id": owner_id, "label": "Likely common ownership", "type": "ownership", "risk": 0, "highlighted": False,
                            "details": {"trace_stage": "ownership", "explanation": "Multiple distinct inputs occur in a non-mixing transaction. This heuristic suggests shared control; it does not prove ownership."}})
        for address in sorted(set(input_addresses)):
            graph_edges.append({"source": f"wallet:{address}", "target": owner_id, "kind": "heuristic", "label": "heuristic", "details": {"inferred": True}})
    else:
        owner_id = None

    unique_nodes = {}
    for node in graph_nodes:
        if node["id"] in unique_nodes:
            unique_nodes[node["id"]]["details"].update(node.get("details") or {})
            unique_nodes[node["id"]]["risk"] = max(unique_nodes[node["id"]]["risk"], node["risk"])
        else:
            unique_nodes[node["id"]] = node
    valid_ids = set(unique_nodes)
    graph_edges = [edge for edge in graph_edges if edge["source"] in valid_ids and edge["target"] in valid_ids]
    input_count = tx.get("num_inputs")
    output_count = tx.get("num_outputs")
    if input_count is None or pd.isna(input_count):
        input_count = len(inputs)
    if output_count is None or pd.isna(output_count):
        output_count = len(outputs)
    total_input = tx.get("total_input_btc")
    total_output = tx.get("total_output_btc")
    if total_input is None or pd.isna(total_input):
        total_input = sum(float(value or 0) for value in input_amounts)
    if total_output is None or pd.isna(total_output):
        total_output = sum(float(value or 0) for value in output_amounts)
    return json_safe({
        "txid": txid,
        "transaction": {"txid": txid, "timestamp": json_safe(tx.get("timestamp")), "block": json_safe(tx.get("block_height") or tx.get("block")),
                         "risk_score": risk, "pattern_pred": pattern, "reason": trace_details.get("reason"),
                         "confidence_pct": trace_details.get("confidence_pct"), "anomaly_score": trace_details.get("anomaly_score"),
                         "propagated_risk": trace_details.get("propagated_risk"), "script_type": json_safe(tx.get("script_type")),
                         "transaction_features": trace_details.get("transaction_features"),
                         "risk_evidence_signals": trace_details.get("evidence_signals"),
                         "src_ip": json_safe(tx.get("src_ip")), "dst_ip": json_safe(tx.get("dst_ip")),
                         "total_input_btc": json_safe(total_input),
                         "total_output_btc": json_safe(total_output),
                         "fee_btc": json_safe(tx.get("fee_btc")), "num_inputs": json_safe(input_count), "num_outputs": json_safe(output_count),
                         "risk_evidence": trace_details.get("reason")},
        "inputs": inputs, "outputs": outputs,
        "heuristics": {"common_input_applicable": common_ownership_applicable, "common_ownership_node_id": owner_id,
                       "common_input_note": "Likely common ownership is a heuristic, not proof of shared control." if common_ownership_applicable else "Common-input ownership is not asserted for this transaction; it may be a mixing pattern or inputs are unavailable.",
                       "change_note": "Address reuse is a weak signal only; the dataset does not expose output script matching or reliable change labels."},
        "graph": {"nodes": list(unique_nodes.values()), "edges": graph_edges},
    })


def _dataset_graph_payload(
    b: dict,
    top_k: int = 60,
    focus_txid: str | None = None,
    focus_node_id: str | None = None,
) -> dict:
    """Return a bounded mixed IP/wallet/transaction graph for the shipped data."""
    tables = b["tables"]
    transactions = tables["transactions"]
    fused = b["fused"].set_index("txid")
    inputs = tables["tx_inputs"]
    outputs = tables["tx_outputs"]
    tx_graph = b["tx_graph"]
    tx_lookup = transactions.set_index("txid")

    input_rows = inputs.groupby("txid", sort=False)
    output_rows = outputs.groupby("txid", sort=False)
    wallet_transactions = {}
    ip_observations = pd.concat([
        transactions.get("src_ip", pd.Series(index=transactions.index, dtype=object)),
        transactions.get("dst_ip", pd.Series(index=transactions.index, dtype=object)),
    ]).dropna().astype(str).value_counts().to_dict()
    risk_wallets = b.get("risk", {}).get("wallets")
    address_risk = dict(zip(risk_wallets.address.astype(str), risk_wallets.propagated_risk)) if risk_wallets is not None else {}
    for frame in (inputs, outputs):
        for address, related in frame.groupby("address", sort=False)["txid"]:
            wallet_transactions.setdefault(str(address), set()).update(related.astype(str))

    if focus_txid and not focus_node_id:
        focus_node_id = f"tx:{focus_txid}"

    focus_kind, _, focus_value = (focus_node_id or "").partition(":")
    if focus_node_id:
        if not focus_value:
            raise HTTPException(status_code=400, detail="Graph node IDs must include a type prefix")
        if focus_kind == "tx":
            focus_txid = focus_value
            if focus_txid not in tx_lookup.index:
                raise HTTPException(status_code=404, detail=f"TXID {focus_txid} not found")
            txids = {focus_txid}
            tx = tx_lookup.loc[focus_txid]
            for group in (input_rows, output_rows):
                if focus_txid in group.groups:
                    for address in group.get_group(focus_txid)["address"].astype(str):
                        txids.update(wallet_transactions.get(address, set()))
            src_ip = str(tx.get("src_ip", ""))
            if src_ip:
                txids.update(transactions.loc[transactions.src_ip.astype(str) == src_ip, "txid"].head(12).astype(str))
            if focus_txid in tx_graph:
                txids.update(tx_graph.predecessors(focus_txid))
                txids.update(tx_graph.successors(focus_txid))
        elif focus_kind == "wallet":
            txids = set(wallet_transactions.get(focus_value, set()))
            if not txids:
                raise HTTPException(status_code=404, detail=f"Wallet {focus_value} has no linked transactions")
        elif focus_kind == "ip":
            observed = transactions.src_ip.astype(str).eq(focus_value) | transactions.dst_ip.astype(str).eq(focus_value)
            txids = set(transactions.loc[observed, "txid"].astype(str))
            if not txids:
                raise HTTPException(status_code=404, detail=f"IP {focus_value} has no linked transactions")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported graph node type: {focus_kind}")

        txids = {str(txid) for txid in txids if txid in tx_lookup.index}
        root_txid = focus_value if focus_kind == "tx" else None
        if len(txids) > max(1, top_k) + (1 if root_txid else 0):
            ranked = b["fused"].loc[b["fused"].txid.astype(str).isin(txids)].nlargest(max(1, top_k), "risk_score")
            txids = set(ranked["txid"].astype(str))
            if root_txid:
                txids.add(root_txid)
    elif focus_txid:
        if focus_txid not in tx_lookup.index:
            raise HTTPException(status_code=404, detail=f"TXID {focus_txid} not found")
        txids = {focus_txid}
        tx = tx_lookup.loc[focus_txid]
        for group in (input_rows, output_rows):
            if focus_txid in group.groups:
                for address in group.get_group(focus_txid)["address"].astype(str):
                    txids.update(wallet_transactions.get(address, set()))
        # Same broadcast IPs provide network-layer correlation when wallet links
        # are absent or sparse.
        src_ip = str(tx.get("src_ip", ""))
        if src_ip:
            txids.update(transactions.loc[transactions.src_ip.astype(str) == src_ip, "txid"].head(12).astype(str))
        if focus_txid in tx_graph:
            txids.update(tx_graph.predecessors(focus_txid))
            txids.update(tx_graph.successors(focus_txid))
    else:
        txids = set(b["fused"].nlargest(max(1, min(top_k, 150)), "risk_score")["txid"].astype(str))

    txids = {str(txid) for txid in txids if txid in tx_lookup.index}
    
    # Always keep the focus transaction in the result set
    focus_in_txids = focus_txid in txids if focus_txid else False
    
    if len(txids) > 150:
        keep = set(b["fused"].loc[b["fused"].txid.astype(str).isin(txids)].nlargest(150, "risk_score")["txid"].astype(str))
        if focus_txid and focus_txid in tx_lookup.index:
            keep.add(focus_txid)
        txids = keep
    
    # Re-check after potential filtering
    focus_in_txids = focus_txid in txids if focus_txid else False
    
    root_txid = focus_txid if focus_in_txids else None
    if focus_kind == "tx" and focus_value in txids:
        root_txid = focus_value
    if root_txid is None and txids:
        root_txid = str(b["fused"].loc[b["fused"].txid.astype(str).isin(txids)].nlargest(1, "risk_score").iloc[0]["txid"])
    root_node_id = focus_node_id or (f"tx:{root_txid}" if root_txid else None)

    node_map = {}
    edge_rows = []

    def add_node(node_id, label, node_type, risk=0.0, highlighted=False, details=None):
        if node_id not in node_map:
            node_map[node_id] = {"id": node_id, "label": label, "type": node_type,
                                 "risk": float(risk), "highlighted": bool(highlighted),
                                 "details": details or {}}
        else:
            node_map[node_id]["risk"] = max(float(node_map[node_id]["risk"]), float(risk))
            node_map[node_id]["highlighted"] = node_map[node_id]["highlighted"] or bool(highlighted)
            node_map[node_id]["details"].update(details or {})

    for txid in txids:
        tx = tx_lookup.loc[txid]
        fused_row = fused.loc[txid] if txid in fused.index else {}
        risk = float(fused_row.get("risk_score", 0)) if hasattr(fused_row, "get") else 0.0
        anomaly_score = json_safe(fused_row.get("anomaly_score")) if hasattr(fused_row, "get") else None
        illicit_probability = json_safe(fused_row.get("illicit_proba")) if hasattr(fused_row, "get") else None
        propagated_risk = json_safe(fused_row.get("propagated_risk")) if hasattr(fused_row, "get") else None
        anomaly_component = json_safe(fused_row.get("anomaly_score_n", anomaly_score)) if hasattr(fused_row, "get") else None
        pattern_component = json_safe(fused_row.get("illicit_proba_n", illicit_probability)) if hasattr(fused_row, "get") else None
        propagation_component = json_safe(fused_row.get("propagated_risk_n", propagated_risk)) if hasattr(fused_row, "get") else None
        pattern = str(fused_row.get("pattern_pred", "unknown")) if hasattr(fused_row, "get") else "unknown"
        input_count = len(input_rows.get_group(txid)) if txid in input_rows.groups else 0
        output_count = len(output_rows.get_group(txid)) if txid in output_rows.groups else 0
        transaction_features = {
            "num_inputs": json_safe(tx.get("num_inputs", input_count)),
            "num_outputs": json_safe(tx.get("num_outputs", output_count)),
            "total_input_btc": json_safe(tx.get("total_input_btc")),
            "total_output_btc": json_safe(tx.get("total_output_btc")),
            "fee_btc": json_safe(tx.get("fee_btc")),
            "fee_rate": json_safe(fused_row.get("fee_rate")) if hasattr(fused_row, "get") else None,
            "io_ratio": json_safe(fused_row.get("io_ratio")) if hasattr(fused_row, "get") else None,
            "script_type": json_safe(tx.get("script_type")),
            "src_ip_tx_count": json_safe(fused_row.get("src_ip_tx_count")) if hasattr(fused_row, "get") else None,
            "asn_geo_diversity": json_safe(fused_row.get("asn_geo_diversity")) if hasattr(fused_row, "get") else None,
        }
        evidence_signals = [
            {"model": "Anomaly detector", "finding": "Unusual transaction profile", "score": anomaly_component, "raw_score": anomaly_score, "weight": 0.25, "contribution": float(anomaly_component or 0) * 0.25},
            {"model": "Pattern classifier", "finding": f"Pattern: {pattern.replace('_', ' ')}", "score": pattern_component, "raw_score": illicit_probability, "weight": 0.50, "contribution": float(pattern_component or 0) * 0.50},
            {"model": "Graph propagation", "finding": "Seed-wallet neighborhood risk", "score": propagation_component, "raw_score": propagated_risk, "weight": 0.25, "contribution": float(propagation_component or 0) * 0.25},
        ]
        details = {
            **{key: json_safe(tx.get(key)) for key in ("timestamp", "src_ip", "src_port", "dst_ip", "dst_port", "geo_country", "asn", "asn_owner") if tx.get(key) is not None},
            "risk_score": risk,
            "confidence_pct": json_safe(fused_row.get("confidence_pct")) if hasattr(fused_row, "get") else None,
            "pattern_pred": pattern,
            "reason": str(fused_row.get("reason", "")) if hasattr(fused_row, "get") else "",
            "anomaly_score": anomaly_score,
            "anomaly_score_normalized": anomaly_component,
            "illicit_proba": illicit_probability,
            "illicit_proba_normalized": pattern_component,
            "propagated_risk": propagated_risk,
            "propagated_risk_normalized": propagation_component,
            "in_peeling_chain": bool(fused_row.get("in_peeling_chain", False)) if hasattr(fused_row, "get") else False,
            "risk_formula": "25% anomaly score + 50% pattern probability + 25% graph-propagated risk (normalized in model fusion)",
            "evidence_signals": evidence_signals,
            "transaction_features": {key: value for key, value in transaction_features.items() if value is not None},
        }
        add_node(f"tx:{txid}", txid[:12] + "…", "transaction", risk, f"tx:{txid}" == root_node_id, details)

        src_ip = tx.get("src_ip")
        dst_ip = tx.get("dst_ip")
        if pd.notna(src_ip) and str(src_ip):
            ip_node = f"ip:{src_ip}"
            related_count = int(ip_observations.get(str(src_ip), 0))
            add_node(ip_node, str(src_ip), "ip", risk, False, {
                "address": str(src_ip), "port": json_safe(tx.get("src_port")),
                "timestamp": json_safe(tx.get("timestamp")), "geo_country": json_safe(tx.get("geo_country")),
                "asn": json_safe(tx.get("asn")), "asn_owner": json_safe(tx.get("asn_owner")),
                "related_transaction_count": related_count,
            })
            edge_rows.append({"source": ip_node, "target": f"tx:{txid}", "kind": "broadcast",
                              "label": f"port {tx.get('src_port', '—')}",
                              "details": {"port": json_safe(tx.get("src_port")), "timestamp": json_safe(tx.get("timestamp"))}})
        if pd.notna(dst_ip) and str(dst_ip):
            ip_node = f"ip:{dst_ip}"
            add_node(ip_node, str(dst_ip), "ip", risk, False, {
                "address": str(dst_ip), "port": json_safe(tx.get("dst_port")),
                "timestamp": json_safe(tx.get("timestamp")), "geo_country": json_safe(tx.get("geo_country")),
                "asn": json_safe(tx.get("asn")), "asn_owner": json_safe(tx.get("asn_owner")),
                "related_transaction_count": int(ip_observations.get(str(dst_ip), 0)),
            })
            edge_rows.append({"source": f"tx:{txid}", "target": ip_node, "kind": "peer",
                              "label": f"port {tx.get('dst_port', '—')}",
                              "details": {"port": json_safe(tx.get("dst_port")), "timestamp": json_safe(tx.get("timestamp"))}})

        propagated = 0.0
        # Input funds flow from wallet to transaction; outputs flow from
        # transaction to recipient wallet.
        for group, kind, direction in ((input_rows, "input", "wallet-tx"), (output_rows, "output", "tx-wallet")):
            if txid not in group.groups:
                continue
            for _, relation in group.get_group(txid).iterrows():
                address = str(relation["address"])
                wallet_node = f"wallet:{address}"
                wallet_risk = float(address_risk.get(address, 0.0))
                propagated = max(propagated, wallet_risk)
                add_node(wallet_node, address[:14] + "…", "wallet", wallet_risk, False, {"address": address, "propagated_risk": wallet_risk, "related_transaction_count": len(wallet_transactions.get(address, set()))})
                amount = json_safe(relation.get("amount_btc"))
                source, target = (wallet_node, f"tx:{txid}") if direction == "wallet-tx" else (f"tx:{txid}", wallet_node)
                amount_label = f"{float(amount):.8g} BTC" if amount is not None else ""
                edge_rows.append({"source": source, "target": target, "kind": kind, "label": amount_label,
                                  "details": {"amount": amount}})

        if txid in tx_graph:
            for parent in tx_graph.predecessors(txid):
                if str(parent) in txids:
                    edge_rows.append({"source": f"tx:{parent}", "target": f"tx:{txid}", "kind": "transaction_flow", "label": "upstream transaction", "details": {}})
            for child in tx_graph.successors(txid):
                if str(child) in txids:
                    edge_rows.append({"source": f"tx:{txid}", "target": f"tx:{child}", "kind": "transaction_flow", "label": "downstream transaction", "details": {}})

    if root_node_id and root_node_id not in node_map:
        if focus_kind == "wallet":
            add_node(root_node_id, focus_value[:14] + "…", "wallet", address_risk.get(focus_value, 0.0), True,
                     {"address": focus_value, "propagated_risk": float(address_risk.get(focus_value, 0.0)), "related_transaction_count": len(wallet_transactions.get(focus_value, set()))})
        elif focus_kind == "ip":
            add_node(root_node_id, focus_value, "ip", 0.0, True, {"address": focus_value})
    elif root_node_id in node_map:
        node_map[root_node_id]["highlighted"] = True

    unique_edges = {}
    for edge in edge_rows:
        key = (edge["source"], edge["target"], edge.get("kind"), edge.get("label"), str((edge.get("details") or {}).get("amount")))
        unique_edges[key] = edge
    return {"nodes": list(node_map.values()), "edges": list(unique_edges.values())}


@app.get("/health")
async def health():
    if bundle is None:
        return JSONResponse(
            {"status": "unavailable", "artifacts_loaded": False},
            status_code=503,
        )
    return {"status": "ok", "artifacts_loaded": True}


@app.post("/api/ingestion/analyze")
async def analyze_uploaded_dataset(request: Request, file: UploadFile = File(...)):
    """Parse an offline CSV/JSON/XML upload and score it with the saved models."""
    filename = Path(file.filename or "dataset").name
    try:
        content = await file.read(local_ingestion.MAX_UPLOAD_BYTES + 1)
        parsed = local_ingestion.parse_and_normalize(filename, content)
        analyzed = import_analysis.analyze_records(parsed, get_bundle())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Local dataset analysis failed for %s", filename)
        raise HTTPException(status_code=422, detail=f"Dataset analysis failed: {exc}") from exc
    finally:
        await file.close()

    session_id = request.state.session_id
    if session_id not in ingestion_sessions and len(ingestion_sessions) >= MAX_INGESTION_SESSIONS:
        oldest_id = min(ingestion_sessions, key=lambda key: ingestion_sessions[key][1])
        ingestion_sessions.pop(oldest_id, None)
    ingestion_sessions[session_id] = ({**analyzed, "filename": filename}, time.monotonic())
    ranked = analyzed["scored"].sort_values("risk_score", ascending=False)
    top_alerts = []
    for row in ranked.head(10).to_dict(orient="records"):
        top_alerts.append({
            "txid": row["txid"], "risk_score": float(row["risk_score"]),
            "confidence_pct": float(row["confidence_pct"]), "pattern_pred": str(row["pattern_pred"]),
            "reason": str(row["reason"]),
        })
    return json_safe({
        "filename": filename,
        "summary": analyzed["summary"],
        "sample": list(analyzed["records"].values())[:5],
        "top_alerts": top_alerts,
    })


@app.get("/api/ingestion/session")
async def get_ingestion_session():
    if not current_session_data():
        return {"active": False, "summary": None, "filename": None}
    return json_safe({"active": True, "summary": current_session_data()["summary"],
                      "filename": current_session_data()["filename"]})


@app.get("/api/ingestion/alerts")
async def get_ingested_alerts(limit: int = Query(100, ge=1, le=500)):
    if not current_session_data():
        raise HTTPException(status_code=409, detail="Upload and analyze a local dataset first.")
    rows = current_session_data()["scored"].sort_values("risk_score", ascending=False).head(limit)
    return json_safe(rows.to_dict(orient="records"))


@app.get("/api/ingestion/graph")
async def get_ingested_graph(top_k: int = Query(20, ge=1, le=50)):
    if not current_session_data():
        raise HTTPException(status_code=409, detail="Upload and analyze a local dataset first.")
    return json_safe(import_analysis.graph_payload(current_session_data(), top_k=top_k))


@app.delete("/api/ingestion/session")
async def clear_ingestion_session(request: Request):
    ingestion_sessions.pop(request.state.session_id, None)
    return {"active": False}


@app.get("/api/overview/stats")
async def get_overview_stats():
    b = get_bundle()
    if current_session_data():
        summary = current_session_data()["summary"]
        observed_wallets = {
            str(address)
            for record in current_session_data()["records"].values()
            for address in record.get("input_addresses", []) + record.get("output_addresses", [])
            if address
        }
        wallet_data_available = bool(observed_wallets)
        seed_frame = b.get("tables", {}).get("seed_illicit", pd.DataFrame())
        seed_addresses = set(seed_frame.get("address", pd.Series(dtype=str)).dropna().astype(str))
        return {
            "transactions_analyzed": summary["transactions_analyzed"],
            "wallets_tracked": summary["wallets_correlated"],
            "wallet_data_available": wallet_data_available,
            "flow_data_available": wallet_data_available,
            "seed_wallet_data_available": wallet_data_available and bool(seed_addresses),
            "seed_illicit_wallets": len(observed_wallets & seed_addresses) if wallet_data_available else None,
            "peeling_chains_found": summary["peeling_chain_count"] if wallet_data_available else None,
            "ensemble_auc": None,
            "ground_truth_available": bool(summary.get("ground_truth_available", False)),
            "ground_truth_labeled": int(summary.get("ground_truth_labeled", 0)),
            "ground_truth_licit": int(summary.get("ground_truth_licit", 0)),
            "ground_truth_illicit": int(summary.get("ground_truth_illicit", 0)),
            "dataset_mode": "import",
        }
    tables = b["tables"]
    chains = b["chains"]
    ensemble_auc = b["ensemble_auc"]
    return {
        "transactions_analyzed": int(len(tables["transactions"])),
        "wallets_tracked": int(len(tables["wallets"])),
        "seed_illicit_wallets": int(len(tables["seed_illicit"])),
        "peeling_chains_found": len(chains),
        "ensemble_auc": float(ensemble_auc),
        "wallet_data_available": bool(len(tables["tx_inputs"]) or len(tables["tx_outputs"])),
        "flow_data_available": bool(len(tables["tx_inputs"]) or len(tables["tx_outputs"])),
        "seed_wallet_data_available": bool(len(tables["seed_illicit"])),
        "ground_truth_available": bool("is_illicit" in tables["labels"] and tables["labels"]["is_illicit"].notna().any()),
        "dataset_mode": "reference",
    }


@app.get("/api/overview/correlated-sample")
async def get_correlated_sample(limit: int = Query(15, ge=1, le=200)):
    if current_session_data():
        sample = []
        for record in list(current_session_data()["records"].values())[:limit]:
            row = dict(record)
            row["input_address"] = record["input_addresses"][0] if record["input_addresses"] else None
            row["input_amount"] = record["input_amounts"][0] if record["input_amounts"] else None
            row["pattern_type"] = record.get("pattern_pred", "unknown")
            sample.append(row)
        return json_safe(sample)
    b = get_bundle()
    sample = b["tables"]["correlated_sample"].head(limit)
    return df_to_records(sample)


@app.get("/api/overview/pattern-composition")
async def get_pattern_composition():
    if current_session_data():
        counts = current_session_data()["scored"]["pattern_pred"].value_counts()
        return [{"pattern_type": str(pattern), "count": int(count)} for pattern, count in counts.items()]
    b = get_bundle()
    vc = b["tables"]["labels"]["pattern_type"].value_counts().reset_index()
    vc.columns = ["pattern_type", "count"]
    return df_to_records(vc)


@app.get("/api/overview/illicit-vs-licit")
async def get_illicit_vs_licit():
    if current_session_data():
        summary = current_session_data()["summary"]
        if summary.get("ground_truth_available"):
            distribution = [
                {"label": "Licit", "count": int(summary.get("ground_truth_licit", 0))},
                {"label": "Illicit", "count": int(summary.get("ground_truth_illicit", 0))},
            ]
            unlabeled = int(summary.get("ground_truth_unlabeled", 0))
            if unlabeled:
                distribution.append({"label": "Unlabeled", "count": unlabeled})
            return distribution
        return [{"label": "unlabeled import", "count": summary["transactions_analyzed"]}]
    b = get_bundle()
    labels = b["tables"]["labels"].get("is_illicit", pd.Series(dtype=float)).dropna()
    illicit_count = int(pd.to_numeric(labels, errors="coerce").fillna(0).astype(int).eq(1).sum())
    licit_count = int(pd.to_numeric(labels, errors="coerce").fillna(0).astype(int).eq(0).sum())
    return [
        {"label": "Licit", "count": licit_count},
        {"label": "Illicit", "count": illicit_count},
    ]


@app.get("/api/overview/focus-areas")
async def get_focus_areas():
    b = get_bundle()
    clustering = b["clustering"]
    anomaly = b["anomaly"]
    anomaly_auc = anomaly.get("ensemble_roc_auc")
    if anomaly_auc is None:
        anomaly_auc = anomaly.get("metrics", {}).get("roc_auc", 0)
    pattern = b["pattern"]
    risk = b["risk"]
    return [
        {
            "focus_area": "Entity Clustering",
            "method": "Union-Find (common-input) + graph embedding (SVD) + K-Means",
            "headline_metric": f"NMI {clustering['metrics']['embedding_nmi']:.2f}",
        },
        {
            "focus_area": "Anomaly Detection",
            "method": "Supervised XGBoost + LightGBM + RandomForest ensemble",
            "headline_metric": f"ROC-AUC {float(anomaly_auc):.2f}",
        },
        {
            "focus_area": "Peeling-Chain / Mixing",
            "method": "RandomForest + graph-structural features + chain-walk detector",
            "headline_metric": f"macro-F1 {pattern['report']['macro avg']['f1-score']:.2f}",
        },
        {
            "focus_area": "Risk Scoring",
            "method": "Personalized PageRank from seed illicit wallets",
            "headline_metric": f"wallet ROC-AUC {risk['metrics']['wallet_level_auc']:.2f}",
        },
    ]


@app.get("/api/investigate/transaction/{txid}")
async def get_transaction(txid: str):
    b = get_bundle()
    if current_session_data() and txid in current_session_data()["records"]:
        return json_safe(current_session_data()["records"][txid])
    fused = b["fused"]
    scored_row = fused.loc[fused.txid == txid]
    if scored_row.empty:
        raise HTTPException(status_code=404, detail=f"TXID {txid} not found")
    row = scored_row.iloc[0]
    tx_rows = b["tables"]["transactions"].loc[b["tables"]["transactions"].txid == txid]
    if tx_rows.empty:
        raise HTTPException(status_code=404, detail=f"Network metadata for TXID {txid} not found")
    tx = tx_rows.iloc[0]
    inputs = b["tables"]["tx_inputs"].loc[b["tables"]["tx_inputs"].txid == txid]
    outputs = b["tables"]["tx_outputs"].loc[b["tables"]["tx_outputs"].txid == txid]
    signals = []
    if row["pattern_pred"] != "normal":
        signals.append({"model": "Pattern Random Forest", "finding": f"classified as {str(row['pattern_pred']).replace('_', ' ')}", "score": float(row["illicit_proba"])})
    if float(row.get("anomaly_score", 0)) >= 0.8:
        signals.append({"model": "Supervised anomaly ensemble", "finding": "unusual transaction profile", "score": float(row["anomaly_score"])})
    if float(row.get("propagated_risk", 0)) >= 0.65:
        signals.append({"model": "Seed-wallet graph propagation", "finding": "elevated propagated risk", "score": float(row["propagated_risk"])})
    if bool(row.get("in_peeling_chain", False)):
        signals.append({"model": "Transaction-flow graph", "finding": "part of a detected peeling chain", "score": 1.0})
    return json_safe({
        "txid": txid,
        "timestamp": tx.get("timestamp"),
        "src_ip": tx.get("src_ip"), "src_port": tx.get("src_port"),
        "dst_ip": tx.get("dst_ip"), "dst_port": tx.get("dst_port"),
        "geo_country": tx.get("real_geo_country") or tx.get("geo_country"),
        "asn": tx.get("asn"), "asn_owner": tx.get("real_asn_name") or tx.get("asn_owner"),
        "num_inputs": int(tx.get("num_inputs", len(inputs))), "num_outputs": int(tx.get("num_outputs", len(outputs))),
        "total_input_btc": float(tx.get("total_input_btc", 0)), "total_output_btc": float(tx.get("total_output_btc", 0)),
        "fee_btc": float(tx.get("fee_btc", 0)), "script_type": tx.get("script_type"),
        "input_addresses": inputs["address"].astype(str).tolist(),
        "input_amounts": [float(value) for value in inputs["amount_btc"].tolist()],
        "output_addresses": outputs["address"].astype(str).tolist(),
        "output_amounts": [float(value) for value in outputs["amount_btc"].tolist()],
        "confidence_pct": float(row["confidence_pct"]), "pattern_pred": row["pattern_pred"],
        "risk_score": float(row["risk_score"]), "reason": row["reason"],
        "is_illicit": bool(row["is_illicit"]), "anomaly_score": float(row.get("anomaly_score", 0)),
        "propagated_risk": float(row.get("propagated_risk", 0)), "illicit_proba": float(row.get("illicit_proba", 0)),
        "in_peeling_chain": bool(row.get("in_peeling_chain", False)),
        "evidence": {"signals": signals},
    })


@app.get("/api/investigate/wallet/{address}")
async def get_wallet(address: str):
    b = get_bundle()
    if current_session_data():
        matching = [record for record in current_session_data()["records"].values()
                    if address in record["input_addresses"] or address in record["output_addresses"]]
        if matching:
            return {
                "address": address,
                "propagated_risk": max((float(record.get("propagated_risk", 0)) for record in matching), default=0.0),
                "entity_type": "observed wallet",
                "is_illicit": None,
                "predicted_entity_cluster": None,
                "transaction_count": len(matching),
                "related_txids": [record["txid"] for record in matching[:100]],
                "related_transactions": [{key: record.get(key) for key in ("txid", "risk_score", "confidence_pct", "pattern_pred", "reason")} for record in matching[:100]],
                "note": "Imported data has no ground-truth ownership labels; cluster and illicit status are not asserted.",
            }
    risk = b["risk"]
    clustering = b["clustering"]
    wdf = risk["wallets"]
    wrow = wdf.loc[wdf.address == address]
    if wrow.empty:
        raise HTTPException(status_code=404, detail=f"Wallet {address} not found")
    wrow = wrow.iloc[0]

    cdf = clustering["wallet_clusters"].loc[clustering["wallet_clusters"].address == address]
    predicted_cluster = int(cdf.iloc[0]["predicted_entity_cluster"]) if not cdf.empty else None
    related_txids = set(b["tables"]["tx_inputs"].loc[b["tables"]["tx_inputs"].address == address, "txid"].astype(str))
    related_txids.update(b["tables"]["tx_outputs"].loc[b["tables"]["tx_outputs"].address == address, "txid"].astype(str))
    tx_rows = b["fused"].loc[b["fused"].txid.astype(str).isin(related_txids)].sort_values("risk_score", ascending=False)

    return {
        "address": wrow["address"],
        "propagated_risk": float(wrow["propagated_risk"]),
        "entity_type": wrow["entity_type"],
        "is_illicit": bool(wrow["is_illicit"]),
        "predicted_entity_cluster": predicted_cluster,
        "transaction_count": len(related_txids),
        "related_txids": list(related_txids)[:100],
        "related_transactions": json_safe(tx_rows[["txid", "risk_score", "confidence_pct", "pattern_pred", "reason"]].head(100).to_dict(orient="records")),
    }


@app.get("/api/investigate/transaction/{txid}/graph")
async def get_transaction_graph(txid: str):
    b = get_bundle()
    if current_session_data() and txid in current_session_data()["records"]:
        return json_safe(import_analysis.graph_payload(current_session_data(), focus_txid=txid))
    return json_safe(_dataset_graph_payload(b, focus_txid=txid))


@app.get("/api/graph/trace/{txid}")
async def get_transaction_trace(txid: str):
    """Return transaction inputs/outputs and observed local lineage only."""
    if current_session_data():
        return _transaction_trace_payload(txid, session=current_session_data())
    return _transaction_trace_payload(txid, b=get_bundle())


@app.get("/api/investigate/transaction/{txid}/shap")
async def get_shap_explanation(txid: str):
    b = get_bundle()
    if current_session_data() and txid in current_session_data()["records"]:
        shap_expl = pl.explain_with_shap(current_session_data()["pattern_result"], txid)
        if not shap_expl:
            raise HTTPException(status_code=404, detail=f"SHAP explanation not available for {txid}")
        return {
            "predicted_class": shap_expl["predicted_class"],
            "contributions": df_to_records(shap_expl["contributions"]),
        }
    pattern = b["pattern"]
    shap_expl = pl.explain_with_shap(pattern, txid)
    if not shap_expl:
        raise HTTPException(status_code=404, detail=f"SHAP explanation not available for {txid}")
    return {
        "predicted_class": shap_expl["predicted_class"],
        "contributions": df_to_records(shap_expl["contributions"]),
    }


@app.get("/api/alerts/ranked")
async def get_ranked_alerts(
    top_n: int = Query(50, ge=10, le=500),
    pattern_filter: str = Query(""),
):
    if current_session_data():
        view = current_session_data()["scored"]
        pattern_filters = [p for p in pattern_filter.split(",") if p] if pattern_filter else []
        if pattern_filters:
            view = view[view.pattern_pred.isin(pattern_filters)]
        view = view.sort_values("risk_score", ascending=False).head(top_n)
        return json_safe({"data": view.to_dict(orient="records"),
                          "total": len(current_session_data()["scored"]), "filtered": len(view)})
    b = get_bundle()
    fused = b["fused"]

    pattern_filters = [p for p in pattern_filter.split(",") if p] if pattern_filter else []

    view = fused
    if pattern_filters:
        view = view[view.pattern_pred.isin(pattern_filters)]

    view = view.sort_values("risk_score", ascending=False).head(top_n)

    alert_columns = [
        "txid", "confidence_pct", "risk_score", "anomaly_score", "propagated_risk",
        "illicit_proba", "pattern_pred", "is_illicit", "reason",
    ]
    display = view[alert_columns]

    return {
        "data": df_to_records(display),
        "total": len(fused),
        "filtered": len(view),
    }


@app.get("/api/alerts/download")
async def download_alerts(
    top_n: int = Query(50, ge=10, le=500),
    pattern_filter: str = Query(""),
):
    if current_session_data():
        view = current_session_data()["scored"]
        pattern_filters = [p for p in pattern_filter.split(",") if p] if pattern_filter else []
        if pattern_filters:
            view = view[view.pattern_pred.isin(pattern_filters)]
        display = view.sort_values("risk_score", ascending=False).head(top_n)[
            ["txid", "confidence_pct", "risk_score", "pattern_pred", "anomaly_score", "propagated_risk", "reason"]
        ].rename(columns={"confidence_pct": "confidence_%", "pattern_pred": "predicted_pattern"})
        csv_buffer = io.StringIO()
        display.to_csv(csv_buffer, index=False)
        return StreamingResponse(
            io.BytesIO(csv_buffer.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=imported_ranked_alerts.csv"},
        )
    b = get_bundle()
    fused = b["fused"]

    pattern_filters = [p for p in pattern_filter.split(",") if p] if pattern_filter else []

    view = fused
    if pattern_filters:
        view = view[view.pattern_pred.isin(pattern_filters)]

    view = view.sort_values("risk_score", ascending=False).head(top_n)

    display = view[["txid", "confidence_pct", "pattern_pred", "is_illicit", "reason"]].rename(columns={
        "confidence_pct": "confidence_%",
        "pattern_pred": "predicted_pattern",
        "is_illicit": "ground_truth_illicit",
    })

    csv_buffer = io.StringIO()
    display.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)

    return StreamingResponse(
        io.BytesIO(csv_buffer.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ranked_alerts.csv"},
    )


@app.get("/api/clusters/metrics")
async def get_cluster_metrics():
    b = get_bundle()
    metrics = b["clustering"]["metrics"]
    return {
        "embedding_nmi": float(metrics.get("embedding_nmi", 0)),
        "embedding_homogeneity": float(metrics.get("embedding_homogeneity", 0)),
        "embedding_completeness": float(metrics.get("embedding_completeness", 0)),
        "embedding_v_measure": float(metrics.get("embedding_v_measure", 0)),
    }


@app.get("/api/clusters/embeddings")
async def get_cluster_embeddings(sample: int = Query(4000, ge=100, le=10000)):
    b = get_bundle()
    combo = b["clustering"]["wallet_clusters"]
    sampled = combo.sample(min(sample, len(combo)), random_state=42)
    return df_to_records(sampled[["address", "entity_type", "is_illicit", "true_entity", "pc1", "pc2", "predicted_entity_cluster"]])


@app.get("/api/clusters/ids")
async def get_cluster_ids():
    b = get_bundle()
    combo = b["clustering"]["wallet_clusters"]
    top_clusters = combo.predicted_entity_cluster.value_counts().head(50).index.tolist()
    return [int(x) for x in top_clusters]


@app.get("/api/clusters/{cluster_id}")
async def get_cluster(cluster_id: int):
    b = get_bundle()
    combo = b["clustering"]["wallet_clusters"]
    cluster_data = combo.loc[combo.predicted_entity_cluster == cluster_id]
    return df_to_records(cluster_data[["address", "entity_type", "is_illicit", "true_entity", "pc1", "pc2", "predicted_entity_cluster"]])


@app.get("/api/graph/link-analysis")
async def get_link_analysis(
    top_k: int = Query(60, ge=1, le=150),
    focus_txid: str | None = Query(None),
    focus_node_id: str | None = Query(None),
):
    b = get_bundle()
    if current_session_data():
        return json_safe(import_analysis.graph_payload(current_session_data(), top_k=top_k, focus_txid=focus_txid, focus_node_id=focus_node_id))
    return json_safe(_dataset_graph_payload(b, top_k=top_k, focus_txid=focus_txid, focus_node_id=focus_node_id))


@app.get("/api/graph/expand")
async def expand_graph_node(
    node_id: str = Query(..., min_length=4, max_length=512),
    top_k: int = Query(10, ge=1, le=20),
):
    """Return a bounded local neighborhood for an interactive graph expansion."""
    if current_session_data():
        if node_id not in current_session_data()["graph"]:
            raise HTTPException(status_code=404, detail=f"Graph node {node_id} not found in the imported dataset")
        return json_safe(import_analysis.graph_payload(
            current_session_data(), top_k=top_k, focus_node_id=node_id,
        ))
    return json_safe(_dataset_graph_payload(
        get_bundle(), top_k=top_k, focus_node_id=node_id,
    ))


@app.get("/api/performance/anomaly")
async def get_anomaly_metrics():
    b = get_bundle()
    anomaly = b["anomaly"]
    metrics = anomaly.get("metrics")
    if metrics is not None:
        roc_curve_data = anomaly.get("roc_curve", ([], []))
        pr_curve_data = anomaly.get("pr_curve", ([], []))
        return json_safe({
            "metrics": metrics,
            "roc_curve": [roc_curve_data[0].tolist(), roc_curve_data[1].tolist()],
            "pr_curve": [pr_curve_data[0].tolist(), pr_curve_data[1].tolist()],
        })

    # Newer bundles store the ensemble metrics under explicit supervised keys.
    roc_curve_data = anomaly.get("ensemble_roc_curve", ([], []))
    pr_curve_data = anomaly.get("ensemble_pr_curve", ([], []))
    as_list = lambda values: values.tolist() if hasattr(values, "tolist") else list(values)
    return json_safe({
        "metrics": {
            "roc_auc": anomaly.get("ensemble_roc_auc", 0),
            "pr_auc": anomaly.get("ensemble_pr_auc", 0),
        },
        "roc_curve": [as_list(roc_curve_data[0]), as_list(roc_curve_data[1])],
        "pr_curve": [as_list(pr_curve_data[0]), as_list(pr_curve_data[1])],
    })


@app.get("/api/performance/anomaly/supervised")
async def get_supervised_anomaly_metrics():
    b = get_bundle()
    anomaly = b.get("anomaly_supervised")
    if not anomaly:
        # Older bundles keep the supervised result in the main anomaly slot.
        anomaly = b["anomaly"]
    if "ensemble_roc_curve" not in anomaly:
        metrics = anomaly.get("metrics", {})
        roc_curve_data = anomaly.get("roc_curve", ([], []))
        pr_curve_data = anomaly.get("pr_curve", ([], []))
        as_list = lambda values: values.tolist() if hasattr(values, "tolist") else list(values)
        return json_safe({
            "ensemble_roc_auc": metrics.get("roc_auc", 0),
            "ensemble_pr_auc": metrics.get("pr_auc", 0),
            "xgb_roc_auc": 0,
            "xgb_pr_auc": 0,
            "lgb_roc_auc": 0,
            "lgb_pr_auc": 0,
            "rf_roc_auc": 0,
            "rf_pr_auc": 0,
            "iso_roc_auc": metrics.get("roc_auc", 0),
            "iso_pr_auc": metrics.get("pr_auc", 0),
            "cal_roc_auc": 0,
            "cal_pr_auc": 0,
            "ensemble_roc_curve": [as_list(roc_curve_data[0]), as_list(roc_curve_data[1])],
            "ensemble_pr_curve": [as_list(pr_curve_data[0]), as_list(pr_curve_data[1])],
            "feature_importance": {},
            "threshold_analysis": [],
            "precision_at_k": [],
        })
    return json_safe({
        "ensemble_roc_auc": anomaly.get("ensemble_roc_auc", 0),
        "ensemble_pr_auc": anomaly.get("ensemble_pr_auc", 0),
        "xgb_roc_auc": anomaly.get("xgb_roc_auc", 0),
        "xgb_pr_auc": anomaly.get("xgb_pr_auc", 0),
        "lgb_roc_auc": anomaly.get("lgb_roc_auc", 0),
        "lgb_pr_auc": anomaly.get("lgb_pr_auc", 0),
        "rf_roc_auc": anomaly.get("rf_roc_auc", 0),
        "rf_pr_auc": anomaly.get("rf_pr_auc", 0),
        "iso_roc_auc": anomaly.get("iso_roc_auc", 0),
        "iso_pr_auc": anomaly.get("iso_pr_auc", 0),
        "cal_roc_auc": anomaly.get("cal_roc_auc", 0),
        "cal_pr_auc": anomaly.get("cal_pr_auc", 0),
        "ensemble_roc_curve": [anomaly["ensemble_roc_curve"][0].tolist(), anomaly["ensemble_roc_curve"][1].tolist()] if anomaly.get("ensemble_roc_curve") else [[], []],
        "ensemble_pr_curve": [anomaly["ensemble_pr_curve"][0].tolist(), anomaly["ensemble_pr_curve"][1].tolist()] if anomaly.get("ensemble_pr_curve") else [[], []],
        "feature_importance": anomaly.get("feature_importance", {}),
        "threshold_analysis": anomaly.get("threshold_analysis", []),
        "precision_at_k": anomaly.get("precision_at_k", []),
    })


@app.get("/api/performance/pattern")
async def get_pattern_metrics():
    b = get_bundle()
    pattern = b["pattern"]
    return {
        "confusion_matrix": pattern["confusion_matrix"].tolist(),
        "classes": pattern["classes"],
        "feature_importance": pattern["feature_importance"].to_dict(),
        "report": pattern["report"],
    }


@app.get("/api/performance/risk")
async def get_risk_metrics():
    b = get_bundle()
    risk = b["risk"]
    return risk["metrics"]


@app.get("/api/performance/ensemble")
async def get_ensemble_auc():
    b = get_bundle()
    return {"ensemble_auc": float(b["ensemble_auc"])}


@app.get("/api/performance/risk-distribution")
async def get_risk_distribution():
    b = get_bundle()
    fused = b["fused"]
    bins = pd.cut(fused["risk_score"], bins=20, include_lowest=True)
    truth = fused["is_illicit"].map({0: "licit", 1: "illicit"})
    dist = fused.groupby([bins, truth], observed=False).size().unstack(fill_value=0)
    dist = dist.reindex(columns=["licit", "illicit"], fill_value=0)
    return [
        {
            "bin": f"{(0.0 if abs(interval.left) < 0.005 else interval.left):.2f}–{(0.0 if abs(interval.right) < 0.005 else interval.right):.2f}",
            "licit": int(row["licit"]),
            "illicit": int(row["illicit"]),
        }
        for interval, row in dist.iterrows()
    ]


@app.get("/api/performance/shap-global")
async def get_shap_global():
    b = get_bundle()
    shap_global = b["shap_global"]
    return [{"feature": idx, "importance": float(val)} for idx, val in shap_global.items()]


if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")

    @app.get("/{requested_path:path}", include_in_schema=False)
    async def serve_frontend(requested_path: str):
        # Skip API paths - let them return proper 404 JSON responses
        if requested_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        dist_root = FRONTEND_DIST.resolve()
        requested_file = (dist_root / requested_path).resolve()
        if dist_root not in requested_file.parents and requested_file != dist_root:
            raise HTTPException(status_code=404, detail="Not found")
        if requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(dist_root / "index.html")
else:
    @app.get("/", include_in_schema=False)
    async def frontend_not_built():
        return {
            "message": "The dashboard has not been built yet.",
            "instructions": "Run npm run build in the frontend folder, then restart the local server.",
            "api_docs": "/docs",
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
