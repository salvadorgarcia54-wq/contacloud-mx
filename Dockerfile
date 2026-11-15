# Etapa 1: Compilar el Frontend (React + Vite)
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

# Etapa 2: Servidor Backend (FastAPI + Uvicorn) sirviendo el Frontend compilado
FROM python:3.11-slim
WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libxml2-dev \
    libxslt-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
COPY frontend/src/assets /app/frontend/src/assets
COPY frontend/public /app/frontend/public

ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
