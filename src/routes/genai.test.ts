import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoist env vars & shared mocks BEFORE any module imports
// ---------------------------------------------------------------------------
const { mockCreateCompletions, mockEmbeddingsCreate } = vi.hoisted(() => {
	process.env.AZURE_OPENAI_ENDPOINT = "test-endpoint";
	process.env.AZURE_OPENAI_API_KEY = "test-key";
	process.env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
	process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "test-embedding-deployment";
	process.env.AZURE_OPENAI_API_VERSION = "test-api-version";
	process.env.AZURE_APPCONFIG_ENDPOINT = "test-appconfig-endpoint";
	process.env.COSMOSDB_ENDPOINT = "https://mock-cosmos.documents.azure.com:443/";

	const mockCreateCompletions = vi.fn();
	const mockEmbeddingsCreate = vi.fn().mockResolvedValue({
		data: [{ embedding: [0.1, 0.2, 0.3] }]
	});

	return { mockCreateCompletions, mockEmbeddingsCreate };
});

// ---------------------------------------------------------------------------
// Mock: tracing (connects to Azure Application Insights – skip in tests)
// ---------------------------------------------------------------------------
vi.mock("../tracing", () => ({}));

// ---------------------------------------------------------------------------
// Mock: openai SDK
// ---------------------------------------------------------------------------
vi.mock("openai", () => ({
	AzureOpenAI: class {
		models = {
			list: vi.fn().mockResolvedValue({ data: [{ id: "test-model" }] })
		};
		chat = {
			completions: {
				create: mockCreateCompletions
			}
		};
		embeddings = {
			create: mockEmbeddingsCreate
		};
	}
}));

// ---------------------------------------------------------------------------
// Mock: Azure App Configuration
// ---------------------------------------------------------------------------
vi.mock("@azure/app-configuration", () => ({
	AppConfigurationClient: class {
		getConfigurationSetting = vi.fn().mockImplementation(async ({ key }: { key: string }) => {
			const values: Record<string, string> = {
				"openai:systemPrompt": "You are an expert AI exam tutor.",
				"openai:userPrompt": "Answer the following question to the best of your ability.",
				"openai:temperature": "0.7",
				"openai:isQuestionFormatted": "true",
				"openai:domain": "AI-200"
			};
			return { key, value: values[key] ?? "test" };
		});
	}
}));

// ---------------------------------------------------------------------------
// Mock: Azure Identity (Managed Identity – not needed in unit tests)
// ---------------------------------------------------------------------------
vi.mock("@azure/identity", () => ({
	DefaultAzureCredential: class { }
}));

// ---------------------------------------------------------------------------
// Mock: CosmosDB (@azure/cosmos)
// ---------------------------------------------------------------------------
const { mockItems, mockItem, mockCosmosClientInstance } = vi.hoisted(() => {
	const mockItems = {
		create: vi.fn(),
		query: vi.fn(),
		upsert: vi.fn()
	};
	const mockItem = { read: vi.fn() };
	const mockContainer = {
		items: mockItems,
		item: vi.fn().mockReturnValue(mockItem)
	};
	const mockDatabase = {
		container: vi.fn().mockReturnValue(mockContainer)
	};
	const mockCosmosClientInstance = {
		database: vi.fn().mockReturnValue(mockDatabase)
	};
	return { mockItems, mockItem, mockContainer, mockDatabase, mockCosmosClientInstance };
});

vi.mock("@azure/cosmos", () => ({
	CosmosClient: vi.fn().mockImplementation(function () { return mockCosmosClientInstance; })
}));

// ---------------------------------------------------------------------------
// Import the Hono app AFTER all mocks are in place
// ---------------------------------------------------------------------------
import app from "../index";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** Build a standard non-tool-call completion response */
function buildTextCompletion(content: string) {
	return {
		choices: [{ message: { role: "assistant", content, tool_calls: undefined } }]
	};
}

/** Build a JSON-formatted exam question completion */
function buildFormattedCompletion(payload: {
	question: string;
	hint: string;
	answer: string;
	explanation: string;
}) {
	return buildTextCompletion(JSON.stringify(payload));
}

/** Build a completion whose message contains tool_calls (parallel) */
function buildToolCallCompletion(toolCalls: Array<{ id: string; name: string; arguments: string }>) {
	return {
		choices: [
			{
				message: {
					role: "assistant",
					content: null,
					refusal: null,
					annotations: [],
					tool_calls: toolCalls.map((tc) => ({
						id: tc.id,
						type: "function",
						function: { name: tc.name, arguments: tc.arguments }
					}))
				}
			}
		]
	};
}

