import { serve } from "https://deno.land/std@0.199.0/http/server.ts";

const RUST_API_URL = "http://localhost:3000/todos";

export async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Proxy routes to Rust API
    if (url.pathname.startsWith("/api/todos")) {
        const targetUrl = url.pathname.replace("/api/todos", RUST_API_URL);
        try {
            const fetchOptions: RequestInit = {
                method: req.method,
                headers: req.headers,
            };
            // Forward body for POST and PUT
            if (req.method !== "GET" && req.method !== "HEAD") {
                fetchOptions.body = await req.clone().text(); // Need to read the body. For simple proxy text is fine.
            }
            const proxyRes = await fetch(targetUrl, fetchOptions);
            return new Response(proxyRes.body, {
                status: proxyRes.status,
                headers: proxyRes.headers,
            });
        } catch (err: any) {
            console.error("Proxy error:", err);
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "content-type": "application/json" } });
        }
    }

    if (url.pathname === "/") {
        const html = `
        <!DOCTYPE html>
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
              <p>Served by <strong>Deno</strong>, powered by <strong>Rust API</strong>.</p>
              
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
                  const res = await fetch('/api/todos');
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
                  
                  // Content container
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
                  
                  // Actions container
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

                const res = await fetch('/api/todos', {
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
                const res = await fetch('/api/todos/' + todo.id, {
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
                  const res = await fetch('/api/todos/' + todo.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle.trim(), completed: todo.completed })
                  });
                  if (res.ok) fetchTodos();
                  else alert('Failed to update todo');
                }
              }

              document.getElementById('add-form').addEventListener('submit', addTodo);
              fetchTodos(); // Initial load
            </script>
          </body>
        </html>
        `;

        return new Response(html, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    }

    return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
    console.log("Listening on http://localhost:8080");
    serve(handler, { port: 8080 });
}
