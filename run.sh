#!/usr/bin/env bash
# Launches the local React dashboard and API. Dependencies and model artifacts
# must be prepared once before running without internet access.
set -euo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate

if [ ! -f artifacts/bundle.joblib ]; then
    echo "artifacts/bundle.joblib not found — run setup.sh once first."
    exit 1
fi

if [ ! -f frontend/dist/index.html ]; then
    if [ ! -d frontend/node_modules ]; then
        echo "Frontend dependencies are missing. Run setup.sh once before going offline."
        exit 1
    fi
    (cd frontend && npm run build)
fi

echo "Starting local dashboard at http://127.0.0.1:8000"
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000
