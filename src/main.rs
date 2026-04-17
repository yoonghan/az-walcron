use anyhow::{Context, Result};
use async_trait::async_trait;
use azure_data_cosmos::clients::{CloudLocation, CosmosClientBuilder};
use azure_data_cosmos::prelude::*;
// Removed incorrect PartitionKey import that was causing 400 BadRequest

use azure_identity::DefaultAzureCredential;
use futures::stream::StreamExt;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::get,
    routing::{post, put},
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tower_http::{cors::{Any, CorsLayer}, trace::TraceLayer};
use tracing::info_span;
use uuid::Uuid;

use opentelemetry::KeyValue;
use opentelemetry_sdk::{trace as sdktrace, Resource};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Registry};

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Todo {
    #[serde(rename = "id")]
    id: Uuid,
    objective: String,
    title: String,
    completed: bool,
}

impl CosmosEntity for Todo {
    type Entity = String;

    fn partition_key(&self) -> Self::Entity {
        self.objective.clone()
    }
}

#[derive(Deserialize, Debug)]
struct CreateTodo {
    objective: String,
    title: String,
}

#[derive(Deserialize, Debug)]
struct UpdateTodo {
    objective: String,
    title: String,
    completed: bool,
}

#[derive(Deserialize, Debug)]
struct DeleteQuery {
    objective: String,
}

#[async_trait]
trait TodoRepo: Send + Sync {
    async fn list_objectives(&self) -> Result<Vec<String>>;
    async fn list(&self) -> Result<Vec<Todo>>;
    async fn create(&self, todo: Todo) -> Result<Todo>;
    async fn update(&self, id: Uuid, objective: String, title: String, completed: bool) -> Result<Option<Todo>>;
    async fn delete(&self, id: Uuid, objective: String) -> Result<bool>;
}

#[derive(Debug)]
struct CosmosTokenCredential {
    inner: Arc<DefaultAzureCredential>,
}

#[async_trait]
impl azure_core::auth::TokenCredential for CosmosTokenCredential {
    async fn get_token(&self, _scopes: &[&str]) -> azure_core::Result<azure_core::auth::AccessToken> {
        // Force the scope to the official Cosmos DB data plane scope.
        // SDK 0.21.0 sometimes generates host-based scopes that fail with Managed Identity.
        self.inner.get_token(&["https://cosmos.azure.com/.default"]).await
    }

    async fn clear_cache(&self) -> azure_core::Result<()> {
        self.inner.clear_cache().await
    }
}

pub struct CosmosRepo {
    collection_client: Arc<CollectionClient>,
}

impl CosmosRepo {
    fn new(endpoint: String, database: String, collection: String) -> Result<Self> {
        let options = azure_identity::TokenCredentialOptions::default();
        let credential = Arc::new(DefaultAzureCredential::create(options)?);
        let wrapped_credential = Arc::new(CosmosTokenCredential { inner: credential });
        let auth_token = AuthorizationToken::TokenCredential(wrapped_credential);
        
        let client = CosmosClientBuilder::with_location(CloudLocation::Custom {
            uri: endpoint,
            auth_token,
        })
        .build();

        let database_client = client.database_client(database);
        let collection_client = Arc::new(database_client.collection_client(collection));
        Ok(Self { collection_client })
    }
}

#[async_trait]
impl TodoRepo for CosmosRepo {
    #[tracing::instrument(skip(self), err, fields(db.system = "cosmosdb", db.name = "TodoDatabase"))]
    async fn list_objectives(&self) -> Result<Vec<String>> {
        let mut stream = self.collection_client
            .query_documents(Query::from("SELECT VALUE c.objective FROM c"))
            .query_cross_partition(true)
            .into_stream::<serde_json::Value>();

        let mut objectives = Vec::new();
        while let Some(response) = stream.next().await {
            let response = response.map_err(|e| {
                tracing::error!("CosmosDB Pager detailed error: {:?}", e);
                e
            }).context("CosmosDB Pager Error: Check logs for detailed SDK error")?;
            
            for doc in response.documents() {
                if let Some(s) = doc.as_str() {
                    objectives.push(s.to_string());
                }
            }
        }
        
        objectives.sort();
        objectives.dedup();
        Ok(objectives)
    }

