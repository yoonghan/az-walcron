use anyhow::{Context, Result};
use async_trait::async_trait;
use azure_data_cosmos::{CosmosClient, PartitionKey, Query};
use azure_identity::DefaultAzureCredential;
// ManagedIdentityCredential is often used to debug specific identity issues
use futures::stream::StreamExt;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::{cors::{Any, CorsLayer}, trace::TraceLayer};
use tracing::{error, info_span};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Todo {
    #[serde(rename = "id")]
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

#[async_trait]
trait TodoRepo: Send + Sync {
    async fn list(&self) -> Result<Vec<Todo>>;
    async fn create(&self, todo: Todo) -> Result<Todo>;
    async fn update(&self, id: Uuid, title: String, completed: bool) -> Result<Option<Todo>>;
}

struct CosmosRepo {
    container_client: azure_data_cosmos::clients::ContainerClient,
}

impl CosmosRepo {
    fn new(endpoint: String, database: String, container: String) -> Result<Self> {
        let credential = DefaultAzureCredential::new()?;
        let client = CosmosClient::new(endpoint.as_str(), credential, None)?;
        let database_client = client.database_client(&database);
        let container_client = database_client.container_client(&container);
        Ok(Self { container_client })
    }
}

#[async_trait]
impl TodoRepo for CosmosRepo {
    async fn list(&self) -> Result<Vec<Todo>> {
        let query = Query::from("SELECT * FROM c");
        let mut pager = self.container_client
            .query_items::<Todo>(query, (), None)
            .map_err(|e| {
                error!("CosmosDB List Error: {:?}", e);
                e
            })?;

        let mut todos = Vec::new();
        while let Some(res) = pager.next().await {
            let res = res.map_err(|e| {
                error!("CosmosDB Pager Error: {:?}", e);
                e
            })?;
            let items = res.into_body().await.map_err(|e| {
                error!("CosmosDB Body Error: {:?}", e);
                e
            })?.items;
            for item in items {
                todos.push(item);
            }
        }
        Ok(todos)
    }

    async fn create(&self, todo: Todo) -> Result<Todo> {
        let pk = PartitionKey::from(todo.id.to_string());
        self.container_client
            .create_item(pk, &todo, None)
            .await
            .map_err(|e| {
                error!("CosmosDB Create Error: {:?}", e);
                e
            })?;
        Ok(todo)
    }

    async fn update(&self, id: Uuid, title: String, completed: bool) -> Result<Option<Todo>> {
        let pk = PartitionKey::from(id.to_string());
        let todo = Todo {
            id,
            title,
            completed,
        };

        self.container_client
            .replace_item(pk, id.to_string().as_str(), &todo, None)
            .await
            .map_err(|e| {
                error!("CosmosDB Update Error: {:?}", e);
                e
            })?;

        Ok(Some(todo))
    }
}

type AppState = Arc<dyn TodoRepo>;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();

    // Check for identity environment variables
    let ep_check = std::env::var("IDENTITY_ENDPOINT").is_ok();
    let hdr_check = std::env::var("IDENTITY_HEADER").is_ok();
    tracing::info!("Identity context: IDENTITY_ENDPOINT defined: {}, IDENTITY_HEADER defined: {}", ep_check, hdr_check);

    // Startup Diagnostic: Attempt to fetch a token for CosmosDB
    let diag_cred = DefaultAzureCredential::new()?;
    use azure_core::credentials::TokenCredential;
    
    match diag_cred.get_token(&["https://cosmos.azure.com/.default"]).await {
        Ok(_) => tracing::info!("DIAGNOSTIC: Managed Identity token fetch: SUCCESS"),
        Err(e) => tracing::error!("DIAGNOSTIC: Managed Identity token fetch: FAILED. Error: {:?}", e),
    }

    let endpoint = std::env::var("COSMOS_ENDPOINT")
        .context("COSMOS_ENDPOINT must be set")?;
    let database = std::env::var("COSMOS_DATABASE")
        .context("COSMOS_DATABASE must be set")?;
    let container = std::env::var("COSMOS_CONTAINER")
        .context("COSMOS_CONTAINER must be set")?;

    let repo = CosmosRepo::new(endpoint, database, container)?;
    let state: AppState = Arc::new(repo);
    
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
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        )
        .with_state(state)
}

async fn list_todos(State(state): State<AppState>) -> Result<Json<Vec<Todo>>, StatusCode> {
    let todos = state.list().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to list todos from CosmosDB");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tracing::info!(count = todos.len(), "Listing todos");
    
    Ok(Json(todos))
}

async fn create_todo(
    State(state): State<AppState>,
    Json(payload): Json<CreateTodo>,
) -> Result<impl IntoResponse, StatusCode> {
    let new_todo = Todo {
        id: Uuid::new_v4(),
        title: payload.title,
        completed: false,
    };

    state.create(new_todo.clone()).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to create todo in CosmosDB");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tracing::info!(todo_id = %new_todo.id, "Created new todo");

    Ok((StatusCode::CREATED, Json(new_todo)))
}

async fn update_todo(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateTodo>,
) -> Result<impl IntoResponse, StatusCode> {
    let result = state.update(id, payload.title, payload.completed).await.map_err(|e| {
        tracing::error!(error = %e, todo_id = %id, "Failed to update todo in CosmosDB");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Some(todo) = result {
        tracing::info!(todo_id = %id, "Updated todo");
        Ok((StatusCode::OK, Json(todo)).into_response())
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
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    use std::sync::RwLock;

    struct MemoryRepo {
        todos: RwLock<Vec<Todo>>,
    }

    #[async_trait]
    impl TodoRepo for MemoryRepo {
        async fn list(&self) -> Result<Vec<Todo>> {
            Ok(self.todos.read().unwrap().clone())
        }
        async fn create(&self, todo: Todo) -> Result<Todo> {
            self.todos.write().unwrap().push(todo.clone());
            Ok(todo)
        }
        async fn update(&self, id: Uuid, title: String, completed: bool) -> Result<Option<Todo>> {
            let mut todos = self.todos.write().unwrap();
            if let Some(todo) = todos.iter_mut().find(|t| t.id == id) {
                todo.title = title;
                todo.completed = completed;
                Ok(Some(todo.clone()))
            } else {
                Ok(None)
            }
        }
    }

    #[tokio::test]
    async fn test_root_endpoint_ui_elements() {
        let repo = Arc::new(MemoryRepo { todos: RwLock::new(Vec::new()) });
        let app = app(repo);

        let response = app.clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        
        assert!(body_str.contains("Todo List App"));
    }

    #[tokio::test]
    async fn test_create_and_list_todos() {
        let repo = Arc::new(MemoryRepo { todos: RwLock::new(Vec::new()) });
        let app = app(repo);

        let response = app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todos")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Test integration"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);

        let response = app
            .clone()
            .oneshot(Request::builder().uri("/todos").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let todos: Vec<Todo> = serde_json::from_slice(&body).unwrap();
        
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].title, "Test integration");
    }

    #[tokio::test]
    async fn test_update_todo_status_and_title() {
        let id = Uuid::new_v4();
        let repo = Arc::new(MemoryRepo { 
            todos: RwLock::new(vec![Todo {
                id,
                title: "Original Title".to_string(),
                completed: false,
            }]) 
        });
        let app = app(repo);

        let response = app.clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/todos/{}", id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Updated Title", "completed":true}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(Request::builder().uri("/todos").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let todos: Vec<Todo> = serde_json::from_slice(&body).unwrap();
        assert_eq!(todos[0].title, "Updated Title");
        assert_eq!(todos[0].completed, true);
    }
}
