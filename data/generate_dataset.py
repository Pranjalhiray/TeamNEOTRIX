#!/usr/bin/env python3


import argparse
import hashlib
import json
import random
import string
import sys
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Config / reference pools
# --------------------------------------------------------------------------

N_TIME_STEPS = 49  # matches Elliptic++ time-step count

ENTITY_TYPES = {
    # type: (probability, is_illicit, wallets_range, description)
    "normal":         (0.940, False, (1, 4)),
    "exchange":       (0.005, False, (80, 250)),
    "mixer":          (0.010, False, (20, 80)),     # mixers themselves aren't
                                                     # classed illicit by default;
                                                     # a fraction are flagged (see below)
    "ransomware":     (0.010, True,  (3, 10)),
    "darknet_market":  (0.010, True,  (5, 20)),
    "scam":           (0.015, True,  (3, 12)),
    "launderer":      (0.010, True,  (5, 15)),
}

SCRIPT_TYPES = ["P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"]
SCRIPT_WEIGHTS = [0.35, 0.25, 0.25, 0.10, 0.05]

# Small pool of (country, ASN, ASN-owner) tuples used for licit "home" geos
STABLE_GEO_POOL = [
    ("US", 15169, "GOOGLE"), ("US", 16509, "AMAZON-02"), ("DE", 24940, "HETZNER"),
    ("NL", 60781, "LEASEWEB"), ("SG", 45102, "ALIBABA-CN"), ("IN", 55836, "RELIANCEJIO"),
    ("GB", 8075, "MICROSOFT"), ("FR", 12876, "SCALEWAY"), ("JP", 2516, "KDDI"),
    ("CA", 16276, "OVH"), ("AU", 1221, "TELSTRA"), ("BR", 28573, "CLARO-BR"),
]

# Wider, more diverse pool used for illicit / VPN-rotating traffic
ROTATING_GEO_POOL = STABLE_GEO_POOL + [
    ("RU", 197695, "VELCOM"), ("RO", 9009, "M247"), ("SC", 132203, "TENCENT-SC"),
    ("PA", 62240, "CLOUVIDER"), ("IS", 44925, "1984-HOSTING"), ("CH", 200019, "IP-VOLUME"),
    ("VG", 138915, "OFFSHORE-VPN"), ("KY", 208046, "CAYMAN-HOST"), ("HK", 132203, "TENCENT-HK"),
    ("NG", 37148, "MAINONE"), ("UA", 6849, "UKRTELECOM"), ("BG", 43391, "NEOTERIC"),
]

BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

rng = random.Random()
nprng = np.random.default_rng()


def seed_all(seed: int):
    global rng, nprng
    rng = random.Random(seed)
    nprng = np.random.default_rng(seed)


# --------------------------------------------------------------------------
# Synthetic primitives
# --------------------------------------------------------------------------

def fake_hash(prefix: str, i: int) -> str:
    """Deterministic-looking 64-char hex hash for txids."""
    h = hashlib.sha256(f"{prefix}-{i}-{rng.random()}".encode()).hexdigest()
    return h


def fake_address(entity_id: int, wallet_idx: int) -> str:
    style = rng.random()
    body = "".join(rng.choice(BASE58_ALPHABET) for _ in range(31))
    if style < 0.55:
        return "1" + body[:33]
    elif style < 0.80:
        return "3" + body[:33]
    else:
        # bech32-style
        b32 = "".join(rng.choice("023456789acdefghjklmnpqrstuvwxyz") for _ in range(38))
        return "bc1q" + b32


def fake_ip(pool_tag: str) -> str:
    # Avoid 0/10/127/169.254/172.16-31/192.168 private-ish ranges for realism
    while True:
        a = rng.randint(1, 223)
        if a in (10, 127, 169, 172, 192):
            continue
        b, c, d = rng.randint(0, 255), rng.randint(0, 255), rng.randint(1, 254)
        return f"{a}.{b}.{c}.{d}"


# --------------------------------------------------------------------------
# Entity / wallet model
# --------------------------------------------------------------------------

@dataclass
class Entity:
    entity_id: int
    etype: str
    is_illicit: bool
    wallets: list = field(default_factory=list)
    geo_pool: list = field(default_factory=list)
    ip_pool: list = field(default_factory=list)
    home_geo: tuple = None