    #[tracing::instrument(skip(self), err, fields(db.system = "cosmosdb", db.name = "TodoDatabase"))]
    async fn list(&self) -> Result<Vec<Todo>> {
        let mut stream = self.collection_client
            .query_documents(Query::from("SELECT * FROM c"))
            .query_cross_partition(true)
            .into_stream::<Todo>();

        let mut todos = Vec::new();
        while let Some(response) = stream.next().await {
            let response = response.map_err(|e| {
                tracing::error!("CosmosDB Pager detailed error: {:?}", e);
                e
            }).context("CosmosDB Pager Error: Check logs for detailed SDK error")?;
            todos.extend(response.documents().cloned());
        }
        Ok(todos)
    }

    #[tracing::instrument(skip(self), err, fields(db.system = "cosmosdb", db.name = "TodoDatabase"))]
    async fn create(&self, todo: Todo) -> Result<Todo> {
        self.collection_client
            .create_document(todo.clone())
            .into_future()
            .await
            .context("CosmosDB Create Error")?;
        Ok(todo)
    }

    #[tracing::instrument(skip(self), err, fields(db.system = "cosmosdb", db.name = "TodoDatabase", db.operation = "update"))]
    async fn update(&self, id: Uuid, objective: String, title: String, completed: bool) -> Result<Option<Todo>> {
        let id_str = id.to_string();
        
        tracing::debug!(id = %id_str, objective = %objective, "Fetching document for update");
        
        // In SDK 0.21.0, the partition key value is passed directly (e.g. as a string),
        // not as a PartitionKey definition struct.
        let document_client = self.collection_client
            .document_client(id_str.clone(), &objective)
            .context("Failed to create DocumentClient")?;


        // Fetch current document
        let response = document_client
            .get_document::<Todo>()
            .into_future()
            .await
            .map_err(|e| {
                tracing::error!("GET failed during update for id {}: {:?}", id_str, e);
                e
            })
            .context("CosmosDB Get Error during update")?;
        
        let mut todo = match response {
            GetDocumentResponse::Found(res) => res.document.document,
            GetDocumentResponse::NotFound(_) => {
                tracing::warn!(id = %id_str, "Document not found during update");
                return Ok(None);
            },
        };
        
        todo.title = title;
        todo.completed = completed;

        tracing::debug!(id = %id_str, "Replacing document in CosmosDB");

        document_client
            .replace_document::<Todo>(todo.clone())
            .into_future()
            .await
            .map_err(|e| {
                tracing::error!("REPLACE failed for id {}: {:?}", id_str, e);
                e
            })
            .context("CosmosDB Replace Error")?;

        Ok(Some(todo))
    }

    #[tracing::instrument(skip(self), err, fields(db.system = "cosmosdb", db.name = "TodoDatabase", db.operation = "delete"))]
    async fn delete(&self, id: Uuid, objective: String) -> Result<bool> {
        let id_str = id.to_string();

        tracing::debug!(id = %id_str, objective = %objective, "Deleting document from CosmosDB");

        let document_client = self.collection_client
            .document_client(id_str.clone(), &objective)
            .context("Failed to create DocumentClient for delete")?;

        // Check the document exists first to return 404 if not found.
        let get_response = document_client
            .get_document::<Todo>()
            .into_future()
            .await
            .map_err(|e| {
                tracing::error!("GET failed during delete for id {}: {:?}", id_str, e);
                e
            })
            .context("CosmosDB Get Error during delete")?;

        match get_response {
            GetDocumentResponse::NotFound(_) => {
                tracing::warn!(id = %id_str, "Document not found during delete");
                return Ok(false);
            }
            GetDocumentResponse::Found(_) => {}
        }

        document_client
            .delete_document()
            .into_future()
            .await
            .map_err(|e| {
                tracing::error!("DELETE failed for id {}: {:?}", id_str, e);
                e
            })
            .context("CosmosDB Delete Error")?;

        tracing::info!(id = %id_str, "Deleted todo from CosmosDB");
        Ok(true)
    }
}

type AppState = Arc<dyn TodoRepo>;

