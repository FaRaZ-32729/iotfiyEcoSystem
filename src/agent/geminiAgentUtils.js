/**
 * Convert OpenAI Chat Completions tool defs → Gemini functionDeclarations.
 */
function toGeminiFunctionDeclarations(agentTools = []) {
    return agentTools.map((t) => {
        const fn = t.function || t;
        return {
            name: fn.name,
            description: fn.description || "",
            parameters: fn.parameters || { type: "object", properties: {} },
        };
    });
}
/**
 * App history [{role,text}] → Gemini contents (user/model).
 */
function toGeminiHistory(history = []) {
    const out = [];
    for (const h of Array.isArray(history) ? history.slice(-12) : []) {
        const text = String(h.text || "").trim();
        if (!text) continue;
        if (h.role === "assistant" || h.role === "bot") {
            if (/service is unavailable/i.test(text)) continue;
            out.push({ role: "model", parts: [{ text }] });
        } else if (h.role === "user") {
            out.push({ role: "user", parts: [{ text }] });
        }
    }
    while (out.length && out[0].role !== "user") out.shift();
    return out;
}
function extractFunctionCalls(response) {
    if (response?.functionCalls?.length) return response.functionCalls;
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts
        .filter((p) => p.functionCall)
        .map((p) => ({
            name: p.functionCall.name,
            args: p.functionCall.args,
            id: p.functionCall.id,
        }));
}
module.exports = {
    toGeminiFunctionDeclarations,
    toGeminiHistory,
    extractFunctionCalls,
};