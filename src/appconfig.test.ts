import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    process.env.AZURE_APPCONFIG_ENDPOINT = "test-connectionstring";
});

vi.mock("@azure/app-configuration", () => {
    return {
        AppConfigurationClient: class {
            constructor() {
            }
            getConfigurationSetting = vi.fn().mockImplementation(async ({ key }: { key: string }) => {
                let value = "";
                switch (key) {
                    case "openai-model":
                        value = "test-model";
                        break;
                    case "openai-version":
                        value = "test-version";
                        break;
                }
                return {
                    value
                }
            });
        }
    }
});

import { AppConfig } from "./appconfig";

describe("AppConfig", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Initialization", () => {
        it("should initialize successfully", () => {
            const config = new AppConfig();
            expect(config).toBeDefined();
        });
    });

    describe("getOpenAISetting", () => {
        it("should return open ai", async () => {
            const res = await new AppConfig().getOpenAISetting();
            expect(res).toEqual({
                deployment: "test-model",
                apiVersion: "test-version"
            });
        });
    });
});