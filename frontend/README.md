# Local Forensics Dashboard

This React and TypeScript app is the primary dashboard for Bitcoin Transaction Forensics. It uses Chart.js for model charts and Cytoscape.js for transaction network analysis.

## Run the complete app

From the project root, run `run_local.ps1` or choose **Run dashboard locally** from VS Code's Run Task menu. The script builds `frontend/dist` from the installed packages when needed, then starts the FastAPI service on `http://127.0.0.1:8000`. The built interface and API are served from the same local origin.

The first dependency install needs Python packages and npm packages. Once those are installed and `artifacts/bundle.joblib` exists, build and run the app without internet access. Node.js is only needed to build the frontend, not to serve the built app.

## Frontend development

From this folder, run:

```sh
npm run dev
```

This starts the local API and dashboard together. The API loads the saved model bundle before Vite opens the development dashboard. Stop both services with Ctrl+C.

To start only the API separately from the project root, run:

```sh
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

Vite runs at `http://127.0.0.1:5173` and forwards API requests to the local service. Before running the production-style single-server app, create an updated frontend bundle with `npm run build`.
