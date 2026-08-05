const OpenAI = require("openai");

let client = null;

function getOpenAIClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        throw new Error("OPENAI_API_KEY is not set in environment");
    }
    if (!client) {
        client = new OpenAI({ apiKey: key });
    }
    return client;
}

function getChatModelName() {
    return process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
}

function getEmbedModelName() {
    return process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
}

function getTranscribeModelName() {
    return process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
}

module.exports = {
    getOpenAIClient,
    getChatModelName,
    getEmbedModelName,
    getTranscribeModelName,
};
