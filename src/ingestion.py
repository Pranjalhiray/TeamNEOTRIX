"""Local, schema-tolerant ingestion for CSV, JSON and XML transaction traffic."""
from __future__ import annotations

import ast
import csv
import io
import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import Any

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_RECORDS = 100_000

ALIASES = {
    "txid": {"txid", "tx_id", "transaction_id", "transaction_hash", "hash"},
    "timestamp": {"timestamp", "time", "seen_at", "first_seen", "block_time", "datetime", "date"},
    "src_ip": {"src_ip", "srcip", "source_ip", "sourceip", "sender_ip", "peer_ip", "broadcast_ip"},
    "dst_ip": {"dst_ip", "dstip", "destination_ip", "destinationip", "dest_ip", "receiver_ip"},
    "src_port": {"src_port", "srcport", "source_port", "sourceport", "sender_port"},
    "dst_port": {"dst_port", "dstport", "destination_port", "destinationport", "dest_port"},
    "input_addresses": {"input_addresses", "input_address", "input_wallets", "inputs", "vin", "input_wallet"},
    "output_addresses": {"output_addresses", "output_address", "output_wallets", "outputs", "vout", "output_wallet"},
    "input_amounts": {"input_amounts", "input_amount", "input_values", "input_value", "vin_amounts"},
    "output_amounts": {"output_amounts", "output_amount", "output_values", "output_value", "vout_amounts"},
    "total_input_btc": {"total_input_btc", "input_total_btc", "total_input", "total_input_amount", "input_sum"},
    "total_output_btc": {"total_output_btc", "output_total_btc", "total_output", "total_output_amount", "output_sum"},
    "fee_btc": {"fee_btc", "fee", "tx_fee", "transaction_fee"},
    "script_type": {"script_type", "script", "output_type"},
    "geo_country": {"geo_country", "country", "country_code", "geo_country_code"},
    "asn": {"asn", "asn_number", "autonomous_system_number"},
    "asn_owner": {"asn_owner", "asn_name", "asn_org", "organization", "isp"},
    "num_inputs": {"num_inputs", "input_count"},
    "num_outputs": {"num_outputs", "output_count"},
    "time_step": {"time_step", "step"},
    "class": {"class", "class_label", "elliptic_class"},
    "is_illicit": {"is_illicit", "illicit", "illicit_label", "ground_truth_illicit"},
}

ALIAS_TO_FIELD = {
    re.sub(r"[^a-z0-9]+", "_", alias.lower()).strip("_"): field
    for field, aliases in ALIASES.items()
    for alias in aliases | {field}
}
REQUIRED_FIELDS = ("timestamp", "src_ip", "dst_ip", "src_port", "dst_port", "txid",
                   "input_addresses", "output_addresses", "input_amounts", "output_amounts",
                   "fee_btc", "script_type", "geo_country", "asn")


