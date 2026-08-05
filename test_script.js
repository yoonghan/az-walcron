const messages = [
    { role: "system", content: "You are an AI exam tutor." },
    { role: "user", content: "Message 1" },
    { role: "assistant", content: "Response 1" },
    { role: "user", content: "Message 2" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_t1", type: "function", function: { name: "search_syllabus", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_t1", content: "tool result 1" },
    { role: "assistant", content: "Response 2 with tool" },
    { role: "user", content: "Message 3" },
    { role: "assistant", content: "Response 3" },
    { role: "user", content: "Message 4" }
];

const filtered = messages.filter((m) => m.role !== "tool" && !m.tool_calls);
let res = filtered;
if (filtered.length > 5) {
    res = [filtered[0], ...filtered.slice(-4)];
}
console.log("res length:", res.length);
console.log(res);
