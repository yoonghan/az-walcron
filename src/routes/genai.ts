import { Hono } from "hono";
import { openAiSpec } from "../openai";
import { appConfig } from "../appconfig";
import { dbRepo } from "../db";
import { tutorTools } from "../openai-tools/tutorTools";
import { logger } from "../logger";

const genaiRoutes = new Hono();

genaiRoutes.get("/", async (c) => {
	return c.json(await openAiSpec.getSpec());
});

genaiRoutes.get("/config", async (c) => {
	const openAISpecSettings = await openAiSpec.getSpec();
	const openAIConfig = await appConfig.getOpenAISetting();
	return c.json({ config: openAIConfig, spec: openAISpecSettings });
});

genaiRoutes.get("/question", async (c) => {

	const config = await appConfig.getOpenAISetting();

	const topic = c.req.query("q");
	if (!topic) return c.json({ error: "question is required" }, 400);

	const chatMessage = await dbRepo.getSavedChat(config.systemPrompt)

	chatMessage.messages = openAiSpec.formatChatHistory(chatMessage.messages);
	chatMessage.messages.push({ role: "user", content: topic });

	logger.info({ event: "chatMessage", data: chatMessage });

	let completionResponse = await openAiSpec.completion(
		chatMessage.messages,
		Number(config.temperature),
		config.isQuestionFormatted,
		{ tools: tutorTools, tool_choice: "required" }
	);

	let responseMessage = completionResponse.choices[0].message;

	for (let i = 0; i < 10 && responseMessage.tool_calls; i++) {
		logger.info({ event: "toolCall", data: responseMessage.tool_calls });

		chatMessage.messages.push(responseMessage);

		for (const toolCall of responseMessage.tool_calls) {
			logger.info({ event: "processingToolCall", data: toolCall });
			if (toolCall.type === "function") {
				const functionName = toolCall.function.name
				const args = JSON.parse(toolCall.function.arguments);
				let toolResult: string = "";

				if (functionName === "search_syllabus") {
					const queryEmbedding = (await openAiSpec.createEmbeddings(args.topic, 1536)).data[0].embedding

					const retrievedContext = await dbRepo.queryVector(config.domain, queryEmbedding, 5)

					toolResult = `${config.userPrompt}\n\nCONTEXT\n${retrievedContext}`
				}
				else if (functionName === "save_user_progress") {
					const saveStatus = await dbRepo.saveProgressToCosmos(args.topic, args.subtopic, args.score, new Date().toISOString());
					toolResult = saveStatus;
				}

				chatMessage.messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: toolResult
				});
			} else {
				responseMessage = {
					role: "assistant",
					content: `Tool call ${toolCall.id} is invalid`,
					refusal: "Unknown action"
				};
				break;
			}

		}

		logger.info({ event: "toolResults", data: chatMessage.messages });
		completionResponse = await openAiSpec.completion(
			chatMessage.messages,
			Number(config.temperature),
			config.isQuestionFormatted,
			{ tools: tutorTools, tool_choice: "auto" }
		);

		//important else there is infinite loop
		responseMessage = completionResponse.choices[0].message;
	}

	const messageContent = responseMessage.content
	chatMessage.messages.push({
		role: "assistant",
		content: messageContent
	});

	const messagesToSave = openAiSpec.formatChatHistory(chatMessage.messages);
	await dbRepo.saveChatTurn(messagesToSave)

	if (c.req.query("pretty") !== undefined) {
		if (messageContent !== null) {
			try {
				const content = JSON.parse(messageContent);
				const markdown = [
					`### QUESTION`,
					content["question"],
					``,
					`**ANSWER:** ${content["answer"]}`,
					``,
					`**HINT:** ${content["hint"]}`,
					``,
					`**EXPLANATION:**`,
					content["explanation"]
				].join("\n");

				return c.text(markdown, 200, { "Content-Type": "text/plain; charset=utf-8" });
			} catch (e: unknown) {
				return c.text(messageContent);
			}
		}
	}

	return c.json(completionResponse);
});


export default genaiRoutes;
