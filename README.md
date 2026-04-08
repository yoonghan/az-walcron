# Walcron Azure Web Server

A high-performance Rust web server built with the Axum framework, optimized for Azure Container Apps.

## Features
- Fast routing and asynchronous execution via **Axum** & **Tokio**.
- In-memory data store with thread-safety (`Arc<RwLock<Vec<Todo>>>`) for high concurrency.
- Zero database layer for minimal footprint.
- Ready for OpenTelemetry (OTEL) distributed tracing via `tower-http` with injected request correlation IDs.
- Provides a minimal (~30MB) footprint production image via a multi-stage Docker build relying on `alpine`.

## Endpoints
- `GET /` - Returns "Hello to Walcron"
- `GET /todos` - Lists all todos
- `POST /todos` - Creates a new todo (requires `{"title": "..."}` JSON payload)

## Getting Started

Assuming you have Rust and Cargo installed, navigate to the directory and run:

```bash
cargo run
```

Then you can verify it locally:
```bash
curl http://localhost:3000/
curl http://localhost:3000/todos
curl -X POST -H "Content-Type: application/json" -d '{"title": "Buy milk"}' http://localhost:3000/todos
```

## Docker Build

To package this application for Azure:
```bash
docker build -t walcron-azure:latest .
```
