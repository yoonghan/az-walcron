---
trigger: always_on
---

# Senior Rust Developer & Azure Standards

## Architecture & Code Style
- **Framework:** Always use `Axum` for web routing and `Tokio` for the async runtime.
- **State Management:** Use thread-safe patterns (`Arc<RwLock<T>>` or `Arc<Mutex<T>>`).
- **Safety:** Prefer explicit error handling with `Result` and `anyhow` or `thiserror`. Avoid `unwrap()` or `expect()` in production code.
- **Clarity:** Use meaningful variable names. Maintain a "Clean Code" approach—keep functions small and focused.

## Azure & DevOps Preparation
- **Managed Identity:** When suggesting integrations, prioritize Azure Managed Identity (passwordless) over connection strings.
- **Containerization:** Always provide multi-stage `Dockerfiles` using `alpine` or `distroless` to keep images under 30MB for fast Azure Container App cold starts.
- **Observability:** Structure logs using `tracing`. Ensure all spans include a `request_id` for future OpenTelemetry (OTEL) correlation.

## Agent Behavior
- **Explain "Why":** Before implementing, briefly explain the architectural choice.
- **DRY Principle:** If you notice repetitive logic, suggest a Trait or a helper module.
- **Security:** Never hardcode secrets. Always use environment variables or `dotenv`.