import { Hono } from "hono";
import { openAiSpec } from "../openai";
import { appConfig } from "../appconfig";
import { dbRepo } from "../db";
import { tutorTools } from "../openai-tools/tutorTools";
import { logger } from "../logger";
import { trace, SpanStatusCode } from '@opentelemetry/api';

const genaiRoutes = new Hono();
const tracer = trace.getTracer("genai-router");

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

	return await tracer.startActiveSpan('genai-query-question', async (span) => {
		try {
			span.setAttribute('gen_ai.domain', config.domain);
			span.setAttribute('gen_ai.systemPrompt', config.systemPrompt);
			span.setAttribute('gen_ai.userPrompt', config.userPrompt);
			span.setAttribute('gen_ai.temperature', config.temperature);
			span.setAttribute('gen_ai.isQuestionFormatted', config.isQuestionFormatted);

			const topic = c.req.query("q");
			if (!topic) {
				span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing query parameter' });
				return c.json({ error: "question is required" }, 400);
			}

			const chatMessage = await dbRepo.getSavedChat(config.systemPrompt)

			chatMessage.messages = openAiSpec.formatChatHistory(chatMessage.messages);

			span.setAttribute('gen_ai.user_query', topic);

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
				// Child span for each tool-call round — auto-parented to 'genai-query-question'
				await tracer.startActiveSpan(`tool-call-round-${i}`, async (roundSpan) => {
					try {
						roundSpan.setAttribute('gen_ai.tool_round', i);
						roundSpan.setAttribute('gen_ai.tool_count', responseMessage.tool_calls!.length);
						logger.info({ event: "toolCall", data: responseMessage.tool_calls });

						chatMessage.messages.push(responseMessage);

						for (const toolCall of responseMessage.tool_calls!) {
							// Grandchild span for each individual tool — auto-parented to the round span
							await tracer.startActiveSpan(`tool:${toolCall.type}`, async (toolSpan) => {
								try {
									toolSpan.setAttribute('gen_ai.tool.id', toolCall.id);
									logger.info({ event: "processingToolCall", data: toolCall });

									if (toolCall.type === "function") {
										const functionName = toolCall.function.name
										toolSpan.setAttribute('gen_ai.tool.name', functionName);
										const args = JSON.parse(toolCall.function.arguments);
										toolSpan.setAttribute('gen_ai.tool.arguments', toolCall.function.arguments);
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

										toolSpan.setStatus({ code: SpanStatusCode.OK });
									} else {
										responseMessage = {
											role: "assistant",
											content: `Tool call ${toolCall.id} is invalid`,
											refusal: "Unknown action"
										};
										toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid tool type' });
									}
								} catch (err) {
									toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
									toolSpan.recordException(err as Error);
									throw err;
								} finally {
									toolSpan.end();
								}
							});
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
						roundSpan.setStatus({ code: SpanStatusCode.OK });
					} catch (err) {
						roundSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
						roundSpan.recordException(err as Error);
						throw err;
					} finally {
						roundSpan.end();
					}
				});
			}

			span.setAttribute('gen_ai.tool_rounds_total', completionResponse.usage?.total_tokens ?? 0);
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

			span.setStatus({ code: SpanStatusCode.OK });
			return c.json(completionResponse);
		} catch (err) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
			span.recordException(err as Error);
			throw err;
		} finally {
			span.end();
		}
	});
});


export default genaiRoutes;
