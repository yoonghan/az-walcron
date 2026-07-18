import { beforeEach, describe, expect, it, vi } from "vitest";

import { openAiSpec } from "./openai";

describe("OpenApiSpec", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("getSpec", () => {
        it("should return open api spec", () => {
            const res = openAiSpec.getSpec();
            expect(res).toEqual({ "openai": "3.1.0", "info": { "title": "Walcron AI API", "version": "1.0.0" }, "paths": {} });
        });
    });
});