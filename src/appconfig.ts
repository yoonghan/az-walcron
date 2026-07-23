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
        const messagePromptSetting = await this.client.getConfigurationSetting({ key: "openai:messagePrompt" });
        const userPromptSetting = await this.client.getConfigurationSetting({ key: "openai:userPrompt" });
        const temperatureSetting = await this.client.getConfigurationSetting({ key: "openai:temperature" });
        const isQuestionFormattedSetting = await this.client.getConfigurationSetting({ key: "openai:isQuestionFormatted" });

        return {
            messagePrompt: messagePromptSetting.value || "",
            userPrompt: userPromptSetting.value || "",
            temperature: temperatureSetting.value || "",
            isQuestionFormatted: isQuestionFormattedSetting.value || "false",
        };
    }
}

export const appConfig = new AppConfig();