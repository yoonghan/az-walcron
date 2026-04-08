import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.199.0/testing/asserts.ts";
import { handler } from "./server.ts";

Deno.test("handler should return 404 for unknown url", async () => {
    const req = new Request("http://localhost:8080/unknown");
    const res = await handler(req);
    assertEquals(res.status, 404);
    assertEquals(await res.text(), "Not Found");
});

Deno.test("handler should return HTML list of todos when fetching /", async () => {
    const originalFetch = globalThis.fetch;

    try {
        // Mock the global fetch
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (input.toString() === "http://localhost:3000/todos") {
                return new Response(JSON.stringify([
                    { id: 1, title: "Mocked Todo 1", completed: false },
                    { id: 2, title: "Mocked Todo 2", completed: true }
                ]), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            throw new Error("Unexpected fetch call");
        };

        const req = new Request("http://localhost:8080/");
        const res = await handler(req);

        assertEquals(res.status, 200);
        assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");

        const text = await res.text();
        assertStringIncludes(text, "Todo List");
        assertStringIncludes(text, "Mocked Todo 1");
        assertStringIncludes(text, "Mocked Todo 2");
        assertStringIncludes(text, "○ Pending");
        assertStringIncludes(text, "✓ Completed");
    } finally {
        // Restore fetch
        globalThis.fetch = originalFetch;
    }
});

Deno.test("handler should return 500 when fetch fails", async () => {
    const originalFetch = globalThis.fetch;

    try {
        // Mock the global fetch to reject
        globalThis.fetch = async () => {
            throw new Error("Connection Refused");
        };

        const req = new Request("http://localhost:8080/");
        const res = await handler(req);

        assertEquals(res.status, 500);

        const text = await res.text();
        assertStringIncludes(text, "Error");
        assertStringIncludes(text, "Could not fetch from http://localhost:3000/todos. Error: Connection Refused");
    } finally {
        // Restore fetch
        globalThis.fetch = originalFetch;
    }
});