def build_entities(n_entities: int):
    types = list(ENTITY_TYPES.keys())
    probs = [ENTITY_TYPES[t][0] for t in types]
    entities = []
    wallet_registry = {}  # address -> (entity_id, etype, is_illicit)
    wallet_owner_list = []  # for wallets.csv

    for eid in range(n_entities):
        etype = nprng.choice(types, p=probs)
        _, base_illicit, wrange = ENTITY_TYPES[etype]
        is_illicit = base_illicit
        if etype == "mixer":
            # ~20% of mixers are themselves flagged as knowingly-illicit-run
            is_illicit = rng.random() < 0.2

        n_wallets = rng.randint(*wrange)

        # geo / ip footprint
        if is_illicit or etype == "mixer":
            geo_pool = rng.sample(ROTATING_GEO_POOL, k=min(len(ROTATING_GEO_POOL), rng.randint(5, 12)))
            n_ips = rng.randint(15, 60)  # heavy IP rotation (VPN/Tor proxy)
        else:
            geo_pool = rng.sample(STABLE_GEO_POOL, k=rng.randint(1, 3))
            n_ips = rng.randint(1, 4)   # stable, small IP footprint

        ip_pool = [fake_ip(etype) for _ in range(n_ips)]

        ent = Entity(entity_id=eid, etype=etype, is_illicit=is_illicit,
                     geo_pool=geo_pool, ip_pool=ip_pool)

        for w in range(n_wallets):
            addr = fake_address(eid, w)
            ent.wallets.append(addr)
            wallet_registry[addr] = (eid, etype, is_illicit)
            wallet_owner_list.append({
                "address": addr,
                "entity_id": eid,
                "entity_type": etype,
                "is_illicit": int(is_illicit),
            })
        entities.append(ent)

    return entities, wallet_registry, wallet_owner_list


# --------------------------------------------------------------------------
# UTXO / transaction simulation
# --------------------------------------------------------------------------

def pick_geo_ip(entity: Entity):
    country, asn, asn_owner = rng.choice(entity.geo_pool)
    ip = rng.choice(entity.ip_pool)
    return ip, country, asn, asn_owner


