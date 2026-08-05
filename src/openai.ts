import { AzureOpenAI } from "openai";
import { ChatCompletionMessageParam, ChatCompletionTool, ResponseFormatJSONSchema } from "openai/resources";
import pino from "pino";


export class OpenAiSpec {
    private client: AzureOpenAI;
    private deployment: string;
    private embeddingDeployment: string;

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
        const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

        if (!endpoint || !apiKey || !deployment || !embeddingDeployment || !apiVersion) {
            throw new Error(`Missing Azure OpenAI configuration, ${!!endpoint}, ${!!apiKey}, ${!!deployment}, ${!!embeddingDeployment}, ${!!apiVersion}`);
        }

        this.deployment = deployment;
        this.embeddingDeployment = embeddingDeployment;

        this.logger.info(`Initializing Azure OpenAI: endpoint ${endpoint}, deployment ${this.deployment}, embeddedDeployment ${this.embeddingDeployment}, apiVersion ${apiVersion}`);
        this.client = new AzureOpenAI({
            endpoint,
            apiKey,
            apiVersion
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
            "deployment": this.deployment,
            "models": response.data
        }
    }

    async createEmbeddings(input: string | string[], dimensions: number) {
        const embeddingResponse = await this.client.embeddings.create({
            model: this.embeddingDeployment,
            input,
            dimensions
        })
        return embeddingResponse;
    }

    formatChatHistory(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
        const filtered = messages.filter((m: any) => {
            // Filter out 'tool' role messages
            if (m.role === "tool") return false;
            // Filter out 'assistant' role messages that contain tool_calls
            if (m.role === "assistant" && m.tool_calls) return false;
            // Filter out 'assistant' role messages that have no content
            if (m.role === "assistant" && !m.content) return false;
            return true;
        });
        
        if (filtered.length > 5) {
            return [filtered[0], ...filtered.slice(-4)];
        }
        return filtered;
    }

    async completion(messages: ChatCompletionMessageParam[], temperature: number, responseFormat?: string, tools?: ChatCompletionTool[]) {
        const formatted: { response_format: ResponseFormatJSONSchema } | {} = responseFormat === "true" ? {
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "exam_prep_content",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            question: {
                                type: "string",
                                description: "The multiple-choice or scenario-based exam question."
                            },
                            hint: {
                                type: "string",
                                description: "A brief, one-sentence hint that doesn't give away the direct answer."
                            },
                            answer: {
                                type: "string",
                                description: "The correct answer to the question."
                            },
                            explanation: {
                                type: "string",
                                description: "A brief explanation of why the answer is correct."
                            }
                        },
                        required: ["question", "hint", "answer", "explanation"],
                        additionalProperties: false
                    }
                }
            }
        } : {}

        const formattedTools: ({ tools: ChatCompletionTool[], tool_choice: "auto" } | {}) = tools ? { tools: tools, tool_choice: "auto" } : {}

        return await this.client.chat.completions.create({
            model: this.deployment,
            temperature: temperature,
            messages,
            ...formatted,
            ...formattedTools
        });
    }
}

export const openAiSpec = new OpenAiSpec();
