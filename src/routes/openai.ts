import { Hono } from "hono";
import { openAiSpec } from "../openai";
import { appConfig } from "../appconfig";
import { dbRepo } from "../db";

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

	const topic = c.req.query("q");
	if (!topic) return c.json({ error: "question is required" }, 400);

	const queryEmbedding = (await openAiSpec.createEmbeddings(topic, 1536)).data[0].embedding

	const retrievedContext = await dbRepo.queryVector(config.domain, queryEmbedding, 5)

	const userPrompt = `${config.userPrompt} 

					CONTEXT:
					${retrievedContext}`

	const chat = await openAiSpec.completion(
		config.systemPrompt,
		userPrompt,
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
