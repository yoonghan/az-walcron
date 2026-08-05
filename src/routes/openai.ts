import { Hono } from "hono";
import { openAiSpec } from "../openai";
import { appConfig } from "../appconfig";
import { dbRepo } from "../db";
import { tutorTools } from "../openai-tools/tutorTools";

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

	const userPrompt = `${config.userPrompt}`
	const chatMessage = await dbRepo.getSavedChat(config.systemPrompt, userPrompt)

	let completionResponse = await openAiSpec.completion(
		chatMessage.messages,
		Number(config.temperature),
		"false",
		tutorTools
	);

	let responseMessage = completionResponse.choices[0].message;

	while (responseMessage.tool_calls) {
		console.log("LLM requested tool execution!");

		chatMessage.messages.push(responseMessage);

		//TODO: Requires testing
		for (const toolCall of responseMessage.tool_calls) {
			console.log("Processing tool call: ", toolCall);
			if (toolCall.type === "function") {
				const functionName = toolCall.function.name
				const args = JSON.parse(toolCall.function.arguments);
				let toolResult: string = "";

				if (functionName === "search_syllabus") {
					console.log(`Executing Vector Search for: ${args.topic}`);
					const queryEmbedding = (await openAiSpec.createEmbeddings(args.topic, 1536)).data[0].embedding

					const retrievedContext = await dbRepo.queryVector(config.domain, queryEmbedding, 5)

					toolResult = `${config.userPrompt}\n\nCONTEXT\n${retrievedContext}`
				}
				else if (functionName === "save_user_progress") {
					console.log(`Executing Progress Save for: ${args.topic}`);
					// Your custom function that point-writes to the UserData container
					const saveStatus = await dbRepo.saveProgressToCosmos(args.topic, args.score, new Date().toISOString());
					toolResult = saveStatus;
				}

				chatMessage.messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: toolResult
				});
			}

		}

		console.log("messages", chatMessage.messages)

		console.log("Passing tool results back to LLM...");
		completionResponse = await openAiSpec.completion(
			chatMessage.messages,
			Number(config.temperature),
			config.isQuestionFormatted,
			tutorTools
		);
	}

	const messageContent = completionResponse.choices[0].message.content
	chatMessage.messages.push({
		role: "assistant",
		content: messageContent
	});

	await dbRepo.saveChatTurn(chatMessage.messages)

	if (c.req.query("pretty") !== undefined) {
		if (messageContent !== null) {
			const content = JSON.parse(messageContent);
			return c.json({
				ask: content["question"],
				hint: content["hint"],
				explanation: content["explanation"],
				result: content["answer"]
			});
		}
	}
	return c.json(completionResponse);
});


export default openaiRoutes;
