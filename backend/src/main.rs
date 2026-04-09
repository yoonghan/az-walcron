use anyhow::Result;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post, put},
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


async fn root() -> Html<&'static str> {
    Html(r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Todo List App</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.5; background: #f8fafc; color: #0f172a; }
      .card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
      h1 { margin-top: 0; }
      ul { list-style-type: none; padding-left: 0; margin: 0; }
      li { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #e2e8f0; }
      li:last-child { border-bottom: none; }
      .todo-content { display: flex; align-items: center; gap: 12px; flex-grow: 1; }
      .todo-actions { display: flex; gap: 8px; }
      button { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; transition: background 0.2s; font-size: 0.9rem; }
      button.primary { background: #3b82f6; color: white; }
      button.primary:hover { background: #2563eb; }
      button.secondary { background: #e2e8f0; color: #0f172a; }
      button.secondary:hover { background: #cbd5e1; }
      button.success { background: #22c55e; color: white; }
      button.success:hover { background: #16a34a; }
      input[type="text"] { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px; flex-grow: 1; font-size: 1rem; }
      .form-group { display: flex; gap: 8px; margin-bottom: 24px; }
      .completed { text-decoration: line-through; color: #64748b; }
      .status-icon { cursor: pointer; width: 24px; text-align: center; font-weight: bold; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Todo List</h1>
      <p>Served by <strong>Rust API</strong>.</p>
      
      <form id="add-form" class="form-group">
        <input type="text" id="new-todo" placeholder="What needs to be done?" required>
        <button type="submit" class="primary">Add Todo</button>
      </form>

      <ul id="todo-list">
        <li>Loading todos...</li>
      </ul>
    </div>

    <script>
      async function fetchTodos() {
        try {
          const res = await fetch('/todos');
          if (!res.ok) throw new Error('Failed to fetch');
          const todos = await res.json();
          renderTodos(todos);
        } catch (e) {
          document.getElementById('todo-list').innerHTML = '<li><em>Error loading todos: ' + e.message + '</em></li>';
        }
      }

      function renderTodos(todos) {
        const list = document.getElementById('todo-list');
        list.innerHTML = '';
        if (todos.length === 0) {
          list.innerHTML = '<li><em>No todos found.</em></li>';
          return;
        }
        
        todos.forEach(todo => {
          const li = document.createElement('li');
          
          const content = document.createElement('div');
          content.className = 'todo-content';
          
          const status = document.createElement('span');
          status.textContent = todo.completed ? '✓' : '○';
          status.className = 'status-icon';
          status.style.color = todo.completed ? '#22c55e' : '#64748b';
          status.title = 'Toggle status';
          status.onclick = () => toggleTodo(todo);
          
          const title = document.createElement('span');
          title.textContent = todo.title;
          if (todo.completed) title.className = 'completed';
          
          content.appendChild(status);
          content.appendChild(title);
          
          const actions = document.createElement('div');
          actions.className = 'todo-actions';
          
          const editBtn = document.createElement('button');
          editBtn.textContent = 'Edit';
          editBtn.className = 'secondary';
          editBtn.onclick = () => editTodo(todo);
          
          const doneBtn = document.createElement('button');
          doneBtn.textContent = todo.completed ? 'Pending' : 'Done';
          doneBtn.className = todo.completed ? 'secondary' : 'success';
          doneBtn.onclick = () => toggleTodo(todo);
          
          actions.appendChild(editBtn);
          actions.appendChild(doneBtn);
          
          li.appendChild(content);
          li.appendChild(actions);
          list.appendChild(li);
        });
      }

      async function addTodo(e) {
        e.preventDefault();
        const input = document.getElementById('new-todo');
        const title = input.value.trim();
        if (!title) return;

        const res = await fetch('/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        });
        
        if (res.ok) {
          input.value = '';
          fetchTodos();
        } else {
          alert('Failed to add todo');
        }
      }

      async function toggleTodo(todo) {
        const res = await fetch('/todos/' + todo.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: todo.title, completed: !todo.completed })
        });
        if (res.ok) fetchTodos();
        else alert('Failed to update todo status');
      }

      async function editTodo(todo) {
        const newTitle = prompt('Edit todo:', todo.title);
        if (newTitle !== null && newTitle.trim() !== '') {
          const res = await fetch('/todos/' + todo.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle.trim(), completed: todo.completed })
          });
          if (res.ok) fetchTodos();
          else alert('Failed to update todo');
        }
      }

      document.getElementById('add-form').addEventListener('submit', addTodo);
      fetchTodos();
    </script>
  </body>
</html>"#)
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
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_str.contains("Todo List App"));
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
