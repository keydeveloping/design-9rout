# KeyWorkflow

KeyWorkflow is a self-hosted, node-based AI workflow builder for composing image, video, audio, and text generation pipelines.

It provides a visual workflow editor, a FastAPI backend, and a 9router-compatible runtime integration for model execution.

## Features

- Node-based workflow editor powered by React Flow
- Image, video, audio, text, and utility workflow nodes
- Prompt concatenation, array separator, and list item selector utilities
- Self-hostable FastAPI backend
- 9router-compatible model runtime via `NINEROUTER_URL`
- Docker Compose support for local deployment

## Tech Stack

- Frontend: Next.js 16, React 19
- Workflow builder: React Flow shared package
- Backend: FastAPI, Uvicorn
- Runtime: 9router-compatible API
- Package manager: npm workspaces
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
- npm 7+
- Python 3.10+
- Running 9router endpoint

### Docker

- Docker
- Docker Compose v2
- Running 9router endpoint reachable from containers

## Environment Variables

### Root `.env`

Used by Docker Compose.

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

Used when running the backend directly.

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
| `NINEROUTER_URL` | Base URL for the 9router-compatible runtime |
| `NINEROUTER_KEY` | Optional auth key for runtime requests |
| `PUBLIC_BASE_URL` | Public/backend base URL used for generated files |
| `ALLOW_LOCAL_REFERENCE_IMAGES` | Allows local/private reference image URLs during local development |
| `DATA_DIR` | Backend data directory; set by Docker to `/home/appuser/data` |

## Install Dependencies

From repository root:

```bash
npm install
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
npm run dev:app
```

Frontend:
- `http://localhost:3000`

### 3. Rebuild Workflow Builder After UI Changes

If you change files under `packages/workflow-builder`, rebuild the shared package:

```bash
npm run build:lib
```

## Run With Docker

### 1. Configure Environment

```bash
cp .env.example .env
```

Update runtime values in `.env`:

```env
NINEROUTER_URL=http://host.docker.internal:20128
NINEROUTER_KEY=your_9router_key_here
```

### 2. Start Services

```bash
docker compose up --build
```

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

## npm Scripts

From repository root:

```bash
npm run dev:app       # Start Next.js frontend
npm run build:app     # Build Next.js frontend
npm run build:lib     # Build workflow-builder package
npm run install:all   # Install workspace dependencies
```

## Development Notes

- Workflow editor components live in `packages/workflow-builder/src/components`.
- Rebuild `workflow-builder` after editor changes with `npm run build:lib`.
- Runtime/generated backend data lives under `DATA_DIR`.
- Do not commit `server/data/` or local secrets.
- For local image-reference workflows, keep `ALLOW_LOCAL_REFERENCE_IMAGES=true`.
- For public/provider execution, set `PUBLIC_BASE_URL` to a reachable public URL.

## License

[MIT](LICENSE)
