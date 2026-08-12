import { Hono } from "hono";
import { appConfig } from "../appconfig";

const adminRoutes = new Hono();

adminRoutes.get("/healthz", (c) => {
	return c.text("ready");
});

adminRoutes.get("/dapr/config", (c) => {
	// Dapr calls this on startup to look for application-side configurations
	// Returning an empty object (200 OK) tells Dapr we have no dynamic config.
	return c.json({});
});

adminRoutes.get("/admin/config", async (c) => {
	const config = await appConfig.getOpenAISetting();
	return c.json({ config: config });
});


adminRoutes.get("/admin/config/refresh", async (c) => {
	return c.json({ refresh: await appConfig.refresh() });
});

export default adminRoutes;
