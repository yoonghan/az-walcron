import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateCompletions } = vi.hoisted(() => {
    process.env.AZURE_OPENAI_ENDPOINT = "test-endpoint";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "embedded-deployment";
    process.env.AZURE_OPENAI_API_VERSION = "test-api-version";

    const mockCreateCompletions = vi.fn().mockResolvedValue([{
        choices: [{ delta: { content: "test" } }]
    }])

    return { mockCreateCompletions }
});

vi.mock("openai", () => {
    return {
        AzureOpenAI: class {
            models = {
                list: vi.fn().mockResolvedValue({
                    data: [{ id: "test-model" }]
                })
            }
            chat = {
                completions: {
                    create: mockCreateCompletions
                }
            }
            embeddings = {
                create: vi.fn().mockResolvedValue({
                    data: [{
                        embedding: []
                    }]
                })
            }
        }
    }
});

import { OpenAiSpec } from "./openai";

describe("OpenApiSpec", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Initialization", () => {
        it("should initialize successfully", () => {
            const spec = new OpenAiSpec();
            expect(spec).toBeDefined();
        });
    });

    describe("getSpec", () => {
        it("should return open api spec", async () => {
            const res = await new OpenAiSpec().getSpec();
            expect(res).toEqual({ "openai": "3.1.0", "info": { "title": "Walcron AI API", "version": "1.0.0" }, "deployment": "test-deployment", "models": [{ id: "test-model" }] });
        });
    });

    describe("completion", () => {
        it("should call chat completions create", async () => {
            const spec = new OpenAiSpec();
            const stream = await spec.completion([
                { role: "user", content: "message" }
            ], 0.5, "true") as unknown as any[];
            expect(stream).toBeDefined();
            expect(stream[0].choices[0].delta.content).toEqual("test");
        });

        it("should call can trigger with formatted json", async () => {
            const spec = new OpenAiSpec();
            const stream = await spec.completion([
                { role: "user", content: "message" }
            ], 0.5, "true") as unknown as any[];
            expect(stream).toBeDefined();
            expect(stream[0].choices[0].delta.content).toEqual("test");
            expect(mockCreateCompletions).toHaveBeenCalledWith({
                "messages": [
                    {
                        "content": "message",
                        "role": "user",
                    },
                ],
                "model": "test-deployment",
                "temperature": 0.5,

                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "exam_prep_content",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                question: {
                                    type: "string",
                                    description: "The multiple-choice or scenario-based exam question."
                                },
                                hint: {
                                    type: "string",
                                    description: "A brief, one-sentence hint that doesn't give away the direct answer."
                                },
                                answer: {
                                    type: "string",
                                    description: "The correct answer to the question."
                                },
                                explanation: {
                                    type: "string",
                                    description: "A brief explanation of why the answer is correct."
                                }
                            },
                            required: ["question", "hint", "answer", "explanation"],
                            additionalProperties: false
                        }
                    }
                }
            },);
        });

        it("should call can trigger with tools", async () => {
            const tool = [
                {
                    type: "function",
                    function: {
                        name: "search_syllabus",
                        description: "Call this to search the AI-200 exam syllabus when the user wants to learn a topic or needs a quiz generated.",
                        parameters: {
                            type: "object",
                            properties: {
                                topic: { type: "string", description: "The technical topic to search for." }
                            },
                            required: ["topic"]
                        }
                    }
                }
            ]
            const spec = new OpenAiSpec();
            const stream = await spec.completion([
                { role: "user", content: "message" }
            ], 0.5, undefined, tool) as unknown as any[];
            expect(stream).toBeDefined();
            expect(stream[0].choices[0].delta.content).toEqual("test");
            expect(mockCreateCompletions).toHaveBeenCalledWith({
                "messages": [
                    {
                        "content": "message",
                        "role": "user",
                    },
                ],
                "model": "test-deployment",
                "temperature": 0.5,
                "tool_choice": "auto",
                "tools": tool,
            },);
        });
    });

    describe("createEmbeddings", () => {
        it("should call embeddings create", async () => {
            const spec = new OpenAiSpec();
            const embeddings = await spec.createEmbeddings("test", 1536);
            expect(embeddings).toBeDefined();
        });
    });

    describe("formatChatHistory", () => {
        it("should return the original array if less than or equal to 5 elements without tool roles", () => {
            const spec = new OpenAiSpec();
            const messages = [
                { role: "system", content: "system" },
                { role: "user", content: "user 1" },
                { role: "assistant", content: "assistant 1" }
            ];
            const result = spec.formatChatHistory(messages as any);
            expect(result).toEqual(messages);
        });

        it("should handle only 1 message without out of index error", () => {
            const spec = new OpenAiSpec();
            const messages = [
                { role: "system", content: "system" }
            ];
            const result = spec.formatChatHistory(messages as any);
            expect(result).toEqual(messages);
        });

        it("should remove tools and tool_calls and retain max 4 messages plus system", () => {
            const spec = new OpenAiSpec();
            const messages = [
                { role: "system", content: "system" },
                { role: "user", content: "user 1" },
                { role: "assistant", content: "assistant 1" },
                { role: "user", content: "user 2" },
                { role: "assistant", tool_calls: [{}] },
                { role: "tool", content: "tool result" },
                { role: "assistant", content: "assistant 2" },
                { role: "user", content: "user 3" },
                { role: "assistant", content: "assistant 3" }
            ];
            const result = spec.formatChatHistory(messages as any);
            expect(result).toEqual([
                { role: "system", content: "system" },
                { role: "user", content: "user 2" },
                { role: "assistant", content: "assistant 2" },
                { role: "user", content: "user 3" },
                { role: "assistant", content: "assistant 3" }
            ]);
        });
        it("should explicitly remove assistant messages with tool_calls and null content", () => {
            const spec = new OpenAiSpec();
            const messages = [
                { role: "system", content: "system" },
                { role: "user", content: "user 1" },
                {
                    "annotations": [],
                    "content": null,
                    "refusal": null,
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "function": {
                                "arguments": "{\"topic\":\"CosmosDB Q1-4 (second set)\",\"score\":75}",
                                "name": "save_user_progress"
                            },
                            "id": "call_0VJClpH2gLFW1FavayLECzqg",
                            "type": "function"
                        }
                    ]
                },
                { role: "assistant", content: null }, // Null content without tool calls
                { role: "user", content: "user 2" },
                { role: "assistant", content: "assistant 2" }
            ];
            
            const result = spec.formatChatHistory(messages as any);
            
            expect(result).toEqual([
                { role: "system", content: "system" },
                { role: "user", content: "user 1" },
                { role: "user", content: "user 2" },
                { role: "assistant", content: "assistant 2" }
            ]);
        });
    });
});