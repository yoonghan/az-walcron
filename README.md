# Walcron Azure Web Server

A high-performance Rust web server built with the Axum framework and a Deno frontend, optimized for Azure Container Apps multi-container pods.

## Features
- **Backend (Rust API):**
  - Fast routing and asynchronous execution via **Axum** & **Tokio**.
  - In-memory data store with thread-safety (`Arc<RwLock<Vec<Todo>>>`) for high concurrency.
  - Ready for OpenTelemetry (OTEL) distributed tracing via `tower-http` with injected request correlation IDs.
  - Minimal (~30MB) footprint production image via a multi-stage Docker build relying on `alpine`.
- **Frontend (Deno):**
  - Lightweight SSR (Server-Side Rendering) HTML integration using **Deno**.
  - Deploys as a sidecar/second container in the same Azure Container App pod.
  - Fetches from the backend Rust API locally via `http://localhost:3000`.

## Endpoints (Backend - Port 3000)
- `GET /` - Returns "Hello to Walcron"
- `GET /todos` - Lists all todos
- `POST /todos` - Creates a new todo (requires `{"title": "..."}` JSON payload)

## Frontend UI (Port 8080)
- `GET /` - Serves an HTML page rendering the todo list from the Rust backend. 

## Getting Started

Assuming you have Rust and Cargo installed, navigate to the backend directory and run the API:

```bash
cd backend
cargo run
```

Then you can verify the API locally:
```bash
curl http://localhost:3000/
curl http://localhost:3000/todos
curl -X POST -H "Content-Type: application/json" -d '{"title": "Buy milk"}' http://localhost:3000/todos
```

## Running the Deno Frontend
If you have Deno installed, you can start the frontend server in a separate terminal:
```bash
cd frontend
deno run --allow-net server.ts
```

### Running Frontend Tests
```bash
cd frontend
deno test --allow-net server_test.ts
```

## Docker Build & Deployment

To package this application for Azure, the CI pipeline automatically builds two container images via `./.github/workflows/docker-build-push.yml`:
1. `walcron-azure:latest` (Backend)
2. `walcron-azure-frontend:latest` (Frontend)

**Azure Container Apps Deployment:**
The application sets up a multi-container pod using `scripts/containerapp.yaml`. Traffic ingress is routed to the Deno frontend on `port 8080`.

Update standard deployments using:
```bash
./scripts/az-update-container.sh
```
