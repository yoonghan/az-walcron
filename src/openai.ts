import { AzureOpenAI } from "openai";
import pino from "pino";


export class OpenAiSpec {
    private client: AzureOpenAI;

    private logger = pino({
        level: process.env.LOG_LEVEL || "info",
        formatters: {
            level: (label) => {
                return { level: label };
            },
        },
    });

    constructor() {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_API_KEY;
        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

        if (!endpoint || !apiKey || !deployment || !apiVersion) {
            throw new Error("Missing Azure OpenAI configuration");
        }

        this.logger.info(`Initializing Azure OpenAI: endpoint ${endpoint}, deployment ${deployment}, apiVersion(not used) ${apiVersion}`);
        this.client = new AzureOpenAI({
            endpoint,
            apiKey,
            deployment
        });

        this.logger.info(`Successfully connected to Azure OpenAI`);
    }

    async getSpec() {
        const response = await this.client.models.list();
        return {
            "openai": "3.1.0",
            "info": {
                "title": "Walcron AI API",
                "version": "1.0.0"
            },
            "models": response.data
        }
    }
}

export const openAiSpec = new OpenAiSpec();
