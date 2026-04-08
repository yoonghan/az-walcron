use anyhow::Result;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
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

#[derive(Deserialize, Debug)]
struct UpdateTodo {
    title: String,
    completed: bool,
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
    let app = app(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("Server listening on {}", listener.local_addr()?);
    
    axum::serve(listener, app).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    // Define the router with TraceLayer to support OTEL correlation (request_id)
    Router::new()
        .route("/", get(root))
        .route("/todos", get(list_todos))
        .route("/todos", post(create_todo))
        .route("/todos/:id", put(update_todo))
        .route("/todos/:id", delete(delete_todo))
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
        .with_state(state)
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

async fn update_todo(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateTodo>,
) -> Result<impl IntoResponse, StatusCode> {
    let mut todos = state
        .write()
        .map_err(|_| {
            tracing::error!("Failed to acquire write lock on the application state.");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if let Some(todo) = todos.iter_mut().find(|t| t.id == id) {
        todo.title = payload.title;
        todo.completed = payload.completed;
        tracing::info!(todo_id = %id, "Updated todo");
        Ok((StatusCode::OK, Json(todo.clone())).into_response())
    } else {
        Ok(StatusCode::NOT_FOUND.into_response())
    }
}

async fn delete_todo(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, StatusCode> {
    let mut todos = state
        .write()
        .map_err(|_| {
            tracing::error!("Failed to acquire write lock on the application state.");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let initial_len = todos.len();
    todos.retain(|t| t.id != id);

    if todos.len() < initial_len {
        tracing::info!(todo_id = %id, "Deleted todo");
        Ok(StatusCode::NO_CONTENT.into_response())
    } else {
        Ok(StatusCode::NOT_FOUND.into_response())
    }
}

async fn root() -> &'static str {
    "Hello from Walcron, run /todos to get the todos"
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt; // for `collect`
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_root_endpoint() {
        let state = Arc::new(RwLock::new(Vec::new()));
        let app = app(state.clone());

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..], b"Hello from Walcron, run /todos to get the todos");
    }

    #[tokio::test]
    async fn test_create_todo_endpoint() {
        let state = Arc::new(RwLock::new(Vec::new()));
        let app = app(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todos")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Write Rust tests"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);

        // Verify the state was mutated correctly
        let todos = state.read().unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].title, "Write Rust tests");
        assert_eq!(todos[0].completed, false);
    }
}
