# cyberpractice — builds the React UI with Node, then serves it + the FastAPI
# backend from Python. One persistent process (in-memory sessions need that).

# --- Stage 1: build the React/Vite UI -> platform/web-dist ---
FROM node:20-slim AS ui
WORKDIR /app
COPY package.json package-lock.json vite.config.js ./
COPY ui ./ui
RUN npm ci
RUN npm run build:ui

# --- Stage 2: Python runtime ---
FROM python:3.12-slim
WORKDIR /app
ENV HOST=0.0.0.0 PYTHONUNBUFFERED=1

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=ui /app/platform/web-dist ./platform/web-dist

# Defaults to the offline simulator (no key, safe to expose).
# For a real model set CYBERPRACTICE_PROVIDER=free + GROQ_API_KEY as env/secrets.
EXPOSE 8000
CMD ["sh", "-c", "PORT=${PORT:-8000} python -m backend.run --no-open"]
