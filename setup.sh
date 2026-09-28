#!/usr/bin/env bash
# One-time setup — needs internet ONCE (to install pip packages + the
# geoip2fast offline database that ships inside the package itself).
# After this finishes, run.sh needs no internet ever again.
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/3] Creating virtual environment (.venv) ..."
python3 -m venv .venv
source .venv/bin/activate

echo "[2/3] Installing dependencies (needs internet) ..."
pip install --upgrade pip
pip install -r requirements.txt

echo "[3/3] Training all models & caching artifacts/bundle.joblib (offline from here) ..."
python src/build_artifacts.py

echo
echo "Setup complete. From now on this runs with ZERO internet access:"
echo "    ./run.sh"
