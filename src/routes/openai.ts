import { Hono } from "hono";
import { openAiSpec } from "../openai";
import { appConfig } from "../appconfig";

const openaiRoutes = new Hono();

openaiRoutes.get("/", async (c) => {
	return c.json(await openAiSpec.getSpec());
});

openaiRoutes.get("/config", async (c) => {
	const openAISpecSettings = await openAiSpec.getSpec();
	const openAIConfig = await appConfig.getOpenAISetting();
	return c.json({ config: openAIConfig, spec: openAISpecSettings });
});

openaiRoutes.get("/question", async (c) => {
	const config = await appConfig.getOpenAISetting();

	const chat = await openAiSpec.completion(
		config.systemPrompt,
		config.userPrompt,
		Number(config.temperature),
		config.isQuestionFormatted
	);

	if (c.req.query("pretty") !== undefined) {
		const message = chat.choices[0].message;
		if (message.content !== null) {
			const content = JSON.parse(message.content);
			return c.json({
				ask: content["question"],
				hint: content["hint"],
				explanation: content["explanation"],
				result: content["answer"]
			});
		}
	}
	return c.json(chat);
});

export default openaiRoutes;
