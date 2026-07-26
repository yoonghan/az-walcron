import { Hono } from "hono";

const adminRoutes = new Hono();

adminRoutes.get("/healthz", (c) => {
	return c.text("ready");
});

adminRoutes.get("/dapr/config", (c) => {
	// Dapr calls this on startup to look for application-side configurations
	// Returning an empty object (200 OK) tells Dapr we have no dynamic config.
	return c.json({});
});

export default adminRoutes;
