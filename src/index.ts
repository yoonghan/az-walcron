import "./tracing"; // Initialize OpenTelemetry before all other imports
import { serve } from "@hono/node-server";
import * as dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { httpInstrumentationMiddleware } from '@hono/otel';
import { renderHtml } from "./html";
import { logger } from "./logger";
import adminRoutes from "./routes/admin";
import genaiRoutes from "./routes/genai";

dotenv.config();

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

app.route("/", adminRoutes);
app.route("/genai", genaiRoutes);

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
