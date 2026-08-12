import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoad } = vi.hoisted(() => {
    const mockLoad = vi.fn().mockImplementation(async () => {
        return {
            get: (key: string) => {
                switch (key) {
                    case "openai:systemPrompt":
                        return "openai-systemPrompt";
                    case "openai:userPrompt":
                        return "openai-userPrompt";
                    case "openai:temperature":
                        return "openai-temperature";
                    case "openai:isQuestionFormatted":
                        return "true";
                    case "openai:domain":
                        return "openai-domain";
                    default:
                        return "";
                }
            },
            refresh: vi.fn()
        };
    });

    return { mockLoad };
});

vi.mock("@azure/app-configuration-provider", () => {
    return {
        load: mockLoad
    };
});

import { AppConfig } from "./appconfig";

describe("AppConfig", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AZURE_APPCONFIG_ENDPOINT = "test-connectionstring";
    });

    describe("Initialization", () => {
        it("should fail to initialize when endpoint is missing", async () => {
            delete process.env.AZURE_APPCONFIG_ENDPOINT;
            await expect(new AppConfig().getOpenAISetting()).rejects.toThrow("Missing Azure App Configuration connection string or endpoint");
        });
    });

    describe("getOpenAISetting", () => {
        it("should return open ai", async () => {
            const res = await new AppConfig().getOpenAISetting();
            expect(res).toEqual({
                systemPrompt: "openai-systemPrompt",
                userPrompt: "openai-userPrompt",
                temperature: "openai-temperature",
                isQuestionFormatted: "true",
                domain: "openai-domain"
            });
        });

        it("triggering multiple times will only be called once", async () => {
            const appConfig = new AppConfig();
            for (let cnt = 0; cnt < 2; cnt++) {
                await appConfig.getOpenAISetting();
            }

            expect(mockLoad).toHaveBeenCalledTimes(1);
        });

        it("it should be not be able to refresh when calling refresh the first time", async () => {
            const appConfig = new AppConfig();
            expect(await appConfig.refresh()).toBeFalsy();
        });

        it("it should be able to refresh when calling refresh the second time", async () => {
            const appConfig = new AppConfig();
            await appConfig.getOpenAISetting()
            expect(await appConfig.refresh()).toBeTruthy();
        });
    });
});