def run_simulation(entities, n_target_tx, n_time_steps):
    """
    Simulate UTXO flow over discrete time steps, generating transactions,
    inputs/outputs, tx-tx edges, and per-tx labels.
    """
    # Seed the UTXO pool with genesis-style "fresh funding" coins per entity
    # (represents deposits/mining rewards/exchange withdrawals entering the
    # observed window from outside it).
    utxo_pool = []   # list of dict: address, amount, entity_id, tx_origin
    tx_rows, in_rows, out_rows, edge_rows, label_rows = [], [], [], [], []

    entity_by_id = {e.entity_id: e for e in entities}

    # seed pool: give every entity a few starting coins
    for e in entities:
        n_seed = 2 if e.etype in ("exchange", "mixer") else rng.randint(1, 2)
        for _ in range(n_seed):
            amt = float(nprng.lognormal(mean=-2.0, sigma=1.6))
            addr = rng.choice(e.wallets)
            utxo_pool.append({"address": addr, "amount": amt,
                               "entity_id": e.entity_id, "tx_origin": None})

    tx_counter = 0
    per_step = max(1, n_target_tx // n_time_steps)
    funding_per_step = max(5, n_target_tx // (n_time_steps * 20))

    illicit_entities = [e for e in entities if e.is_illicit]
    normal_like = [e for e in entities if not e.is_illicit]
    exchanges = [e for e in entities if e.etype == "exchange"]
    mixers = [e for e in entities if e.etype == "mixer"]

    t = 0
    attempts_this_step = 0
    max_total_attempts = n_target_tx * 20  # safety valve against infinite loops

    total_attempts = 0
    while tx_counter < n_target_tx and total_attempts < max_total_attempts:
        if attempts_this_step == 0:
            # inject a trickle of fresh external funding at the start of each step
            for _ in range(funding_per_step):
                e = rng.choice(entities)
                amt = float(nprng.lognormal(mean=-2.0, sigma=1.6))
                addr = rng.choice(e.wallets)
                utxo_pool.append({"address": addr, "amount": amt,
                                   "entity_id": e.entity_id, "tx_origin": None})

        total_attempts += 1
        attempts_this_step += 1
        if attempts_this_step >= per_step:
            attempts_this_step = 0
            t = (t + 1) % n_time_steps

        if len(utxo_pool) < 2:
            continue
        tx_counter += 1
        txid = fake_hash("tx", tx_counter)

        pattern_type = "normal"
        is_anomaly = False

        roll = rng.random()

        # ---- decide transaction archetype ----
        if illicit_entities and roll < 0.12:
            # Peeling chain step: pick an illicit entity, spend one of its
            # UTXOs, produce a big "continue chain" output (same/related
            # entity or a fresh hop-entity) + a small "peel off" output
            # often routed toward an exchange (cash-out).
            src_e = rng.choice(illicit_entities)
            candidate_idx = [i for i, u in enumerate(utxo_pool) if u["entity_id"] == src_e.entity_id]
            if not candidate_idx:
                src_utxo_idx = [rng.randrange(len(utxo_pool))]
            else:
                src_utxo_idx = [rng.choice(candidate_idx)]
            inputs = [utxo_pool[i] for i in src_utxo_idx]
            total_in = sum(u["amount"] for u in inputs)
            fee = total_in * rng.uniform(0.0005, 0.003)
            remainder = total_in - fee
            peel_frac = rng.uniform(0.04, 0.18)
            peel_amt = remainder * peel_frac
            chain_amt = remainder - peel_amt

            chain_addr = rng.choice(src_e.wallets)
            if exchanges and rng.random() < 0.5:
                cashout_e = rng.choice(exchanges)
            else:
                cashout_e = rng.choice(illicit_entities)
            cashout_addr = rng.choice(cashout_e.wallets)

            outputs = [
                {"address": chain_addr, "amount": chain_amt, "entity_id": src_e.entity_id},
                {"address": cashout_addr, "amount": peel_amt, "entity_id": cashout_e.entity_id},
            ]
            pattern_type = "peeling_chain"
            broadcaster = src_e

        elif mixers and roll < 0.17:
            # CoinJoin-like: k participants each contribute an input and
            # receive an equal-value "denomination" output at a fresh
            # address (the anonymizing property of a real CoinJoin), plus
            # a change output back to themselves if their input exceeded
            # the denomination. Value is strictly conserved:
            # sum(outputs) + fee == sum(inputs).
            mixer_e = rng.choice(mixers)
            k = rng.randint(3, 8)
            participants = rng.sample(entities, k=min(k, len(entities)))
            fee_per = float(nprng.lognormal(mean=-9.0, sigma=0.5))  # tiny per-participant fee

            picked = []  # (entity, real_utxo_or_None, idx_or_None)
            for p in participants:
                cand = [i for i, u in enumerate(utxo_pool) if u["entity_id"] == p.entity_id]
                if cand:
                    idx = rng.choice(cand)
                    picked.append((p, utxo_pool[idx], idx))
                else:
                    picked.append((p, None, None))

            real_amounts = [u["amount"] for _, u, _ in picked if u is not None]
            if real_amounts:
                # leave headroom for fee_per so every real participant can
                # always afford denomination + their fee share
                std_amt = (min(real_amounts) - fee_per) * rng.uniform(0.5, 0.85)
            else:
                std_amt = float(nprng.lognormal(mean=-1.8, sigma=0.4))
            std_amt = max(std_amt, 1e-8)

            inputs, outputs = [], []
            src_utxo_idx = []
            for p, real_u, idx in picked:
                if real_u is not None:
                    in_amt = real_u["amount"]
                    inputs.append(real_u)
                    src_utxo_idx.append(idx)
                else:
                    in_amt = std_amt + fee_per
                    inputs.append({"address": rng.choice(p.wallets), "amount": in_amt,
                                    "entity_id": p.entity_id, "tx_origin": None})
                denom_addr = rng.choice(p.wallets)
                outputs.append({"address": denom_addr, "amount": std_amt, "entity_id": p.entity_id})
                change = in_amt - std_amt - fee_per
                if change > 1e-8:
                    change_addr = rng.choice(p.wallets)
                    outputs.append({"address": change_addr, "amount": change, "entity_id": p.entity_id})

            total_in = sum(u["amount"] for u in inputs)
            fee = fee_per * len(picked)
            pattern_type = "mixing"
            broadcaster = mixer_e

        elif exchanges and roll < 0.30:
            # Exchange consolidation: many small inputs -> 1-2 hot-wallet outputs
            exch = rng.choice(exchanges)
            k = rng.randint(4, 15)
            cand = list(range(len(utxo_pool)))
            rng.shuffle(cand)
            src_utxo_idx = cand[:k]
            inputs = [utxo_pool[i] for i in src_utxo_idx]
            total_in = sum(u["amount"] for u in inputs)
            fee = total_in * rng.uniform(0.0002, 0.0015)
            remainder = total_in - fee
            out_addr = rng.choice(exch.wallets)
            outputs = [{"address": out_addr, "amount": remainder, "entity_id": exch.entity_id}]
            pattern_type = "normal"
            broadcaster = exch

        else:
            # Ordinary pay + change transaction
            idx = rng.randrange(len(utxo_pool))
            src_utxo = utxo_pool[idx]
            src_e = entity_by_id[src_utxo["entity_id"]]
            src_utxo_idx = [idx]
            inputs = [src_utxo]
            total_in = src_utxo["amount"]
            fee = total_in * rng.uniform(0.0005, 0.004)
            remainder = total_in - fee

            has_change = rng.random() < 0.7
            pay_frac = rng.uniform(0.3, 0.95) if has_change else 1.0
            pay_amt = remainder * pay_frac
            change_amt = remainder - pay_amt

            dest_e = rng.choice(normal_like) if rng.random() < 0.85 else rng.choice(entities)
            pay_addr = rng.choice(dest_e.wallets)
            change_addr = rng.choice(src_e.wallets)

            outputs = [{"address": pay_addr, "amount": pay_amt, "entity_id": dest_e.entity_id}]
            if change_amt > 1e-8:
                outputs.append({"address": change_addr, "amount": change_amt, "entity_id": src_e.entity_id})
            broadcaster = src_e

        # ---- occasional injected statistical anomaly (independent of illicit label) ----
        # Modeled as an unusually large fresh deposit consolidated into this tx
        # (a real, common trigger for AML alerting) rather than by breaking
        # input/output value conservation.
        if rng.random() < 0.01:
            is_anomaly = True
            extra_amt = float(nprng.lognormal(mean=2.5, sigma=1.0))  # BTC-scale outlier
            extra_fee = extra_amt * rng.uniform(0.0005, 0.002)
            anomaly_src_e = entity_by_id[outputs[0]["entity_id"]] if outputs else broadcaster
            inputs.append({"address": rng.choice(anomaly_src_e.wallets), "amount": extra_amt + extra_fee,
                            "entity_id": anomaly_src_e.entity_id, "tx_origin": None})
            outputs[0]["amount"] += extra_amt
            fee += extra_fee
            total_in = sum(i["amount"] for i in inputs)

        # ---- remove consumed real utxos from the pool by index ----
        for i in sorted(set(src_utxo_idx), reverse=True):
            if i < len(utxo_pool):
                utxo_pool.pop(i)

        # ---- add new outputs to pool as spendable UTXOs, track edges ----
        for o in outputs:
            utxo_pool.append({"address": o["address"], "amount": o["amount"],
                               "entity_id": o["entity_id"], "tx_origin": txid})

        for u in inputs:
            if u.get("tx_origin"):
                edge_rows.append({"src_txid": u["tx_origin"], "dst_txid": txid})

        # ---- network layer fields ----
        ip, country, asn, asn_owner = pick_geo_ip(broadcaster)
        dst_ip = fake_ip("peer")
        src_port = rng.randint(1024, 65535)
        dst_port = 8333

        timestamp = 1_580_000_000 + t * 21600 + rng.randint(0, 21599)  # ~6h per time step

        total_in_final = sum(i["amount"] for i in inputs)
        total_out_final = sum(o["amount"] for o in outputs)

        is_illicit_tx = int(broadcaster.is_illicit)
        # class: 1=illicit, 2=licit(confidently known-good), 3=unknown
        if is_illicit_tx:
            cls = 1
        elif broadcaster.etype in ("exchange",) or pattern_type == "mixing":
            cls = 2 if rng.random() < 0.6 else 3
        else:
            cls = 2 if rng.random() < 0.15 else 3  # most normal-user tx are "unknown" (unlabeled), like Elliptic

        risk_score = 1.0 if is_illicit_tx else (0.4 if pattern_type == "mixing" else round(rng.uniform(0.0, 0.05), 3))

        tx_rows.append({
            "txid": txid, "time_step": t, "timestamp": timestamp,
            "src_ip": ip, "src_port": src_port, "dst_ip": dst_ip, "dst_port": dst_port,
            "geo_country": country, "asn": asn, "asn_owner": asn_owner,
            "num_inputs": len(inputs), "num_outputs": len(outputs),
            "total_input_btc": round(total_in_final, 8),
            "total_output_btc": round(total_out_final, 8),
            "fee_btc": round(fee, 8),
            "script_type": nprng.choice(SCRIPT_TYPES, p=SCRIPT_WEIGHTS),
        })
        for u in inputs:
            in_rows.append({"txid": txid, "address": u["address"], "amount_btc": round(u["amount"], 8)})
        for o in outputs:
            out_rows.append({"txid": txid, "address": o["address"], "amount_btc": round(o["amount"], 8)})

        label_rows.append({
            "txid": txid, "class": cls, "is_illicit": is_illicit_tx,
            "pattern_type": pattern_type, "is_anomaly": int(is_anomaly),
            "risk_score": risk_score, "broadcaster_entity_id": broadcaster.entity_id,
        })

        if len(utxo_pool) > 40000:  # cap memory growth
            utxo_pool = utxo_pool[-30000:]

    if tx_counter < n_target_tx:
        print(f"  [warn] only generated {tx_counter}/{n_target_tx} transactions "
              f"before hitting the attempt safety valve", file=sys.stderr)

    return tx_rows, in_rows, out_rows, edge_rows, label_rows


# --------------------------------------------------------------------------
# Feature engineering (Elliptic-style tabular features for direct ML training)
# --------------------------------------------------------------------------

def build_features(tx_df, labels_df):
    df = tx_df.merge(labels_df[["txid", "class", "is_illicit", "pattern_type", "is_anomaly", "risk_score"]],
                      on="txid", how="left")

    df["fee_rate"] = df["fee_btc"] / df["total_input_btc"].replace(0, np.nan)
    df["avg_input_amount"] = df["total_input_btc"] / df["num_inputs"].replace(0, np.nan)
    df["avg_output_amount"] = df["total_output_btc"] / df["num_outputs"].replace(0, np.nan)
    df["io_ratio"] = df["num_inputs"] / df["num_outputs"].replace(0, np.nan)
    df["value_retained_frac"] = df["total_output_btc"] / df["total_input_btc"].replace(0, np.nan)
    df["is_round_output"] = (df["total_output_btc"].round(2) == df["total_output_btc"]).astype(int)
    df["log_total_input"] = np.log1p(df["total_input_btc"])

    # per-IP/geo behavioral features: how many distinct countries has this
    # src_ip's ASN owner appeared under in the whole dataset (proxy for
    # rotation / VPN behavior)
    geo_diversity = df.groupby("asn_owner")["geo_country"].nunique().rename("asn_geo_diversity")
    df = df.merge(geo_diversity, on="asn_owner", how="left")

    ip_freq = df["src_ip"].value_counts().rename("src_ip_tx_count")
    df = df.merge(ip_freq, left_on="src_ip", right_index=True, how="left")

    feature_cols = [
        "txid", "time_step", "num_inputs", "num_outputs", "total_input_btc",
        "total_output_btc", "fee_btc", "fee_rate", "avg_input_amount",
        "avg_output_amount", "io_ratio", "value_retained_frac", "is_round_output",
        "log_total_input", "asn_geo_diversity", "src_ip_tx_count", "script_type",
        "class", "is_illicit", "pattern_type", "is_anomaly", "risk_score",
    ]
    return df[feature_cols]


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="./output", help="output directory")
    ap.add_argument("--n-entities", type=int, default=3000)
    ap.add_argument("--n-transactions", type=int, default=50000)
    ap.add_argument("--time-steps", type=int, default=N_TIME_STEPS)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--nested-sample-size", type=int, default=1500,
                     help="how many tx to also emit as nested JSON (array fields, per PS spec)")
    args = ap.parse_args()

    seed_all(args.seed)

    import os
    os.makedirs(args.out, exist_ok=True)

    print(f"[1/6] Building {args.n_entities} entities & wallets ...", file=sys.stderr)
    entities, wallet_registry, wallet_owner_list = build_entities(args.n_entities)

    print(f"[2/6] Simulating UTXO flow for {args.n_transactions} transactions "
          f"over {args.time_steps} time steps ...", file=sys.stderr)
    tx_rows, in_rows, out_rows, edge_rows, label_rows = run_simulation(
        entities, args.n_transactions, args.time_steps)

    print("[3/6] Writing core tables ...", file=sys.stderr)
    tx_df = pd.DataFrame(tx_rows)
    in_df = pd.DataFrame(in_rows)
    out_df = pd.DataFrame(out_rows)
    edge_df = pd.DataFrame(edge_rows).drop_duplicates()
    label_df = pd.DataFrame(label_rows)
    wallets_df = pd.DataFrame(wallet_owner_list)

    ent_rows = [{"entity_id": e.entity_id, "entity_type": e.etype,
                 "is_illicit": int(e.is_illicit), "num_wallets": len(e.wallets)}
                for e in entities]
    entities_df = pd.DataFrame(ent_rows)

    tx_df.to_csv(f"{args.out}/transactions.csv", index=False)
    in_df.to_csv(f"{args.out}/tx_inputs.csv", index=False)
    out_df.to_csv(f"{args.out}/tx_outputs.csv", index=False)
    edge_df.to_csv(f"{args.out}/tx_edges.csv", index=False)
    label_df.to_csv(f"{args.out}/labels.csv", index=False)
    wallets_df.to_csv(f"{args.out}/wallets.csv", index=False)
    entities_df.to_csv(f"{args.out}/entities.csv", index=False)

    print("[4/6] Engineering ML-ready feature table ...", file=sys.stderr)
    features_df = build_features(tx_df, label_df)
    features_df.to_csv(f"{args.out}/features.csv", index=False)

    print("[5/6] Writing seed illicit wallet list (limited intel) ...", file=sys.stderr)
    illicit_wallets = wallets_df[wallets_df.is_illicit == 1]["address"].tolist()
    n_seed = max(5, int(0.03 * len(illicit_wallets)))
    seed_wallets = rng.sample(illicit_wallets, k=min(n_seed, len(illicit_wallets)))
    pd.DataFrame({"address": seed_wallets, "source": "external_intel_seed"}).to_csv(
        f"{args.out}/seed_illicit_wallets.csv", index=False)

    print("[6/6] Writing nested JSON sample (array-field format per PS spec) ...", file=sys.stderr)
    in_by_tx = in_df.groupby("txid").agg(list)
    out_by_tx = out_df.groupby("txid").agg(list)
    sample_txids = tx_df["txid"].head(args.nested_sample_size)
    nested = []
    tx_indexed = tx_df.set_index("txid")
    for txid in sample_txids:
        row = tx_indexed.loc[txid]
        rec = {
            "timestamp": int(row["timestamp"]),
            "txid": txid,
            "src_ip": row["src_ip"], "src_port": int(row["src_port"]),
            "dst_ip": row["dst_ip"], "dst_port": int(row["dst_port"]),
            "geo_country": row["geo_country"], "asn": int(row["asn"]), "asn_owner": row["asn_owner"],
            "input_addresses": in_by_tx.loc[txid, "address"] if txid in in_by_tx.index else [],
            "input_amounts": in_by_tx.loc[txid, "amount_btc"] if txid in in_by_tx.index else [],
            "output_addresses": out_by_tx.loc[txid, "address"] if txid in out_by_tx.index else [],
            "output_amounts": out_by_tx.loc[txid, "amount_btc"] if txid in out_by_tx.index else [],
            "fee_btc": float(row["fee_btc"]),
            "script_type": row["script_type"],
        }
        nested.append(rec)
    with open(f"{args.out}/sample_nested.json", "w") as f:
        json.dump(nested, f, indent=1)

    print("\nDone. Summary:", file=sys.stderr)
    print(f"  entities:     {len(entities_df):>8,}  (illicit: {entities_df.is_illicit.sum():,})", file=sys.stderr)
    print(f"  wallets:      {len(wallets_df):>8,}", file=sys.stderr)
    print(f"  transactions: {len(tx_df):>8,}", file=sys.stderr)
    print(f"  tx-tx edges:  {len(edge_df):>8,}", file=sys.stderr)
    print(f"  class counts: {dict(label_df['class'].value_counts())}", file=sys.stderr)
    print(f"  pattern counts: {dict(label_df['pattern_type'].value_counts())}", file=sys.stderr)
    print(f"  anomalies:    {label_df['is_anomaly'].sum():,}", file=sys.stderr)


if __name__ == "__main__":
    main()
