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
        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini";
        const apiVersion = "2024-02-15-preview";

        if (!endpoint || !apiKey || !deployment) {
            throw new Error("Missing Azure OpenAI configuration");
        }

        this.logger.info(`Initializing Azure OpenAI: endpoint ${endpoint}, deployment ${deployment}, apiVersion ${apiVersion}`);
        this.client = new AzureOpenAI({
            endpoint,
            apiKey,
            apiVersion,
            deployment
        });

        this.logger.info(`Successfully connected to Azure OpenAI`);
    }

    getSpec() {
        return {
            "openai": "3.1.0",
            "info": {
                "title": "Walcron AI API",
                "version": "1.0.0"
            },
            "paths": {}
        }
    }
}

export const openAiSpec = new OpenAiSpec();
