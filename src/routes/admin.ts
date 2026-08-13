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


async function handleConfigRefresh(c: any) {
	if (c.req.method === "POST") {
		try {
			const body = await c.req.json();
			// Event Grid Subscription Validation Handshake
			if (Array.isArray(body) && body[0]?.eventType === "Microsoft.EventGrid.SubscriptionValidationEvent") {
				const validationCode = body[0]?.data?.validationCode;
				return c.json({ validationResponse: validationCode });
			}
		} catch {
			// Ignore JSON parsing errors for empty POST bodies
		}
	}

	const refreshed = await appConfig.refresh();
	return c.json({ refresh: refreshed });
}

adminRoutes.get("/admin/config/refresh", handleConfigRefresh);
adminRoutes.post("/admin/config/refresh", handleConfigRefresh);

export default adminRoutes;
