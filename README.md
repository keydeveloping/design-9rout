# KeyWorkflow

KeyWorkflow is a self-hosted, node-based AI workflow builder for composing image, video, audio, and text generation pipelines.

It provides a visual workflow editor, a FastAPI backend, private MinIO object storage support, and a 9router-compatible runtime integration.

## Features

- Node-based workflow editor powered by React Flow
- Image, video, audio, text, and utility workflow nodes
- Prompt concatenation, array separator, and list item selector utilities
- Browser-local 9router Base URL/API key settings
- FastAPI backend with workflow/run persistence
- Private MinIO storage with backend stable object URLs
- Docker Compose setup for local/dev and VPS/Caddy production

## Tech Stack

- Frontend: Next.js 16, React 19
- Workflow builder: React Flow shared package
- Backend: FastAPI, Uvicorn
- Runtime: 9router-compatible API
- Package manager: pnpm workspaces
- Containers: Docker Compose
- Reverse proxy: Caddy
- Object storage: MinIO / S3-compatible storage

## Project Structure

```text
.
├── client/                         # Next.js frontend app
├── packages/
│   └── workflow-builder/            # Shared node editor package
├── server/                          # FastAPI backend
├── Caddyfile                        # Production reverse proxy config
├── docker-compose.yml               # Local/dev stack
├── docker-compose.prod.yml          # VPS/Caddy production stack
├── .env.example                     # Local env template
├── .env.production.example          # VPS production env template
├── pnpm-workspace.yaml
└── package.json
```

## Requirements

### Local Development

- Node.js 20+
- pnpm 9+
- Python 3.10+
- Running 9router-compatible endpoint

### Docker / VPS

- Docker
- Docker Compose v2
- DNS records pointing to VPS
- Ports `80` and `443` open for Caddy

## Browser-Local 9router Settings

KeyWorkflow does not persist user 9router credentials on the backend. Each browser/user sets runtime settings in the UI.

Settings are stored in browser localStorage key:

```text
9router.runtimeSettings
```

Requests include runtime headers:

```text
X-KeyWorkflow-Router-URL
X-KeyWorkflow-Router-Key
```

If settings are missing, runtime-sensitive endpoints return `runtime_settings_required` and UI asks user to open 9router settings.

Backend `.env` values for `NINEROUTER_URL` / `NINEROUTER_KEY` are optional only for backend-only flows. Browser workflow/node runs should use UI settings.

## Environment Variables

### Local `.env`

Copy local template:

```bash
cp .env.example .env
```

Common local values:

```env
PUBLIC_BASE_URL=http://127.0.0.1:8000
ALLOW_LOCAL_REFERENCE_IMAGES=true
STORAGE_BACKEND=minio
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=keyworkflow
```

### VPS production `.env`

Copy production template:

```bash
cp .env.production.example .env
```

Example production values:

```env
APP_DOMAIN=workflow.keywdev.cloud
PUBLIC_BASE_URL=https://workflow.keywdev.cloud

MINIO_API_DOMAIN=minio-api.keywdev.cloud
MINIO_CONSOLE_DOMAIN=minio-console.keywdev.cloud

STORAGE_BACKEND=minio
S3_ENDPOINT_URL=https://minio-api.keywdev.cloud
S3_ACCESS_KEY_ID=your_existing_minio_user
S3_SECRET_ACCESS_KEY=your_existing_minio_password
S3_BUCKET=keyworkflow
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_CREATE_BUCKET=false
S3_PRESIGNED_EXPIRES_SECONDS=604800
ALLOW_LOCAL_REFERENCE_IMAGES=false
```

Do not commit `.env` or real secrets.

### Variable Reference

| Variable | Description |
|---|---|
| `APP_DOMAIN` | Public app domain served by Caddy |
| `PUBLIC_BASE_URL` | Public app/backend base URL used for stable object URLs |
| `MINIO_API_DOMAIN` | Public MinIO S3 API domain |
| `MINIO_CONSOLE_DOMAIN` | Public MinIO Console domain |
| `NINEROUTER_URL` | Optional backend-only 9router base URL |
| `NINEROUTER_KEY` | Optional backend-only 9router key |
| `ALLOW_LOCAL_REFERENCE_IMAGES` | Allows local/private reference image URLs during local development |
| `DATA_DIR` | Backend data directory in container |
| `STORAGE_BACKEND` | `local`, `minio`, or `s3` |
| `S3_ENDPOINT_URL` | MinIO/S3 endpoint used by backend and presigned URLs |
| `S3_ACCESS_KEY_ID` | MinIO/S3 access key |
| `S3_SECRET_ACCESS_KEY` | MinIO/S3 secret key |
| `S3_BUCKET` | Bucket for generated/uploaded files |
| `S3_REGION` | S3 region |
| `S3_FORCE_PATH_STYLE` | Use path-style S3 URLs for MinIO |
| `S3_CREATE_BUCKET` | Create bucket if missing |
| `S3_PRESIGNED_EXPIRES_SECONDS` | Signed download URL lifetime |

## Install Dependencies

From repository root:

```bash
pnpm install
```

## Run Locally Without Docker

### Backend

