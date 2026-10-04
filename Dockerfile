FROM node:22-bookworm-slim AS frontend-build

WORKDIR /workspace/frontend
ENV VITE_APP_DEPLOYMENT=hosted
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements-api.txt

COPY api/ ./api/
COPY src/ ./src/
COPY data/ ./data/
COPY --from=frontend-build /workspace/frontend/dist ./frontend/dist

# The generated model bundle stays out of Git and is reproducibly built into
# the deploy image from the versioned synthetic dataset.
RUN python src/build_artifacts.py

EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