fn init_tracer() -> Result<()> {
    // Diagnostic logging to verify platform-injected variables
    tracing::info!("--- OpenTelemetry Startup Diagnostics ---");
    for (key, value) in std::env::vars() {
        if key.starts_with("OTEL_") || key.contains("COSMOS") || key.contains("IDENTITY") {
            tracing::info!("  {} = {}", key, value);
        }
    }

    let service_name = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "walcron-backend".to_string());

    // App Insights Map relies on cloud.role_name (mapped from service.name)
    let resource = Resource::new(vec![
        KeyValue::new("service.name", service_name.clone()),
        KeyValue::new("cloud.role_name", service_name),
        KeyValue::new("service.namespace", "walcron"),
    ]);

    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(opentelemetry_otlp::new_exporter().tonic())
        .with_trace_config(
            sdktrace::config().with_resource(resource),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .context("Failed to install OpenTelemetry tracer")?;

    let telemetry = tracing_opentelemetry::layer().with_tracer(tracer.clone());

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,azure_data_cosmos=error,azure_core=error,opentelemetry=debug"));

    let fmt = tracing_subscriber::fmt::layer().with_target(false).compact();

    Registry::default()
        .with(env_filter)
        .with(fmt)
        .with(telemetry)
        .try_init()
        .ok();

    // Emit a test span immediately to verify flush
    use opentelemetry::trace::Tracer;
    tracer.in_span("startup_diagnostic", |_cx| {
        tracing::info!("Sent startup diagnostic span");
    });

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize OpenTelemetry structured logging
    init_tracer().context("Failed to init tracer")?;

    // Log identity context for observability (no network call)
    let ep_check = std::env::var("IDENTITY_ENDPOINT").is_ok();
    let hdr_check = std::env::var("IDENTITY_HEADER").is_ok();
    tracing::info!(
        "Identity context: IDENTITY_ENDPOINT defined: {}, IDENTITY_HEADER defined: {}",
        ep_check, hdr_check
    );

    // Read config — fast, no network I/O
    let mut endpoint = std::env::var("COSMOS_ENDPOINT")
        .context("COSMOS_ENDPOINT must be set")?;

    // Sanitize endpoint: handle accidental double prefixes or missing scheme
    if endpoint.starts_with("https://https://") {
        endpoint = endpoint.replacen("https://https://", "https://", 1);
    }
    if !endpoint.contains("://") {
        endpoint = format!("https://{}", endpoint);
    }

    tracing::info!("Using Cosmos Endpoint: {}", endpoint);

    let database = std::env::var("COSMOS_DATABASE")
        .context("COSMOS_DATABASE must be set")?;
    let container = std::env::var("COSMOS_CONTAINER")
        .context("COSMOS_CONTAINER must be set")?;

    // Build the repo — the Azure credential is lazy; no network call happens here
    let repo = CosmosRepo::new(endpoint, database, container)?;
    let state: AppState = Arc::new(repo);

    // Bind the port FIRST so Azure's liveness probe gets an immediate response.
    // The /healthz readiness probe will only return 200 once the Managed Identity
    // token is warmed up, preventing ACA from routing real traffic too early.
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("Server listening on {}", listener.local_addr()?);

    // Shared flag: flips to true once the MSI token is successfully cached.
    // The /healthz endpoint exposes this to ACA's readiness probe.
    let is_ready = Arc::new(AtomicBool::new(false));

    // Background task: warm up the Managed Identity token with retries.
    // ACA buffers the first incoming request until the readiness probe passes,
    // so setting this flag is what gates real traffic to the pod.
    let warmup_state = Arc::clone(&state);
    let warmup_ready = Arc::clone(&is_ready);
    tokio::spawn(async move {
        tracing::info!("Background: warming up Managed Identity token...");
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            match warmup_state.list().await {
                Ok(_) => {
                    warmup_ready.store(true, Ordering::Relaxed);
                    tracing::info!(attempt = %attempt, "Background: warm-up OK — service is ready");
                    break;
                }
                Err(e) => {
                    tracing::warn!(attempt = %attempt, "Background: warm-up attempt failed: {}", e);
                    if attempt >= 10 {
                        tracing::error!("Background: warm-up gave up after {} attempts — readiness probe will remain failing", attempt);
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                }
            }
        }
    });

    axum::serve(listener, app(state, is_ready)).await?;

    Ok(())
}

