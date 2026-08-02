import { AppConfigurationClient } from "@azure/app-configuration";
import { DefaultAzureCredential } from "@azure/identity";

export class AppConfig {
    private client: AppConfigurationClient;

    constructor() {
        const connectionString = process.env.AZURE_APPCONFIG_ENDPOINT;
        if (!connectionString) {
            throw new Error("Missing Azure App Configuration connection string");
        }

        this.client = new AppConfigurationClient(
            connectionString,
            new DefaultAzureCredential()
        );
    }

    async getOpenAISetting() {
        const systemPromptSetting = await this.client.getConfigurationSetting({ key: "openai:systemPrompt" });
        const userPromptSetting = await this.client.getConfigurationSetting({ key: "openai:userPrompt" });
        const temperatureSetting = await this.client.getConfigurationSetting({ key: "openai:temperature" });
        const isQuestionFormattedSetting = await this.client.getConfigurationSetting({ key: "openai:isQuestionFormatted" });
        const domainSettings = await this.client.getConfigurationSetting({ key: "openai:domain" });

        return {
            systemPrompt: systemPromptSetting.value || "",
            userPrompt: userPromptSetting.value || "",
            temperature: temperatureSetting.value || "",
            isQuestionFormatted: isQuestionFormattedSetting.value || "false",
            domain: domainSettings.value || ""
        };
    }
}

export const appConfig = new AppConfig();