const { GoogleGenerativeAI } = require("@google/generative-ai");

let client = null;

function getGeminiClient() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error("GEMINI_API_KEY is not set in environment");
    }
    if (!client) {
        client = new GoogleGenerativeAI(key);
    }
    return client;
}

function getChatModelName() {
    return process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
}

function getEmbedModelName() {
    return process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
}

module.exports = {
    getGeminiClient,
    getChatModelName,
    getEmbedModelName,
};