fn app(state: AppState, is_ready: Arc<AtomicBool>) -> Router {
    // Define the router with TraceLayer to support OTEL correlation (request_id)
    Router::new()
        .route("/", get(root))
        .route("/healthz", get(health_check))
        .route("/todos", get(list_todos))
        .route("/todos", post(create_todo))
        .route("/todos/:id", put(update_todo).delete(delete_todo))
        .route("/objectives", get(list_objectives))
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
        // Attach the readiness flag so the /healthz handler can read it
        .layer(Extension(is_ready))
        .with_state(state)
}

/// GET /healthz
/// - Returns 200 once the Managed Identity token warm-up has succeeded.
/// - Returns 503 while the warm-up is still in progress.
///
/// Configure this as the **readiness probe** in Azure Container Apps so that
/// ACA buffers incoming traffic until the pod is genuinely ready to serve
/// CosmosDB requests without delay.
async fn health_check(
    Extension(is_ready): Extension<Arc<AtomicBool>>,
) -> impl IntoResponse {
    if is_ready.load(Ordering::Relaxed) {
        (StatusCode::OK, "ready")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "warming up")
    }
}

async fn list_todos(State(state): State<AppState>) -> Result<Json<Vec<Todo>>, StatusCode> {
    let todos = state.list().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to list todos from CosmosDB");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tracing::info!(count = todos.len(), "Listing todos");
    
    Ok(Json(todos))
}

