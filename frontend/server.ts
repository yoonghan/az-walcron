import { serve } from "https://deno.land/std@0.199.0/http/server.ts";

export async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/") {
        try {
            // Fetching from the Rust container running in the same pod via localhost:3000
            const rs = await fetch("http://localhost:3000/todos");
            const todos = await rs.json();

            const listItems = todos.map((t: any) => `
        <li style="margin-bottom: 8px;">
          <strong>${t.title}</strong>
          <span style="color: ${t.completed ? 'green' : 'red'}; margin-left: 10px;">
            ${t.completed ? '✓ Completed' : '○ Pending'}
          </span>
        </li>
      `).join("");

            const html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Todo List from Deno and Rust</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.5; }
              ul { list-style-type: none; padding-left: 0; }
              .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Todo List</h1>
              <p>Served by <strong>Deno</strong> (port 8080), fetching data from <strong>Rust API</strong> (port 3000).</p>
              <ul>
                ${todos.length ? listItems : '<li><em>No todos found.</em></li>'}
              </ul>
            </div>
          </body>
        </html>
      `;

            return new Response(html, {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        } catch (err: any) {
            console.error("Error fetching from Rust API:", err);
            // Return a basic error page so it's clear what went wrong
            const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Error</h1>
            <p>Could not fetch from http://localhost:3000/todos. Error: ${err.message}</p>
          </body>
        </html>
      `;
            return new Response(html, {
                status: 500,
                headers: { "content-type": "text/html" }
            });
        }
    }

    return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
    console.log("Listening on http://localhost:8080");
    serve(handler, { port: 8080 });
}
