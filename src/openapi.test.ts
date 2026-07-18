import { beforeEach, describe, expect, it, vi } from "vitest";

import { openApiSpec } from "./openapi";

describe("OpenApiSpec", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("getSpec", () => {
        it("should return open api spec", () => {
            const res = openApiSpec.getSpec();
            expect(res).toEqual({ "openapi": "3.1.0", "info": { "title": "WalCron API", "version": "1.0.0" }, "paths": {} });
        });
    });
});