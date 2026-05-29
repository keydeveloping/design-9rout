# KeyWorkflow

KeyWorkflow is a self-hosted, node-based AI workflow builder for composing image, video, audio, and text generation pipelines.

It provides a visual workflow editor, a FastAPI backend, and a 9router-compatible runtime integration for model execution.

## Features

- Node-based workflow editor powered by React Flow
- Image, video, audio, text, and utility workflow nodes
- Prompt concatenation, array separator, and list item selector utilities
- Self-hostable FastAPI backend
- 9router-compatible model runtime with browser-local URL/key overrides
- Docker Compose support for local deployment

## Tech Stack

- Frontend: Next.js 16, React 19
- Workflow builder: React Flow shared package
- Backend: FastAPI, Uvicorn
- Runtime: 9router-compatible API
- Package manager: pnpm workspaces
- Containers: Docker Compose

## Project Structure

```text
.
├── client/                       # Next.js frontend app
├── packages/
│   └── workflow-builder/          # Shared node editor package
├── server/                        # FastAPI backend
├── docker-compose.yml
├── .env.example
└── package.json
```

## Requirements

### Local Development

- Node.js 20+
- pnpm 9+
- Python 3.10+
- Running 9router endpoint

### Docker

- Docker
- Docker Compose v2
- Running 9router endpoint reachable from containers

## Environment Variables

### Root `.env`

Used by Docker Compose and backend-side runtime calls. Browser single-node runs do not read 9router URL/key from this file.

```bash
cp .env.example .env
```

```env
NINEROUTER_URL=http://host.docker.internal:20128
NINEROUTER_KEY=your_9router_key_here
PUBLIC_BASE_URL=http://localhost:8000
ALLOW_LOCAL_REFERENCE_IMAGES=true
```

### Backend `server/.env`

Used when running the backend directly. Browser single-node runs do not fall back to these 9router values.

```bash
cd server
cp .env.example .env
```

```env
NINEROUTER_URL=http://localhost:20128
NINEROUTER_KEY=your_9router_key_here
PUBLIC_BASE_URL=http://127.0.0.1:8000
ALLOW_LOCAL_REFERENCE_IMAGES=true
```

### Variable Reference

| Variable | Description |
|---|---|
| `NINEROUTER_URL` | Base URL for backend-initiated 9router requests |
| `NINEROUTER_KEY` | Auth key for backend-initiated 9router requests |
| `PUBLIC_BASE_URL` | Public/backend base URL used for local generated files |
| `ALLOW_LOCAL_REFERENCE_IMAGES` | Allows local/private reference image URLs during local development |
| `DATA_DIR` | Backend data directory; set by Docker to `/home/appuser/data` |
| `STORAGE_BACKEND` | `local` or `minio`/`s3` |
| `S3_ENDPOINT_URL` | MinIO/S3 endpoint URL |
| `S3_ACCESS_KEY_ID` | MinIO/S3 access key |
| `S3_SECRET_ACCESS_KEY` | MinIO/S3 secret key |
| `S3_BUCKET` | Bucket for generated/uploaded files |
| `S3_PUBLIC_BASE_URL` | Optional public base URL if you intentionally use public objects |
| `S3_PRESIGNED_EXPIRES_SECONDS` | Expiry for signed download URLs when bucket stays private |

## Install Dependencies

From repository root:

```bash
pnpm install
```

## Run Locally

### 1. Start Backend

```bash
cd server
python -m venv venv
source venv/bin/activate
# Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend:
- `http://localhost:8000`

Health endpoint:
- `http://localhost:8000/api/health`

API docs:
- `http://localhost:8000/docs`

### 2. Start Frontend

From repository root:

```bash
pnpm dev:app
```

### 3. Configure Browser-Local 9router Settings

Single-node Run actions in browser send runtime overrides from localStorage key `9router.runtimeSettings`.
Set it in DevTools console before using Run on individual nodes:

```js
localStorage.setItem("9router.runtimeSettings", JSON.stringify({
  baseUrl: "http://localhost:20128",
  apiKey: "your_9router_key_here"
}));
```

Requests include:
- `X-KeyWorkflow-Router-URL`
- `X-KeyWorkflow-Router-Key`

If browser-local settings are missing, single-node Run no longer falls back to `NINEROUTER_URL` or `NINEROUTER_KEY` env vars.

Frontend:
- `http://localhost:3000`

### 4. Rebuild Workflow Builder After UI Changes

If you change files under `packages/workflow-builder`, rebuild the shared package:

```bash
npm run build:lib
```

## Run With Docker

### 1. Configure Environment

```bash
cp .env.example .env
```

Update backend runtime values in `.env` if Docker services themselves must call 9router:

```env
NINEROUTER_URL=http://host.docker.internal:20128
NINEROUTER_KEY=your_9router_key_here
```

### 2. Start Services

```bash
docker compose up --build
```

This also starts MinIO:
- S3 API: `http://localhost:9000`
- Console: `http://localhost:9001`

Services:

| Service | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:8000` |
| API docs | `http://localhost:8000/docs` |

### 3. Stop Services

```bash
docker compose down
```

## pnpm Scripts

From repository root:

```bash
pnpm dev:app          # Start Next.js frontend
pnpm build:app        # Build Next.js frontend
pnpm build:lib        # Build workflow-builder package
pnpm install:all      # Install workspace dependencies
```

## Development Notes

- Workflow editor components live in `packages/workflow-builder/src/components`.
- Rebuild `workflow-builder` after editor changes with `pnpm build:lib`.
- Runtime/generated backend data lives under `DATA_DIR`.
- Do not commit `server/data/` or local secrets.
- For local image-reference workflows, keep `ALLOW_LOCAL_REFERENCE_IMAGES=true`.
- For public/provider execution, set `PUBLIC_BASE_URL` or `S3_PUBLIC_BASE_URL` to a reachable public URL.
- To store generated/uploaded files in MinIO, set `STORAGE_BACKEND=minio` and configure the `S3_*` variables.
- With private MinIO buckets, KeyWorkflow returns stable backend URLs under `/api/app/object/{key}` and redirects downloads to short-lived signed URLs.
- If using remote providers, `PUBLIC_BASE_URL` must be reachable from the provider because provider requests will follow the backend object URL redirect.

## License

[MIT](LICENSE)
