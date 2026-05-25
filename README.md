# Vibe Workflow

Open-source node-based AI workflow builder for image, video, audio, and text pipelines.

Project sekarang berjalan sebagai monorepo dengan:
- `client/` — Next.js app
- `packages/workflow-builder/` — shared workflow editor library
- `server/` — FastAPI backend

## Current Stack

- Frontend: Next.js 16 + React 19
- Workflow UI: React Flow
- Backend: FastAPI + Uvicorn
- AI runtime: 9router-compatible API via `NINEROUTER_URL`
- Packaging: npm workspaces
- Container runtime: Docker Compose

## Project Structure

```text
.
├── client/
├── packages/
│   └── workflow-builder/
├── server/
├── docker-compose.yml
├── .env.example
└── package.json
```

## Requirements

Local development:
- Node.js 20+
- npm 7+
- Python 3.10+
- Running 9router endpoint

Docker:
- Docker
- Docker Compose v2
- Running 9router endpoint reachable from container

## Environment Variables

### Root `.env` for Docker Compose

Copy:

```bash
cp .env.example .env
```

Current variables:

```env
NINEROUTER_URL=http://host.docker.internal:20128
NINEROUTER_KEY=your_9router_key_here
PUBLIC_BASE_URL=http://localhost:8000
ALLOW_LOCAL_REFERENCE_IMAGES=true
```

Meaning:
- `NINEROUTER_URL` — base URL for 9router runtime
- `NINEROUTER_KEY` — auth key for 9router if needed
- `PUBLIC_BASE_URL` — public/backend base URL used when generated files are returned
- `ALLOW_LOCAL_REFERENCE_IMAGES` — allow local/private image URLs for local dev

### Backend `server/.env`

Copy:

```bash
cd server
cp .env.example .env
```

Current variables:

```env
NINEROUTER_URL=http://localhost:20128
NINEROUTER_KEY=your_9router_key_here
PUBLIC_BASE_URL=http://127.0.0.1:8000
ALLOW_LOCAL_REFERENCE_IMAGES=true
```

## Install Dependencies

From repo root:

```bash
npm install
```

This installs workspace dependencies for:
- `client`
- `packages/workflow-builder`
- `server`-adjacent JS tooling if present

## Run Locally

### 1. Start backend

```bash
cd server
python -m venv venv
source venv/bin/activate
# Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend default URL:
- `http://localhost:8000`

Health endpoint:
- `http://localhost:8000/api/health`

### 2. Start frontend

From repo root:

```bash
npm run dev:app
```

Frontend default URL:
- `http://localhost:3000`

### 3. Rebuild workflow builder library after UI changes

If you edit files under `packages/workflow-builder`, rebuild the shared library:

```bash
npm run build:lib
```

## Run With Docker

### 1. Configure env

From repo root:

```bash
cp .env.example .env
```

Update at least:
- `NINEROUTER_URL`
- `NINEROUTER_KEY`

### 2. Start services

```bash
docker compose up --build
```

Available services:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

### 3. Stop services

```bash
docker compose down
```

## Current Docker Services

| Service | Port | Notes |
|---|---:|---|
| `client` | 3000 | Next.js production container |
| `server` | 8000 | FastAPI container |

Backend container uses:
- `DATA_DIR=/home/appuser/data`
- `PUBLIC_BASE_URL` from compose env
- `host.docker.internal` mapping for local 9router access

## Notes About 9router

This project no longer uses MuAPI env setup described in older docs. Current runtime depends on:
- `NINEROUTER_URL`
- `NINEROUTER_KEY`

If reference-image workflows fail with public-host errors:
- set correct `PUBLIC_BASE_URL`
- or keep `ALLOW_LOCAL_REFERENCE_IMAGES=true` for local-only development

## Useful Commands

From repo root:

```bash
npm run dev:app
npm run build:app
npm run build:lib
npm run install:all
```

## Development Notes

- Workflow editor code lives in `packages/workflow-builder/src/components`
- After workflow-builder edits, rebuild library with `npm run build:lib`
- Backend stores runtime/generated data under `DATA_DIR`
- Do not commit `server/data/`

## License

[MIT](LICENSE)
