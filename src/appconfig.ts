import { load, AzureAppConfiguration } from "@azure/app-configuration-provider";
import { DefaultAzureCredential } from "@azure/identity";

export class AppConfig {
    private settings?: AzureAppConfiguration;

    constructor() { }

    private async initialize() {
        const endpoint = process.env.AZURE_APPCONFIG_ENDPOINT;
        if (!endpoint) {
            throw new Error("Missing Azure App Configuration connection string or endpoint");
        }

        this.settings = await load(endpoint, new DefaultAzureCredential(), {
            selectors: [
                { keyFilter: "openai*", labelFilter: undefined }
            ],
            refreshOptions: {
                enabled: true,
                watchedSettings: [{ key: "Sentinel" }]
            }
        });
    }

    async refresh() {
        if (this.settings) {
            await this.settings.refresh();
            return true;
        }
        return false;
    }

    async getOpenAISetting() {
        if (!this.settings) {
            await this.initialize();
        }

        return {
            systemPrompt: this.settings?.get<string>("openai:systemPrompt") || "",
            userPrompt: this.settings?.get<string>("openai:userPrompt") || "",
            temperature: this.settings?.get<string>("openai:temperature") || "",
            isQuestionFormatted: this.settings?.get<string>("openai:isQuestionFormatted") || "false",
            domain: this.settings?.get<string>("openai:domain") || ""
        };
    }
}

export const appConfig = new AppConfig();
