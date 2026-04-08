use anyhow::Result;
use axum::{
    extract::{State, Request},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use tower_http::trace::TraceLayer;
use tracing::info_span;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Todo {
    id: Uuid,
    title: String,
    completed: bool,
}

#[derive(Deserialize, Debug)]
struct CreateTodo {
    title: String,
}

// Thread-safe state using RwLock since there will be many readers for GET and few writers for POST.
type AppState = Arc<RwLock<Vec<Todo>>>;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();

    tracing::info!("Starting todo-server...");

    let state: AppState = Arc::new(RwLock::new(Vec::new()));

    // Define the router with TraceLayer to support OTEL correlation (request_id)
    let app = Router::new()
        .route("/", get(root))
        .route("/todos", get(list_todos))
        .route("/todos", post(create_todo))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request<_>| {
                    // Extract existing request_id or generate a new one
                    let request_id = request
                        .headers()
                        .get("x-request-id")
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_owned())
                        .unwrap_or_else(|| Uuid::new_v4().to_string());
                    
                    info_span!(
                        "request",
                        method = %request.method(),
                        uri = %request.uri(),
                        request_id = %request_id,
                    )
                })
        )
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("Server listening on {}", listener.local_addr()?);
    
    axum::serve(listener, app).await?;

    Ok(())
}

async fn list_todos(State(state): State<AppState>) -> Result<Json<Vec<Todo>>, StatusCode> {
    let todos = state
        .read()
        .map_err(|_| {
            tracing::error!("Failed to acquire read lock on the application state.");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!(count = todos.len(), "Listing todos");
    
    Ok(Json(todos.clone()))
}

async fn create_todo(
    State(state): State<AppState>,
    Json(payload): Json<CreateTodo>,
) -> Result<impl IntoResponse, StatusCode> {
    let mut todos = state
        .write()
        .map_err(|_| {
            tracing::error!("Failed to acquire write lock on the application state.");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let new_todo = Todo {
        id: Uuid::new_v4(),
        title: payload.title,
        completed: false,
    };

    todos.push(new_todo.clone());
    tracing::info!(todo_id = %new_todo.id, "Created new todo");

    Ok((StatusCode::CREATED, Json(new_todo)))
}

async fn root() -> &'static str {
    "Hello to Walcron"
}
