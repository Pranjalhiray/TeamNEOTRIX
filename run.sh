#!/usr/bin/env bash
# Launches the dashboard. Fully offline - no internet needed (run setup.sh once first).
set -euo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate

if [ ! -f artifacts/bundle.joblib ]; then
    echo "artifacts/bundle.joblib not found — run ./setup.sh first."
    exit 1
fi

echo "Starting dashboard — open http://localhost:8501 in a browser."
streamlit run app.py --server.address 0.0.0.0 --server.port 8501
