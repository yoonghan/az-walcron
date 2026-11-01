import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { tutorTools } from "../openai-tools/tutorTools";

const hasOpenAiApiKey = Boolean(process.env.OPENAI_API_KEY);
const hasLocalOpenAi = Boolean(process.env.LOCAL_OPENAI_URL);
const canRunEvals = hasOpenAiApiKey || hasLocalOpenAi;

/**
 * Reliability & Contract Evaluation Suite for ChatGPT Mini (gpt-4o-mini).
 *
 * This suite verifies model behavior, tool-calling intent, and schema adherence
 * without relying on Azure AI Foundry. It can run against:
 * 1. Direct OpenAI API (set OPENAI_API_KEY)
 * 2. Local OpenAI-compatible runner (set LOCAL_OPENAI_URL=http://localhost:11434/v1)
 *
 * It is skipped automatically in offline CI when no credentials/endpoints are present.
 */
describe.skipIf(!canRunEvals)(
	"ChatGPT Mini (gpt-4o-mini) Reliability Evals",
	() => {
		const modelName = process.env.OPENAI_EVAL_MODEL || "gpt-4o-mini";
		const client = new OpenAI({
			apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-local",
			baseURL: process.env.LOCAL_OPENAI_URL || undefined,
		});

		it("adheres strictly to exam_prep_content JSON schema with temperature 0", async () => {
			const response = await client.chat.completions.create({
				model: modelName,
				temperature: 0,
				messages: [
					{
						role: "system",
						content:
							"You are an AI exam tutor. Produce a practice question about Cosmos DB consistency levels.",
					},
					{
						role: "user",
						content: "Generate one question on Strong vs Eventual consistency.",
					},
				],
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "exam_prep_content",
						strict: true,
						schema: {
							type: "object",
							properties: {
								question: { type: "string" },
								hint: { type: "string" },
								answer: { type: "string" },
								explanation: { type: "string" },
							},
							required: ["question", "hint", "answer", "explanation"],
							additionalProperties: false,
						},
					},
				},
			});

			const content = response.choices[0].message.content;
			expect(content).toBeTruthy();

			const parsed = JSON.parse(content as string);
			expect(typeof parsed.question).toBe("string");
			expect(typeof parsed.hint).toBe("string");
			expect(typeof parsed.answer).toBe("string");
			expect(typeof parsed.explanation).toBe("string");

			// Contract: No extra keys allowed
			const allowedKeys = new Set([
				"question",
				"hint",
				"answer",
				"explanation",
			]);
			for (const key of Object.keys(parsed)) {
				expect(allowedKeys.has(key)).toBe(true);
			}
		});

		it("selects search_syllabus tool with valid schema when asked for study material", async () => {
			const response = await client.chat.completions.create({
				model: modelName,
				temperature: 0,
				messages: [
					{
						role: "system",
						content:
							"You are an AI exam tutor. You MUST search the syllabus before quizzing.",
					},
					{
						role: "user",
						content:
							"I want to study Cosmos DB Change Feed and its architecture.",
					},
				],
				tools: tutorTools,
				tool_choice: "auto",
			});

			const message = response.choices[0].message;
			expect(message.tool_calls).toBeDefined();
			expect(message.tool_calls?.length).toBeGreaterThan(0);

			const toolCall = message.tool_calls?.[0];
			expect(toolCall).toBeDefined();
			expect(toolCall?.type).toBe("function");
			expect(toolCall?.function.name).toBe("search_syllabus");

			const args = JSON.parse(toolCall?.function.arguments || "{}");
			expect(typeof args.topic).toBe("string");
			expect(args.topic.length).toBeGreaterThan(0);
		});

		it("selects save_user_progress tool with valid enum topic and score when user answers", async () => {
			const response = await client.chat.completions.create({
				model: modelName,
				temperature: 0,
				messages: [
					{
						role: "system",
						content:
							"You are an AI exam tutor. When a user submits an answer to a quiz question, record their progress with the save_user_progress tool.",
					},
					{
						role: "assistant",
						content:
							"Question 1: What is the primary benefit of Cosmos DB Change Feed? A) Storage tiering B) Ordered stream of updates",
					},
					{
						role: "user",
						content: "Answer: B is correct. Please save my score.",
					},
				],
				tools: tutorTools,
				tool_choice: "auto",
			});

			const message = response.choices[0].message;
			expect(message.tool_calls).toBeDefined();

			const saveCall = message.tool_calls?.find(
				(tc) => tc.function.name === "save_user_progress",
			);
			expect(saveCall).toBeDefined();

			const args = JSON.parse(saveCall?.function.arguments || "{}");
			const allowedTopics = [
				"Containers",
				"Cosmos DB",
				"OpenAI SDK",
				"PostgreSQL",
				"Redis",
				"Events",
				"Azure Functions",
				"Security",
				"Monitor",
				"Blob Storage",
			];

			expect(allowedTopics).toContain(args.topic);
			expect(typeof args.subtopic).toBe("string");
			expect(typeof args.score).toBe("number");
			expect([0, 100]).toContain(args.score);
		});
	},
);
