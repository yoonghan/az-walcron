import { AzureOpenAI } from "openai";

export class OpenAiSpec {
    private client: AzureOpenAI;

    constructor() {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_API_KEY;
        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini";
        const apiVersion = "2024-02-15-preview";

        if (!endpoint || !apiKey || !deployment) {
            throw new Error("Missing Azure OpenAI configuration");
        }

        this.client = new AzureOpenAI({
            endpoint,
            apiKey,
            apiVersion,
            deployment
        });
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