```bash
cd server
python -m venv venv
source venv/bin/activate
# Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend URLs:

```text
http://localhost:8000
http://localhost:8000/api/health
http://localhost:8000/docs
```

### Frontend

From repository root:

```bash
pnpm dev:app
```

Frontend URL:

```text
http://localhost:3000
```

### Rebuild Workflow Builder

If you change files under `packages/workflow-builder`, rebuild shared package:

```bash
pnpm build:lib
```

## Docker Compose Workflows

This repo has two compose entry points:

- `docker-compose.yml` → local/dev
- `docker-compose.prod.yml` → VPS production with Caddy + MinIO

## Local / Dev Docker

Start local stack:

```bash
docker compose up -d --build
```

Services:

| Service | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:8000` |
| API docs | `http://localhost:8000/docs` |
| MinIO API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` |

Local stack uses:

- direct ports for frontend/backend/MinIO
- bind mount `./data:/data` for MinIO object persistence
- bind mount `./server/data:/home/appuser/data` for backend persistence

Stop local stack:

```bash
docker compose down
```

## VPS / Production With Caddy

Production stack runs frontend, backend, MinIO, and Caddy in one Docker Compose file.

Frontend and backend do not need separate domains. Use one app domain for UI + API, and keep separate domains only for MinIO API and MinIO Console.

Recommended domains:

```text
workflow.keywdev.cloud        # app + /api/*
minio-api.keywdev.cloud       # MinIO API
minio-console.keywdev.cloud   # MinIO Console
```

### 1. Prepare env

```bash
cp .env.production.example .env
```

Edit `.env`. Keep your previous MinIO credentials and bucket name if you want existing objects to stay accessible.

### 2. Preserve old MinIO data

Old MinIO compose used:

```yaml
volumes:
  - ./data:/data
```

Keep the old `data` folder beside `docker-compose.prod.yml` before starting new stack:

```text
./data
```

This preserves existing buckets and image files.

If you also want backend workflow/run JSON data, keep:

```text
./server/data
```

### 3. Point DNS to VPS

Create A records:

```text
workflow.keywdev.cloud -> YOUR_VPS_IP
minio-api.keywdev.cloud -> YOUR_VPS_IP
minio-console.keywdev.cloud -> YOUR_VPS_IP
```

Open ports:

```text
80
443
```

### 4. Validate config

```bash
docker compose -f docker-compose.prod.yml config
```

### 5. Start production stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy automatically issues TLS certificates for:

- app domain
- MinIO API domain
- MinIO Console domain

### 6. Configure 9router in browser

Open app domain, then click `9router` settings in workflow builder and enter:

- 9router Base URL
- 9router API Key

These values stay in browser storage and are sent per request. Backend does not store them.

### 7. Verify upload storage

When MinIO is active, uploaded/generated files should return stable backend URLs like:

```text
https://workflow.keywdev.cloud/api/app/object/images/<file>
```

They should not return local fallback URLs like:

```text
/generated/uploads/<file>
```

Open MinIO Console:

```text
https://minio-console.keywdev.cloud
```

Confirm old bucket/files still appear.

### 8. Stop production stack

```bash
docker compose -f docker-compose.prod.yml down
```

Avoid `-v` if you want to keep:

- MinIO objects in `./data`
- backend JSON data in `./server/data`
- Caddy certificate storage

`docker compose down -v` is destructive for persisted storage.

## Caddy Routing

`Caddyfile` serves three hosts.

App domain:

```caddy
workflow.keywdev.cloud {
    # /api/* -> server:8000
    # /generated/* -> server:8000
    # everything else -> client:3000
}
```

MinIO domains:

```caddy
minio-api.keywdev.cloud {
    reverse_proxy minio:9000
}

minio-console.keywdev.cloud {
    reverse_proxy minio:9001
}
```

## Storage Notes

Backend public object links are built from `PUBLIC_BASE_URL`, not MinIO Console URL.

Use:

```env
PUBLIC_BASE_URL=https://workflow.keywdev.cloud
```

Current backend presigned URLs are generated from `S3_ENDPOINT_URL`. In production, use a browser-reachable MinIO API URL:

```env
S3_ENDPOINT_URL=https://minio-api.keywdev.cloud
```

This avoids redirects to internal-only Docker hostnames like:

```text
http://minio:9000
```

If you later want backend-to-MinIO traffic to stay internal while keeping public presigned URLs, add separate internal/public endpoint support in backend config.

## Migration Checklist

Before first VPS boot:

1. Copy repo to VPS.
2. Copy old MinIO `./data` folder into repo/deploy directory.
3. Copy old `./server/data` if needed.
4. Create `.env` from `.env.production.example`.
5. Point three DNS records to VPS.
6. Open `80` and `443`.
7. Run production compose.
8. Verify old bucket/files in MinIO Console.
9. Verify app upload URL uses `/api/app/object/...`.
10. Set 9router settings in browser UI.

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
- For public/provider execution, set `PUBLIC_BASE_URL` to a reachable public URL.
- To store generated/uploaded files in MinIO, set `STORAGE_BACKEND=minio` and configure the `S3_*` variables.
- With private MinIO buckets, KeyWorkflow returns stable backend URLs under `/api/app/object/{key}` and redirects downloads to short-lived signed URLs.
- If using remote providers, `PUBLIC_BASE_URL` must be reachable from the provider because provider requests will follow the backend object URL redirect.

## License

[MIT](LICENSE)
