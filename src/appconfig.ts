import { AppConfigurationClient } from "@azure/app-configuration";
import { DefaultAzureCredential } from "@azure/identity";

export class AppConfig {
    private client: AppConfigurationClient;

    constructor() {
        const connectionString = process.env.APPCONFIG_CONNECTIONSTRING;
        if (!connectionString) {
            throw new Error("Missing Azure App Configuration connection string");
        }

        this.client = new AppConfigurationClient(
            connectionString,
            new DefaultAzureCredential()
        );
    }

    async getOpenAISetting() {
        const modelSetting = await this.client.getConfigurationSetting({ key: "openai-model" });
        const apiversionSetting = await this.client.getConfigurationSetting({ key: "openai-version" });

        return {
            deployment: modelSetting.value,
            apiVersion: apiversionSetting.value,
        };
    }
}

export const appConfig = new AppConfig();