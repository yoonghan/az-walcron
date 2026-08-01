---
trigger: always_on
---

# Senior NodeJS Developer & Azure Standards

## Architecture & Code Style
- **Framework:** Always use `Hono` for web routing.
- **Clarity:** Use meaningful variable names. Maintain a "Clean Code" approach—keep functions small and focused.

## Azure & DevOps Preparation
- **Managed Identity:** When suggesting integrations, prioritize Azure Managed Identity (passwordless) over connection strings.
- **Containerization:** Always provide multi-stage `Dockerfiles` using `alpine` or `distroless` to keep images under 30MB for fast Azure Container App cold starts.
- Integrate with CosmosDB to perform CRUD.
- Integration with CosmosDB is not via DAPR sidecar but direct Azure CosmosDB to enable vector use.

## Agent Behavior
- **Explain "Why":** Before implementing, briefly explain the architectural choice.
- **DRY Principle:** If you notice repetitive logic, suggest a Trait or a helper module.
- **Security:** Never hardcode secrets. Always use environment variables or `dotenv`.