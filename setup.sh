#!/usr/bin/env bash
# One-time setup — needs internet ONCE (to install pip packages + the
# geoip2fast offline database that ships inside the package itself).
# After this finishes, run.sh needs no internet ever again.
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/4] Creating virtual environment (.venv) ..."
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate

echo "[2/4] Installing Python dependencies (internet needed once) ..."
pip install --upgrade pip
pip install -r requirements.txt

echo "[3/4] Installing and building the frontend (internet needed once for npm ci) ..."
if [ ! -d frontend/node_modules ]; then (cd frontend && npm ci); fi
(cd frontend && npm run build)

if [ ! -f artifacts/bundle.joblib ]; then
    echo "[4/4] Training models and creating artifacts/bundle.joblib ..."
    python src/build_artifacts.py
else
    echo "[4/4] Reusing the existing local model bundle."
fi

echo
echo "Setup complete. From now on this runs with ZERO internet access:"
echo "    ./run.sh"