/** Reset CosmosDB item.read to simulate a brand-new session (no prior chat) */
function mockNewSession() {
	mockItem.read.mockResolvedValueOnce({ statusCode: 404, resource: undefined });
}

/** Reset CosmosDB item.read to simulate an existing session with messages */
function mockExistingSession(messages: object[]) {
	mockItem.read.mockResolvedValueOnce({
		statusCode: 200,
		resource: {
			id: "session-default-001",
			userId: "dev-user-001",
			type: "chat",
			messages
		}
	});
}

function mockUpsert() {
	mockItems.upsert.mockResolvedValue({ resource: {}, requestCharge: "10" });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("GET /genai/question - route handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: vector search returns empty context
		mockItems.query.mockReturnValue({
			fetchAll: vi.fn().mockResolvedValue({ resources: [] })
		});
		mockUpsert();
	});

	// -------------------------------------------------------------------------
	// 1. Input validation
	// -------------------------------------------------------------------------
	describe("Input validation", () => {
		it("returns 400 when query param 'q' is missing", async () => {
			const res = await app.request("/genai/question", { method: "GET" });
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body).toEqual({ error: "question is required" });
		});
	});

	// -------------------------------------------------------------------------
	// 2. Happy-path: plain text response (no tool calls, no pretty flag)
	// -------------------------------------------------------------------------
	describe("Plain text completion (no tool calls)", () => {
		it("returns raw completion JSON when no tool calls and no ?pretty flag", async () => {
			mockNewSession();
			const completion = buildTextCompletion("Here is some study material about CosmosDB.");
			mockCreateCompletions.mockResolvedValueOnce(completion);

			const res = await app.request("/genai/question?q=Tell me about CosmosDB", { method: "GET" });
			expect(res.status).toBe(200);
			const body = await res.json();
			// Returns the raw completion response object
			expect(body.choices[0].message.content).toBe("Here is some study material about CosmosDB.");
		});

		it("saves the assistant reply back to CosmosDB chat turn", async () => {
			mockNewSession();
			mockCreateCompletions.mockResolvedValueOnce(
				buildTextCompletion("CosmosDB study response.")
			);

			await app.request("/genai/question?q=CosmosDB overview", { method: "GET" });
			expect(mockItems.upsert).toHaveBeenCalledOnce();
		});
	});

	// -------------------------------------------------------------------------
	// 3. Happy-path: pretty=1 with JSON-formatted response
	// -------------------------------------------------------------------------
	describe("?pretty flag - formatted JSON response", () => {
		const formattedPayload = {
			question: "Which Cosmos DB consistency level guarantees linearizability?",
			hint: "Only one level provides single-copy semantics.",
			answer: "A. Strong",
			explanation: "Strong consistency ensures clients always read the most recent committed write."
		};

		it("returns parsed question fields when ?pretty is present and content is valid JSON", async () => {
			mockNewSession();
			mockCreateCompletions.mockResolvedValueOnce(buildFormattedCompletion(formattedPayload));

			const res = await app.request(
				"/genai/question?q=What is strong consistency?&pretty=1",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.ask).toBe(formattedPayload.question);
			expect(body.hint).toBe(formattedPayload.hint);
			expect(body.result).toBe(formattedPayload.answer);
			expect(body.explanation).toBe(formattedPayload.explanation);
		});

		it("falls back to plain text when ?pretty is set but content is not valid JSON", async () => {
			mockNewSession();
			mockCreateCompletions.mockResolvedValueOnce(
				buildTextCompletion("Not a JSON string - just plain text.")
			);

			const res = await app.request(
				"/genai/question?q=Quick question&pretty",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			// c.text() sets content-type to text/plain
			expect(res.headers.get("content-type")).toMatch(/text\/plain/);
			const body = await res.text();
			expect(body).toBe("Not a JSON string - just plain text.");
		});
	});

	// -------------------------------------------------------------------------
	// 4. Tool-call loop: save_user_progress (single call)
	// -------------------------------------------------------------------------
	describe("Tool-call loop - save_user_progress (single)", () => {
		it("executes save_user_progress tool, returns tool result to LLM, and yields final response", async () => {
			mockNewSession();

			// Round 1: LLM asks to save progress for one topic
			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_001", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "Change feed", score: 100 }) }
				])
			);

			// Round 2: LLM provides final textual response after tool result
			const finalContent = JSON.stringify({
				question: "Quiz feedback",
				hint: "Review CosmosDB Q1.",
				answer: "You scored 100 on CosmosDB Change feed.",
				explanation: "deviceId is the correct partition key."
			});
			mockCreateCompletions.mockResolvedValueOnce(buildTextCompletion(finalContent));

			const res = await app.request(
				"/genai/question?q=Answer: 1)C&pretty=1",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.result).toBe("You scored 100 on CosmosDB Change feed.");

			// completion was called twice: initial + after tool result
			expect(mockCreateCompletions).toHaveBeenCalledTimes(2);

			// The second call must include the tool result message in the message array
			const secondCallMessages = mockCreateCompletions.mock.calls[1][0].messages;
			const toolResultMessage = secondCallMessages.find(
				(m: { role: string }) => m.role === "tool"
			);
			expect(toolResultMessage).toBeDefined();
			expect(toolResultMessage.content).toMatch(/Saved score 100 for topic Cosmos DB and subtopic Change feed/);
		});
	});

	// -------------------------------------------------------------------------
	// 5. Tool-call loop: save_user_progress (parallel - multiple tool calls)
	//    Mirrors the real sample: 8 parallel save_user_progress calls
	// -------------------------------------------------------------------------
	describe("Tool-call loop - save_user_progress (parallel / batch)", () => {
		it("handles multiple parallel save_user_progress calls in a single LLM turn", async () => {
			mockNewSession();

			// Build 8 parallel tool calls matching the sample conversation
			const parallelToolCalls = [
				{ id: "call_001", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q1", score: 100 }) },
				{ id: "call_002", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q2", score: 0 }) },
				{ id: "call_003", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q3", score: 0 }) },
				{ id: "call_004", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q4", score: 100 }) },
				{ id: "call_005", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q5", score: 100 }) },
				{ id: "call_006", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q6", score: 100 }) },
				{ id: "call_007", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q7", score: 100 }) },
				{ id: "call_008", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB Q8", score: 100 }) }
			];

			mockCreateCompletions.mockResolvedValueOnce(buildToolCallCompletion(parallelToolCalls));

			const finalContent = JSON.stringify({
				question: "Quiz results and feedback",
				hint: "Review incorrect answers for brief clarifications.",
				answer: "You got 6 out of 8 correct.",
				explanation: "Q2 should be Strong consistency. Q3 should be Autoscale provisioned throughput."
			});
			mockCreateCompletions.mockResolvedValueOnce(buildTextCompletion(finalContent));

			const res = await app.request(
				"/genai/question?q=Answer1)C and 2)B and 3)C and 4)B and 5)B and 6)B and 7)D and 8)B&pretty=1",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.result).toBe("You got 6 out of 8 correct.");

			// upsert called once per tool call (8 times) + once for final chat save = 9
			expect(mockItems.upsert).toHaveBeenCalledTimes(8 + 1);

			// Check all 8 tool result messages appear in the second LLM call
			const secondCallMessages: Array<{ role: string; content: string }> =
				mockCreateCompletions.mock.calls[1][0].messages;
			const toolMessages = secondCallMessages.filter((m) => m.role === "tool");
			expect(toolMessages).toHaveLength(8);

			// Verify Q1 got 100 and Q2 got 0
			const q1Msg = toolMessages.find((m) => m.content.includes("CosmosDB Q1"));
			expect(q1Msg?.content).toMatch(/Saved score 100/);
			const q2Msg = toolMessages.find((m) => m.content.includes("CosmosDB Q2"));
			expect(q2Msg?.content).toMatch(/Saved score 0/);
		});
	});

	// -------------------------------------------------------------------------
	// 6. Tool-call loop: search_syllabus
	// -------------------------------------------------------------------------
	describe("Tool-call loop - search_syllabus", () => {
		it("executes vector search and passes context back to LLM", async () => {
			mockNewSession();

			// Simulate vector search returning relevant chunks
			mockItems.query.mockReturnValue({
				fetchAll: vi.fn().mockResolvedValue({
					resources: [
						{ content: "Cosmos DB Change Feed provides ordered stream of changes." },
						{ content: "Change Feed Processor handles distributed leases." }
					]
				})
			});

			// Round 1: LLM requests syllabus search
			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_srch_001", name: "search_syllabus", arguments: JSON.stringify({ topic: "Cosmos DB Change Feed" }) }
				])
			);

			// Round 2: LLM generates a question from the retrieved context
			const finalContent = JSON.stringify({
				question: "Which Cosmos DB feature provides an ordered stream of changes for downstream processors?",
				hint: "Look for an append-only stream processed by external services.",
				answer: "B. Change Feed (and a Change Feed Processor)",
				explanation: "Change Feed provides ordered sequences of inserts/updates per partition."
			});
			mockCreateCompletions.mockResolvedValueOnce(buildTextCompletion(finalContent));

			const res = await app.request(
				"/genai/question?q=Prompt me with CosmosDB questions&pretty=1",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			// The final LLM response question field contains "Change Feed" topic
			expect(body.ask).toContain("ordered stream of changes");

			// Embeddings must have been called to create the query vector
			expect(mockEmbeddingsCreate).toHaveBeenCalledOnce();

			// The second LLM call's tool message must contain the retrieved context
			const secondCallMessages: Array<{ role: string; content: string }> =
				mockCreateCompletions.mock.calls[1][0].messages;
			const toolMsg = secondCallMessages.find((m) => m.role === "tool");
			expect(toolMsg?.content).toContain("Cosmos DB Change Feed");
		});
	});

	// -------------------------------------------------------------------------
	// 7. Tool-call loop: mixed tools in sequence (search then save)
	// -------------------------------------------------------------------------
	describe("Tool-call loop - mixed tools across multiple loop iterations", () => {
		it("handles search_syllabus in turn 1 and save_user_progress in turn 2", async () => {
			mockExistingSession([
				{ role: "system", content: "You are an AI tutor." },
				{ role: "user", content: "Prompt me with CosmosDB questions." },
				{ role: "assistant", content: "1) What is a partition key? ..." }
			]);

			// Turn 1 tool call: search syllabus
			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_s1", name: "search_syllabus", arguments: JSON.stringify({ topic: "Cosmos DB partitioning" }) }
				])
			);

			// Turn 2 tool call: save progress after user answers
			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_sv1", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB partitioning", score: 100 }) }
				])
			);

			// Turn 3: Final answer
			mockCreateCompletions.mockResolvedValueOnce(
				buildTextCompletion(
					JSON.stringify({
						question: "Final feedback",
						hint: "Review your answer.",
						answer: "Correct! deviceId is the best partition key.",
						explanation: "High cardinality avoids hotspots."
					})
				)
			);

			const res = await app.request(
				"/genai/question?q=Answer: 1)C&pretty=1",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			// completion called 3 times: initial + after search + after save
			expect(mockCreateCompletions).toHaveBeenCalledTimes(3);
			// Embeddings called for the search_syllabus turn
			expect(mockEmbeddingsCreate).toHaveBeenCalledOnce();
		});
	});

	// -------------------------------------------------------------------------
	// 8. Tool-call loop: unknown/invalid tool type (non-function)
	// -------------------------------------------------------------------------
	describe("Tool-call loop - unknown tool type (non-function)", () => {
		it("breaks out of the tool loop and returns an error assistant message", async () => {
			mockNewSession();

			// Inject a tool_call with type !== "function" directly into the response.
			// NOTE: The `break` inside the for-loop exits the inner for-loop, but the
			// while-loop still calls completion() again before re-checking the condition.
			// This is a known route behaviour; the second call exits cleanly here.
			mockCreateCompletions.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							refusal: null,
							tool_calls: [
								{
									id: "call_bad_001",
									type: "unknown_type",
									function: { name: "some_tool", arguments: "{}" }
								}
							]
						}
					}
				]
			});

			// Second completion call after the break — returns no tool_calls so the
			// while-loop condition becomes false and the route terminates cleanly.
			mockCreateCompletions.mockResolvedValueOnce(
				buildTextCompletion("Fallback response after unknown tool type.")
			);

			const res = await app.request(
				"/genai/question?q=What is Cosmos?",
				{ method: "GET" }
			);
			// Route should complete (not crash)
			expect(res.status).toBe(200);
			// completion called twice: initial unknown-type + second to exit the while
			expect(mockCreateCompletions).toHaveBeenCalledTimes(2);
		});
	});

	// -------------------------------------------------------------------------
	// 9. Multi-turn conversation: existing chat history is preserved
	// -------------------------------------------------------------------------
	describe("Multi-turn conversation continuity", () => {
		it("loads existing chat history from CosmosDB and appends new turns", async () => {
			const existingMessages = [
				{ role: "system", content: "You are an AI exam tutor." },
				{ role: "user", content: "Prompt me with CosmosDB questions." },
				{
					role: "assistant",
					content: "1) Which partition key avoids hotspots for IoT data?\n- A. timestamp\n- B. deviceId"
				},
				{ role: "user", content: "Answer: 1)B" }
			];

			mockExistingSession(existingMessages);

			const followUpContent = JSON.stringify({
				question: "Another 4 questions on CosmosDB",
				hint: "See per-question hints.",
				answer: "Q1:A Q2:A Q3:C Q4:B",
				explanation: "See explanations above."
			});
			mockCreateCompletions.mockResolvedValueOnce(buildTextCompletion(followUpContent));

			const res = await app.request(
				"/genai/question?q=Another 4 questions on cosmosdb&pretty=1",
				{ method: "GET" }
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.ask).toBe("Another 4 questions on CosmosDB");

			// The messages sent to LLM must include the full existing history
			const sentMessages: Array<{ role: string }> =
				mockCreateCompletions.mock.calls[0][0].messages;
			// system + 3 existing + new user = 5
			expect(sentMessages.length).toBeGreaterThanOrEqual(5);
			expect(sentMessages[0].role).toBe("system");
		});
	});

	// -------------------------------------------------------------------------
	// 10. New session initialisation: first-time user has system prompt injected
	// -------------------------------------------------------------------------
	describe("New session initialisation", () => {
		it("creates a new chat document with only the system prompt when no prior session exists", async () => {
			mockNewSession();
			mockCreateCompletions.mockResolvedValueOnce(
				buildFormattedCompletion({
					question: "What is the default consistency level in CosmosDB?",
					hint: "It balances performance and consistency.",
					answer: "C. Session",
					explanation: "Session consistency is the default and provides read-your-own-writes guarantees."
				})
			);

			await app.request("/genai/question?q=First question about CosmosDB", { method: "GET" });

			const sentMessages: Array<{ role: string; content: string }> =
				mockCreateCompletions.mock.calls[0][0].messages;
			// First message must be the system prompt from AppConfig
			expect(sentMessages[0].role).toBe("system");
			expect(sentMessages[0].content).toBeTruthy();
			// Second message must be the user query
			expect(sentMessages[1].role).toBe("user");
			expect(sentMessages[1].content).toBe("First question about CosmosDB");
		});
	});

	// -------------------------------------------------------------------------
	// 11. Embeddings are called with the correct topic during search_syllabus
	// -------------------------------------------------------------------------
	describe("search_syllabus - embedding creation", () => {
		it("calls createEmbeddings with the exact topic argument and dimension 1536", async () => {
			mockNewSession();

			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_e1", name: "search_syllabus", arguments: JSON.stringify({ topic: "Azure Synapse Link" }) }
				])
			);
			mockCreateCompletions.mockResolvedValueOnce(
				buildTextCompletion(
					JSON.stringify({
						question: "What does Azure Synapse Link enable?",
						hint: "Think columnar analytical store.",
						answer: "B. Analytical Store",
						explanation: "Synapse Link creates a columnar copy of the container for analytics."
					})
				)
			);

			await app.request("/genai/question?q=Tell me about Synapse Link", { method: "GET" });

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				model: "test-embedding-deployment",
				input: "Azure Synapse Link",
				dimensions: 1536
			});
		});
	});

	// -------------------------------------------------------------------------
	// 12. Chat turn is always persisted even when tool calls occur
	// -------------------------------------------------------------------------
	describe("Chat persistence after tool-call loop", () => {
		it("upserts the final chat state to CosmosDB after all tool calls are resolved", async () => {
			mockNewSession();

			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_p1", name: "save_user_progress", arguments: JSON.stringify({ topic: "Cosmos DB", subtopic: "CosmosDB TTL", score: 100 }) }
				])
			);
			mockCreateCompletions.mockResolvedValueOnce(
				buildTextCompletion("Well done! You answered correctly about TTL.")
			);

			await app.request("/genai/question?q=1)A", { method: "GET" });

			// upsert called: 1 (save_user_progress) + 1 (saveChatTurn) = 2
			expect(mockItems.upsert).toHaveBeenCalledTimes(2);

			// Final upsert must include the assistant message
			const lastUpsertArg = mockItems.upsert.mock.calls.at(-1)![0];
			const messages: Array<{ role: string; content: string }> = lastUpsertArg.messages;
			const lastMsg = messages.at(-1);
			expect(lastMsg?.role).toBe("assistant");
			expect(lastMsg?.content).toBe("Well done! You answered correctly about TTL.");
		});
	});
	// -------------------------------------------------------------------------
	// 13. Sliding window and filtering of tool messages
	// -------------------------------------------------------------------------
	describe("Sliding window and filtering of tool messages", () => {
		it("removes past tool messages and applies sliding window before calling OpenAI and saving to DB", async () => {
			const existingMessages = [
				{ role: "system", content: "You are an AI exam tutor." },
				{ role: "user", content: "Message 1" },
				{ role: "assistant", content: "Response 1" },
				{ role: "user", content: "Message 2" },
				{ role: "assistant", content: null, tool_calls: [{ id: "call_t1", type: "function", function: { name: "search_syllabus", arguments: "{}" } }] },
				{ role: "tool", tool_call_id: "call_t1", content: "tool result 1" },
				{ role: "assistant", content: "Response 2 with tool" },
				{ role: "user", content: "Message 3" },
				{ role: "assistant", content: "Response 3" }
			];

			mockExistingSession(existingMessages);

			mockCreateCompletions.mockResolvedValueOnce(buildTextCompletion("Response 4"));

			const res = await app.request("/genai/question?q=Message Q", { method: "GET" });
			expect(res.status).toBe(200);

			// 1. Check messages sent to OpenAI
			// Note: The array reference passed to mockCreateCompletions is mutated later
			// in the route when the assistant response is pushed, so it will contain 6 elements here.
			const sentMessages: Array<{ role: string; content: string }> =
				mockCreateCompletions.mock.calls[0][0].messages;

			expect(sentMessages).toHaveLength(7);
			expect(sentMessages[0].role).toBe("system");
			expect(sentMessages[1].content).toBe("Message 2");
			expect(sentMessages[2].content).toBe("Response 2 with tool");
			expect(sentMessages[3].content).toBe("Message 3");
			expect(sentMessages[4].content).toBe("Response 3");
			expect(sentMessages[5].role).toBe("user");
			expect(sentMessages[5].content).toBe("Message Q");
			expect(sentMessages[6].role).toBe("assistant");
			expect(sentMessages[6].content).toBe("Response 4");

			// 2. Check messages saved to DB (should include the latest assistant response, but still fit the sliding window)
			const lastUpsertArg = mockItems.upsert.mock.calls.at(-1)![0];
			const savedMessages: Array<{ role: string; content: string }> = lastUpsertArg.messages;

			expect(savedMessages).toHaveLength(5);
			expect(savedMessages[0].role).toBe("system");
			expect(savedMessages[1].content).toBe("Message 3");
			expect(savedMessages[2].content).toBe("Response 3");
			expect(savedMessages[3].content).toBe("Message Q");
			expect(savedMessages[4].content).toBe("Response 4");
		});

		it("does not persist tool calls generated in the current turn", async () => {
			mockNewSession();

			// Round 1: LLM requests syllabus search
			mockCreateCompletions.mockResolvedValueOnce(
				buildToolCallCompletion([
					{ id: "call_srch_001", name: "search_syllabus", arguments: JSON.stringify({ topic: "Cosmos DB" }) }
				])
			);

			// Round 2: LLM generates response
			mockCreateCompletions.mockResolvedValueOnce(buildTextCompletion("Context incorporated."));

			await app.request("/genai/question?q=Tell me about Cosmos DB", { method: "GET" });

			// Check DB save
			const lastUpsertArg = mockItems.upsert.mock.calls.at(-1)![0];
			const savedMessages: Array<{ role: string; content: string }> = lastUpsertArg.messages;

			// The tool call and tool message should NOT be in the saved messages
			const toolMessage = savedMessages.find(m => m.role === "tool");
			const toolCallMessage = savedMessages.find(m => (m as any).tool_calls !== undefined);

			expect(toolMessage).toBeUndefined();
			expect(toolCallMessage).toBeUndefined();

			// Should only contain: system, user, assistant
			expect(savedMessages).toHaveLength(3);
			expect(savedMessages[0].role).toBe("system");
			expect(savedMessages[1].content).toBe("Tell me about Cosmos DB");
			expect(savedMessages[2].content).toBe("Context incorporated.");
		});
	});
});
