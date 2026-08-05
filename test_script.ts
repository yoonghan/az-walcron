import { describe, expect, it, vi } from "vitest";

const existingMessages = [
    { role: "system", content: "You are an AI exam tutor." },
    { role: "user", content: "Message 1" },
    { role: "assistant", content: "Response 1" },
    { role: "user", content: "Message 2" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_t1", type: "function", function: { name: "search_syllabus", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_t1", content: "tool result 1" },
    { role: "assistant", content: "Response 2 with tool" },
    { role: "user", content: "Message 3" },
    { role: "assistant", content: "Response 3" }
];

console.log(existingMessages.length);