async fn list_objectives(State(state): State<AppState>) -> Result<Json<Vec<String>>, StatusCode> {
    let objectives = state.list_objectives().await.map_err(|e| {
        tracing::error!(error = %e, "Failed to list objectives from CosmosDB");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    tracing::info!(count = objectives.len(), "Listing objectives");
    Ok(Json(objectives))
}

async fn create_todo(
    State(state): State<AppState>,
    Json(payload): Json<CreateTodo>,
) -> Result<impl IntoResponse, StatusCode> {
    let new_todo = Todo {
        id: Uuid::new_v4(),
        objective: payload.objective,
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
    let result = state.update(id, payload.objective, payload.title, payload.completed).await.map_err(|e| {
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

async fn delete_todo(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    axum::extract::Query(query): axum::extract::Query<DeleteQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let found = state.delete(id, query.objective).await.map_err(|e| {
        tracing::error!(error = %e, todo_id = %id, "Failed to delete todo from CosmosDB");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if found {
        tracing::info!(todo_id = %id, "Deleted todo");
        Ok(StatusCode::NO_CONTENT.into_response())
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
      button.danger { background: #ef4444; color: white; }
      button.danger:hover { background: #dc2626; }
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
        <input type="text" id="new-todo-objective" list="objective-options" placeholder="Objective (e.g. Disney Trip)" required>
        <datalist id="objective-options"></datalist>
        <input type="text" id="new-todo" placeholder="What needs to be done?" required>
        <button type="submit" class="primary">Add Todo</button>
      </form>

      <ul id="todo-list">
        <li>Loading todos...</li>
      </ul>
    </div>

    <script>
      async function fetchObjectives() {
        try {
          const res = await fetch('/objectives');
          if (!res.ok) throw new Error('Failed to fetch objectives');
          const objectives = await res.json();
          const datalist = document.getElementById('objective-options');
          datalist.innerHTML = objectives.map(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            return opt.outerHTML;
          }).join('');
        } catch (e) {
          console.error(e);
        }
      }

      async function fetchTodos() {
        try {
          const res = await fetch('/todos');
          if (!res.ok) throw new Error('Failed to fetch');
          const todos = await res.json();
          renderTodos(todos);
          fetchObjectives();
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

        const objectives = {};
        todos.forEach(t => {
          if (!objectives[t.objective]) objectives[t.objective] = [];
          objectives[t.objective].push(t);
        });

        for (const [objectiveName, objectiveTodos] of Object.entries(objectives)) {
          const objectiveHeader = document.createElement('h3');
          objectiveHeader.textContent = objectiveName;
          list.appendChild(objectiveHeader);
          
          objectiveTodos.forEach(todo => {
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
            
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑 Delete';
            deleteBtn.className = 'danger';
            deleteBtn.onclick = () => deleteTodo(todo);

            actions.appendChild(editBtn);
            actions.appendChild(doneBtn);
            actions.appendChild(deleteBtn);

            li.appendChild(content);
            li.appendChild(actions);
            list.appendChild(li);
          });
        }
      }

      async function addTodo(e) {
        e.preventDefault();
        
        const objectiveInput = document.getElementById('new-todo-objective');
        const titleInput = document.getElementById('new-todo');
        
        const objective = objectiveInput.value.trim();

        const title = titleInput.value.trim();
        if (!title || !objective) return;

        const res = await fetch('/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objective, title })
        });
        
        if (res.ok) {
          titleInput.value = '';
          fetchTodos();
        } else {
          alert('Failed to add todo');
        }
      }

      async function toggleTodo(todo) {
        const res = await fetch('/todos/' + todo.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objective: todo.objective, title: todo.title, completed: !todo.completed })
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
            body: JSON.stringify({ objective: todo.objective, title: newTitle.trim(), completed: todo.completed })
          });
          if (res.ok) fetchTodos();
          else alert('Failed to update todo');
        }
      }

      async function deleteTodo(todo) {
        if (!confirm('Delete "' + todo.title + '"? This cannot be undone.')) return;
        const res = await fetch('/todos/' + todo.id + '?objective=' + encodeURIComponent(todo.objective), { method: 'DELETE' });
        if (res.ok) fetchTodos();
        else alert('Failed to delete todo');
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
        async fn list_objectives(&self) -> Result<Vec<String>> {
            let todos = self.todos.read().unwrap();
            let mut objectives: Vec<String> = todos.iter().map(|t| t.objective.clone()).collect();
            objectives.sort();
            objectives.dedup();
            Ok(objectives)
        }

        async fn list(&self) -> Result<Vec<Todo>> {
            Ok(self.todos.read().unwrap().clone())
        }
        async fn create(&self, todo: Todo) -> Result<Todo> {
            self.todos.write().unwrap().push(todo.clone());
            Ok(todo)
        }
        async fn update(&self, id: Uuid, objective: String, title: String, completed: bool) -> Result<Option<Todo>> {
            let mut todos = self.todos.write().unwrap();
            if let Some(todo) = todos.iter_mut().find(|t| t.id == id && t.objective == objective) {
                todo.title = title;
                todo.completed = completed;
                Ok(Some(todo.clone()))
            } else {
                Ok(None)
            }
        }
        async fn delete(&self, id: Uuid, objective: String) -> Result<bool> {
            let mut todos = self.todos.write().unwrap();
            let before = todos.len();
            todos.retain(|t| !(t.id == id && t.objective == objective));
            Ok(todos.len() < before)
        }
    }

    #[tokio::test]
    async fn test_root_endpoint_ui_elements() {
        let repo = Arc::new(MemoryRepo { todos: RwLock::new(Vec::new()) });
        let app = app(repo, Arc::new(AtomicBool::new(true)));

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
        let app = app(repo, Arc::new(AtomicBool::new(true)));

        let response = app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/todos")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"objective":"Disney Trip","title":"Test integration"}"#))
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
                objective: "Disney Trip".to_string(),
                title: "Original Title".to_string(),
                completed: false,
            }])
        });
        let app = app(repo, Arc::new(AtomicBool::new(true)));

        let response = app.clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/todos/{}", id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"objective":"Disney Trip","title":"Updated Title", "completed":true}"#))
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

    #[tokio::test]
    async fn test_delete_todo() {
        let id = Uuid::new_v4();
        let repo = Arc::new(MemoryRepo {
            todos: RwLock::new(vec![Todo {
                id,
                objective: "Disney Trip".to_string(),
                title: "To be deleted".to_string(),
                completed: false,
            }])
        });
        let app = app(repo, Arc::new(AtomicBool::new(true)));

        // Delete the existing todo — expect 204 No Content
        let response = app.clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/todos/{}?objective=Disney%20Trip", id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // Verify the list is now empty
        let response = app.clone()
            .oneshot(Request::builder().uri("/todos").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let todos: Vec<Todo> = serde_json::from_slice(&body).unwrap();
        assert!(todos.is_empty());

        // Deleting it again should return 404
        let response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/todos/{}?objective=Disney%20Trip", id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
