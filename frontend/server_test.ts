import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.199.0/testing/asserts.ts";
import { handler } from "./server.ts";

Deno.test("handler should return 404 for unknown url", async () => {
    const req = new Request("http://localhost:8080/unknown");
    const res = await handler(req);
    assertEquals(res.status, 404);
    assertEquals(await res.text(), "Not Found");
});

Deno.test("handler should return HTML skeleton for /", async () => {
    const req = new Request("http://localhost:8080/");
    const res = await handler(req);
    
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");

    const text = await res.text();
    assertStringIncludes(text, "Todo List");
    assertStringIncludes(text, "api/todos");
    assertStringIncludes(text, "document.getElementById('add-form')");
});

Deno.test("handler should proxy GET /api/todos to Rust backend", async () => {
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (input.toString() === "http://localhost:3000/todos") {
                return new Response(JSON.stringify([
                    { id: 1, title: "Mocked Todo 1", completed: false }
                ]), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            throw new Error("Unexpected fetch call");
        };

        const req = new Request("http://localhost:8080/api/todos");
        const res = await handler(req);

        assertEquals(res.status, 200);
        const json = await res.json();
        assertEquals(json.length, 1);
        assertEquals(json[0].title, "Mocked Todo 1");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("handler should proxy POST /api/todos to Rust backend", async () => {
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (input.toString() === "http://localhost:3000/todos" && init?.method === "POST") {
                const body = await new Response(init.body).text();
                const parsed = JSON.parse(body);
                return new Response(JSON.stringify({ id: 2, title: parsed.title, completed: false }), {
                    status: 201,
                    headers: { "Content-Type": "application/json" }
                });
            }
            throw new Error("Unexpected fetch call");
        };

        const req = new Request("http://localhost:8080/api/todos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Task" })
        });
        const res = await handler(req);

        assertEquals(res.status, 201);
        const json = await res.json();
        assertEquals(json.title, "New Task");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("handler should return 500 when proxy fetch fails", async () => {
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async () => {
            throw new Error("Connection Refused");
        };

        const req = new Request("http://localhost:8080/api/todos");
        const res = await handler(req);

        assertEquals(res.status, 500);

        const json = await res.json();
        assertEquals(json.error, "Connection Refused");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
