import { AppConfigurationClient, GetConfigurationSettingResponse } from "@azure/app-configuration";
import { DefaultAzureCredential } from "@azure/identity";

export class AppConfig {
    private client: AppConfigurationClient;
    private systemPromptSetting: GetConfigurationSettingResponse;
    private userPromptSetting: GetConfigurationSettingResponse;
    private temperatureSetting: GetConfigurationSettingResponse;
    private isQuestionFormattedSetting: GetConfigurationSettingResponse;
    private domainSettings: GetConfigurationSettingResponse;


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

    private async initialize() {
        this.systemPromptSetting = await this.client.getConfigurationSetting({ key: "openai:systemPrompt" });
        this.userPromptSetting = await this.client.getConfigurationSetting({ key: "openai:userPrompt" });
        this.temperatureSetting = await this.client.getConfigurationSetting({ key: "openai:temperature" });
        this.isQuestionFormattedSetting = await this.client.getConfigurationSetting({ key: "openai:isQuestionFormatted" });
        this.domainSettings = await this.client.getConfigurationSetting({ key: "openai:domain" });
    }

    async getOpenAISetting() {
        if (!this.systemPromptSetting || !this.userPromptSetting || !this.temperatureSetting || !this.isQuestionFormattedSetting || !this.domainSettings) {
            await this.initialize();
        }

        return {
            systemPrompt: this.systemPromptSetting.value || "",
            userPrompt: this.userPromptSetting.value || "",
            temperature: this.temperatureSetting.value || "",
            isQuestionFormatted: this.isQuestionFormattedSetting.value || "false",
            domain: this.domainSettings.value || ""
        };
    }
}

export const appConfig = new AppConfig();