const RagChunk = require("../models/ragChunkModel");
const {
    getOpenAIClient,
    getChatModelName,
    getEmbedModelName,
} = require("./openaiClient");
const {
    getGeminiClient,
    getGeminiChatModelName,
    getGeminiEmbedModelName,
    useGeminiForText,
} = require("./geminiClient");

const SYSTEM_PROMPT = `You are the friendly ecoSystem Support assistant for the IOTFIY ecoSystem IoT app.

Personality:
- Warm, helpful, and natural — like a good customer-support chat.
- Greetings and small talk (hi, hello, how are you, thanks, bye) → reply politely and briefly, then invite product questions. Do NOT say "I do not know" for greetings.
- Match the user's language (English, Urdu, or Roman Urdu).

Product answers:
- For questions about the app (devices, alerts, AC, schedules, roles, how-to), use the CONTEXT below.
- Prefer clear, useful answers. You may paraphrase the context; do not invent features, device types, alert names, or UI labels that are not in the context.
- If CONTEXT is empty or clearly irrelevant to a product question, say you are not sure and suggest topics: devices, alerts, AC controls, schedules, or roles.
- Never reveal API keys, MQTT internals, secrets, or server credentials.

Structure (very important — answers must look clean, not like one rough paragraph):
- Always use short intro line, then structured lists when there are 2+ items.
- Device types, alert types, modes, fan speeds, roles, categories → use bullet list with "- " and bold names, e.g. - **Odour Device (OD)**: ...
- Steps / how-to (add device, create schedule, lock AC) → use numbered list: 1. 2. 3.
- Use ## small headings to group sections when the answer has multiple parts.
- Keep each bullet to 1–2 short lines. Avoid long walls of text.
- Do NOT use markdown tables.`;

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        return -1;
    }
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return -1;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedTextOpenAI(text) {
    const openai = getOpenAIClient();
    const result = await openai.embeddings.create({
        model: getEmbedModelName(),
        input: String(text || "").slice(0, 8000),
    });
    const values = result?.data?.[0]?.embedding;
    if (!values?.length) {
        throw new Error("Empty embedding from OpenAI");
    }
    return values;
}

async function embedTextGemini(text) {
    const ai = getGeminiClient();
    const result = await ai.models.embedContent({
        model: getGeminiEmbedModelName(),
        contents: String(text || "").slice(0, 8000),
    });
    const values =
        result?.embeddings?.[0]?.values ||
        result?.embedding?.values ||
        null;
    if (!values?.length) {
        throw new Error("Empty embedding from Gemini");
    }
    return values;
}

async function embedText(text) {
    if (useGeminiForText()) {
        return embedTextGemini(text);
    }
    return embedTextOpenAI(text);
}

async function embedDocument(text) {
    return embedText(text);
}

async function retrieve(query, k = 5) {
    const queryEmbedding = await embedText(query);
    const chunks = await RagChunk.find({}).select("source title content embedding").lean();
    if (!chunks.length) {
        return [];
    }

    const scored = chunks
        .map((c) => ({
            source: c.source,
            title: c.title,
            content: c.content,
            score: cosineSimilarity(queryEmbedding, c.embedding),
        }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

    return scored;
}

function buildContext(chunks) {
    if (!chunks.length) {
        return "(No knowledge chunks retrieved. Knowledge base may be empty — run ingest.)";
    }
    return chunks
        .map(
            (c, i) =>
                `[#${i + 1} ${c.title} | ${c.source} | score=${c.score.toFixed(3)}]\n${c.content}`
        )
        .join("\n\n---\n\n");
}

function buildPrompt(q, context, history = []) {
    const historyLines = (Array.isArray(history) ? history : [])
        .slice(-6)
        .map((h) => {
            const role = h.role === "user" ? "User" : "Assistant";
            return `${role}: ${String(h.text || "").slice(0, 500)}`;
        })
        .join("\n");

    return `${SYSTEM_PROMPT}

Formatting:
- Use Markdown only: **bold**, ## headings, "- " bullets, and "1. 2. 3." numbered steps.
- Prefer lists over paragraphs whenever listing devices, alerts, options, or steps.
- Do NOT use markdown tables (| ... |).
- Keep answers scannable.

CONTEXT:
${context}

${historyLines ? `RECENT CHAT:\n${historyLines}\n` : ""}
User: ${q}
Assistant:`;
}

function mapSources(chunks) {
    return chunks.map((c) => ({
        source: c.source,
        title: c.title,
        score: Number(c.score.toFixed(4)),
    }));
}

async function chat({ message, history = [] }) {
    const q = String(message || "").trim();
    if (!q) {
        const err = new Error("message is required");
        err.statusCode = 400;
        throw err;
    }

    const chunks = await retrieve(q, 5);
    const prompt = buildPrompt(q, buildContext(chunks), history);

    let answer;
    if (useGeminiForText()) {
        const ai = getGeminiClient();
        const result = await ai.models.generateContent({
            model: getGeminiChatModelName(),
            contents: prompt,
            config: { temperature: 0.4 },
        });
        answer = result?.text;
    } else {
        const openai = getOpenAIClient();
        const result = await openai.chat.completions.create({
            model: getChatModelName(),
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4,
        });
        answer = result?.choices?.[0]?.message?.content;
    }

    return {
        answer: String(answer || "Sorry, I could not generate an answer.").trim(),
        sources: mapSources(chunks),
    };
}

async function* chatStream({ message, history = [] }) {
    const q = String(message || "").trim();
    if (!q) {
        yield { type: "error", message: "message is required" };
        return;
    }

    try {
        const chunks = await retrieve(q, 5);
        const prompt = buildPrompt(q, buildContext(chunks), history);

        if (useGeminiForText()) {
            const ai = getGeminiClient();
            const stream = await ai.models.generateContentStream({
                model: getGeminiChatModelName(),
                contents: prompt,
                config: { temperature: 0.4 },
            });
            for await (const chunk of stream) {
                const text = chunk?.text;
                if (text) yield { type: "token", text };
            }
        } else {
            const openai = getOpenAIClient();
            const stream = await openai.chat.completions.create({
                model: getChatModelName(),
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4,
                stream: true,
            });

            for await (const part of stream) {
                const text = part?.choices?.[0]?.delta?.content;
                if (text) {
                    yield { type: "token", text };
                }
            }
        }

        yield { type: "done", sources: mapSources(chunks) };
    } catch (err) {
        yield {
            type: "error",
            message: err.message || "Help chat stream failed",
        };
    }
}

module.exports = {
    embedText,
    embedDocument,
    retrieve,
    chat,
    chatStream,
    cosineSimilarity,
};

