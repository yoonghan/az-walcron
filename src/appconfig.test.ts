import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedConfiguration } = vi.hoisted(() => {
    process.env.AZURE_APPCONFIG_ENDPOINT = "test-connectionstring";

    const mockedConfiguration = vi.fn().mockImplementation(async ({ key }: { key: string }) => {
        let value = "";
        switch (key) {
            case "openai:systemPrompt":
                value = "openai-systemPrompt";
                break;
            case "openai:userPrompt":
                value = "openai-userPrompt";
                break;
            case "openai:temperature":
                value = "openai-temperature";
                break;
            case "openai:isQuestionFormatted":
                value = "true";
                break;
            case "openai:domain":
                value = "openai-domain";
                break;
        }
        return {
            value
        }
    });

    return { mockedConfiguration }
});

vi.mock("@azure/app-configuration", () => {
    return {
        AppConfigurationClient: class {
            constructor() {
            }
            getConfigurationSetting = mockedConfiguration;
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

            expect(mockedConfiguration).toHaveBeenCalledTimes(5);
        });
    });
});