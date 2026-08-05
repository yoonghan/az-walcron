import { ChatCompletionTool } from "openai/resources";

export const tutorTools: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "search_syllabus",
            description: "Call this to search the AI-200 exam syllabus when the user wants to learn a topic or needs a quiz generated.",
            parameters: {
                type: "object",
                properties: {
                    topic: { type: "string", description: "The technical topic to search for." }
                },
                required: ["topic"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "save_user_progress",
            description: "Call this AFTER the user answers a quiz question to record their score.",
            parameters: {
                type: "object",
                properties: {
                    topic: { 
                        type: "string", 
                        description: "The topic that was tested.",
                        enum: ["Containers", "Cosmos DB", "OpenAI SDK", "PostgreSQL", "Redis", "Events", "Azure Functions", "Security", "Monitor", "Blob Storage"]
                    },
                    subtopic: {
                        type: "string",
                        description: "The specific technical feature being tested (e.g., 'Change Feed', 'RBAC', 'KEDA')."
                    },
                    score: { type: "number", description: "100 if correct, 0 if incorrect." }
                },
                required: ["topic", "subtopic", "score"]
            }
        }
    }
];