def _key(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\[\]$", "", text)
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def _element_object(element: ET.Element) -> dict[str, Any]:
    """Read an XML transaction while preserving repeated and nested fields."""
    result: dict[str, Any] = {}
    for child in element:
        tag = child.tag.rsplit("}", 1)[-1]
        if list(child):
            values = []
            for item in child:
                if list(item):
                    values.append({sub.tag.rsplit("}", 1)[-1]: (sub.text or "").strip() for sub in item})
                else:
                    values.append((item.text or "").strip())
            value: Any = values
        else:
            value = (child.text or "").strip()
        if tag in result:
            existing = result[tag] if isinstance(result[tag], list) else [result[tag]]
            result[tag] = existing + (value if isinstance(value, list) else [value])
        else:
            result[tag] = value
    return result


def _parse_xml(text: str) -> list[dict[str, Any]]:
    root = ET.fromstring(text)
    candidates = [node for node in root.iter()
                  if node.tag.rsplit("}", 1)[-1].lower() in {"transaction", "tx", "record"}]
    if not candidates:
        candidates = [node for node in list(root) if list(node)] or [root]
    return [_element_object(node) for node in candidates]


def _parse_json(text: str) -> list[dict[str, Any]]:
    payload = json.loads(text)
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = None
        for key in ("transactions", "records", "data", "items", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                rows = value
                break
        if rows is None:
            rows = [payload]
    else:
        raise ValueError("JSON must contain an object or an array of transaction objects.")
    return [row for row in rows if isinstance(row, dict)]


def _parse_csv(text: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("The CSV file has no header row.")
    return [row for row in reader]


def parse_source(filename: str, content: bytes) -> list[dict[str, Any]]:
    """Parse one uploaded file without network access, based on its extension."""
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Files must be smaller than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {"csv", "json", "xml"}:
        raise ValueError("Choose a CSV, JSON or XML file.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("utf-8", errors="replace")
    rows = {"csv": _parse_csv, "json": _parse_json, "xml": _parse_xml}[suffix](text)
    if len(rows) > MAX_RECORDS:
        raise ValueError(f"Files may contain at most {MAX_RECORDS:,} transaction rows per import.")
    if not rows:
        raise ValueError("No transaction records were found in this file.")
    return rows


def _lookup(raw: dict[str, Any], field: str) -> Any:
    for name, value in raw.items():
        normalized = _key(name)
        if ALIAS_TO_FIELD.get(normalized) == field and value not in (None, ""):
            return value
    return None


def _sequence(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, dict):
        return [value]
    if not isinstance(value, str):
        return [value]
    text = value.strip()
    if not text:
        return []
    if text[:1] in "[{(\"'":
        for parser in (json.loads, ast.literal_eval):
            try:
                parsed = parser(text)
                return list(parsed) if isinstance(parsed, (list, tuple)) else [parsed]
            except (ValueError, SyntaxError, json.JSONDecodeError):
                pass
    separator = "|" if "|" in text else ";" if ";" in text else "," if "," in text else None
    if separator:
        return [part.strip() for part in text.split(separator) if part.strip()]
    return [text]


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _port(value: Any) -> int | None:
    number = _number(value)
    if number is None or not number.is_integer() or not 0 <= number <= 65535:
        return None
    return int(number)


def _nested_parts(values: list[Any]) -> tuple[list[Any], list[Any]]:
    addresses, amounts = [], []
    for value in values:
        if isinstance(value, dict):
            fields = {_key(key): item for key, item in value.items()}
            address = next((fields[key] for key in ("address", "wallet", "wallet_address", "script_address") if fields.get(key)), None)
            amount = next((fields[key] for key in ("amount", "amount_btc", "value", "btc") if fields.get(key) is not None), None)
            if address is not None:
                addresses.append(address)
                amounts.append(amount)
        elif value not in (None, ""):
            addresses.append(value)
            amounts.append(None)
    return addresses, amounts


def _value_key(value: Any) -> str:
    return str(value).strip()


def normalize_records(raw_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Map common field spellings and wide/long rows to a consistent schema."""
    grouped: dict[str, dict[str, Any]] = {}
    input_seen: dict[str, set[tuple[str, float | None]]] = defaultdict(set)
    output_seen: dict[str, set[tuple[str, float | None]]] = defaultdict(set)
    skipped = 0

    for raw in raw_rows:
        txid_value = _lookup(raw, "txid")
        txid = str(txid_value).strip() if txid_value is not None else ""
        if not txid:
            skipped += 1
            continue

        item = grouped.setdefault(txid, {
            "txid": txid,
            "input_addresses": [], "input_amounts": [],
            "output_addresses": [], "output_amounts": [],
        })

        raw_inputs = _lookup(raw, "input_addresses")
        raw_outputs = _lookup(raw, "output_addresses")
        input_addresses, nested_input_amounts = _nested_parts(_sequence(raw_inputs))
        output_addresses, nested_output_amounts = _nested_parts(_sequence(raw_outputs))
        raw_input_amounts = _lookup(raw, "input_amounts")
        raw_output_amounts = _lookup(raw, "output_amounts")
        input_amounts = _sequence(raw_input_amounts) if raw_input_amounts is not None else nested_input_amounts
        output_amounts = _sequence(raw_output_amounts) if raw_output_amounts is not None else nested_output_amounts

        for field, addresses, amounts, seen in (
            ("input", input_addresses, input_amounts, input_seen[txid]),
            ("output", output_addresses, output_amounts, output_seen[txid]),
        ):
            address_field = f"{field}_addresses"
            amount_field = f"{field}_amounts"
            for index, address in enumerate(addresses):
                address_text = _value_key(address)
                amount = _number(amounts[index]) if index < len(amounts) else None
                marker = (address_text, amount)
                if address_text and marker not in seen:
                    item[address_field].append(address_text)
                    item[amount_field].append(amount)
                    seen.add(marker)

        for field in ALIASES:
            if field in {"txid", "input_addresses", "output_addresses", "input_amounts", "output_amounts"}:
                continue
            value = _lookup(raw, field)
            if value is None:
                continue
            if field == "is_illicit":
                normalized = str(value).strip().lower()
                if isinstance(value, bool):
                    parsed = value
                elif normalized in {"1", "true", "yes", "illicit", "high", "positive"}:
                    parsed = True
                elif normalized in {"0", "false", "no", "licit", "low", "negative"}:
                    parsed = False
                else:
                    parsed = None
            elif field in {"src_port", "dst_port"}:
                parsed = _port(value)
            elif field in {"fee_btc", "total_input_btc", "total_output_btc", "num_inputs", "num_outputs", "time_step", "class", "asn"}:
                parsed = _number(value)
                if parsed is not None and field in {"num_inputs", "num_outputs", "time_step", "class", "asn"} and parsed.is_integer():
                    parsed = int(parsed)
            else:
                parsed = str(value).strip() if value is not None else None
            if parsed is not None:
                item[field] = parsed

    records = list(grouped.values())
    for row in records:
        row["num_inputs"] = int(row.get("num_inputs") or len(row["input_addresses"]))
        row["num_outputs"] = int(row.get("num_outputs") or len(row["output_addresses"]))
        if row.get("total_input_btc") is None:
            row["total_input_btc"] = round(sum(amount for amount in row["input_amounts"] if amount is not None), 8)
        if row.get("total_output_btc") is None:
            row["total_output_btc"] = round(sum(amount for amount in row["output_amounts"] if amount is not None), 8)
        if row.get("fee_btc") is None:
            row["fee_btc"] = max(0.0, round(row["total_input_btc"] - row["total_output_btc"], 8))
        row.setdefault("src_ip", None)
        row.setdefault("dst_ip", None)
        row.setdefault("src_port", None)
        row.setdefault("dst_port", None)
        row.setdefault("timestamp", None)
        row.setdefault("script_type", "unknown")
        row.setdefault("geo_country", None)
        row.setdefault("asn", None)
        row.setdefault("asn_owner", None)
        row.setdefault("time_step", None)
        row.setdefault("class", 3)

    if not records:
        raise ValueError("No rows with a transaction ID were found.")
    present = {field for row in records for field, value in row.items() if value not in (None, [], "")}
    missing = [field for field in REQUIRED_FIELDS if field not in present]
    warnings = []
    if skipped:
        warnings.append(f"Skipped {skipped} row(s) without a transaction ID.")
    if missing:
        warnings.append("Some standard fields are missing; unavailable values will be shown as unknown or zero: " + ", ".join(missing))
    return {
        "records": records,
        "source_rows": len(raw_rows),
        "transaction_count": len(records),
        "skipped_rows": skipped,
        "missing_fields": missing,
        "warnings": warnings,
    }


def parse_and_normalize(filename: str, content: bytes) -> dict[str, Any]:
    """Public API used by preview and analysis endpoints."""
    raw_rows = parse_source(filename, content)
    return normalize_records(raw_rows)
