import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    process.env.AZURE_OPENAI_ENDPOINT = "test-endpoint";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
    process.env.AZURE_OPENAI_API_VERSION = "test-api-version";
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
                    create: vi.fn().mockResolvedValue([{
                        choices: [{ delta: { content: "test" } }]
                    }])
                }
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
            const stream = await spec.completion("sys-prompt", "msg-prompt", 0.5, "true") as any[];
            expect(stream).toBeDefined();
            expect(stream[0].choices[0].delta.content).toEqual("test");
        });
    });
});