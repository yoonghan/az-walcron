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
                    topic: { type: "string", description: "The topic that was tested." },
                    score: { type: "number", description: "100 if correct, 0 if incorrect." }
                },
                required: ["topic", "score"]
            }
        }
    }
];