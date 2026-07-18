import "./tracing"; // Initialize OpenTelemetry before all other imports
import { serve } from "@hono/node-server";
import * as dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { httpInstrumentationMiddleware } from '@hono/otel';
import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { dbRepo } from "./db";
import { renderHtml } from "./html";
import { openAiSpec } from "./openai";

dotenv.config();

// Create structured logger
const logger = pino({
	level: process.env.LOG_LEVEL || "info",
	formatters: {
		level: (label) => {
			return { level: label };
		},
	},
});
type Variables = {
	requestId: string;
};

const app = new Hono<{ Variables: Variables }>();

app.use("*", cors());

app.use('*', httpInstrumentationMiddleware());

/*

// Observability Middleware: Injection of request_id, OTEL Context, and logging
app.use("*", async (c, next) => {
	const reqIdHeader = c.req.header("x-request-id");
	const requestId = reqIdHeader || uuidv4();
	c.set("requestId", requestId);

	const tracer = trace.getTracer("hono-server");

	// Start explicit root span for this request
	return tracer.startActiveSpan(
		`HTTP ${c.req.method} ${new URL(c.req.url).pathname}`,
		async (span) => {
			const start = Date.now();
			try {
				await next();
			} finally {
				const ms = Date.now() - start;
				const status = c.res.status;

				// Inject standard HTTP attributes and correlate IDs
				span.setAttributes({
					"http.method": c.req.method,
					"http.url": c.req.url,
					"http.status_code": status,
					request_id: requestId,
				});
				span.end();

				logger.info({
					event: "request",
					method: c.req.method,
					url: c.req.url,
					status: status,
					responseTimeMs: ms,
					request_id: requestId,
					trace_id: span.spanContext().traceId,
				});
			}
		},
	);
});
*/

app.get("/", (c) => {
	return c.html(renderHtml());
});

app.get("/healthz", (c) => {
	return c.text("ready");
});

app.get("/dapr/config", (c) => {
	// Dapr calls this on startup to look for application-side configurations
	// Returning an empty object (200 OK) tells Dapr we have no dynamic config.
	return c.json({});
});

app.get("/openai", async (c) => {
	return c.json(openAiSpec.getSpec());
})

app.get("/objectives", async (c) => {
	try {
		const objectives = await dbRepo.listObjectives();
		return c.json(objectives);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to list objectives",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

app.get("/todos", async (c) => {
	try {
		const todos = await dbRepo.listTodos();
		return c.json(todos);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to list todos",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

app.post("/todos", async (c) => {
	try {
		const body = await c.req.json();
		const newTodo = {
			id: uuidv4(),
			objective: body.objective,
			title: body.title,
			completed: false,
		};
		const created = await dbRepo.createTodo(newTodo);
		return c.json(created, 201);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to create todo",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

app.put("/todos/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json();
		const updated = await dbRepo.updateTodo(
			id,
			body.objective,
			body.title,
			body.completed,
		);

		if (!updated) {
			return c.json({ error: "Not found" }, 404);
		}
		return c.json(updated);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to update todo",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

app.delete("/todos/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const objective = c.req.query("objective");

		if (!objective) {
			return c.json({ error: "Missing objective query parameter" }, 400);
		}

		const deleted = await dbRepo.deleteTodo(id, objective);
		if (!deleted) {
			return c.json({ error: "Not found" }, 404);
		}
		return new Response(null, { status: 204 });
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to delete todo",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

logger.info({
	event: "startup",
	message: `Server is starting on port ${port}`,
});

if (process.env.NODE_ENV !== "test") {
	serve({
		fetch: app.fetch,
		port,
	});
}

export default app;
