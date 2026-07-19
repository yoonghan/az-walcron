import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    process.env.AZURE_OPENAI_ENDPOINT = "test-endpoint";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
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
        it("should return open api spec", () => {
            const res = new OpenAiSpec().getSpec();
            expect(res).toEqual({ "openai": "3.1.0", "info": { "title": "Walcron AI API", "version": "1.0.0" }, "paths": {} });
        });
    });
});