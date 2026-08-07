const { GoogleGenAI } = require("@google/genai");
let client = null;
let liveClient = null;
function getGeminiApiKey() {
    return (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_GENAI_API_KEY ||
        ""
    ).trim();
}
function getGeminiClient() {
    const key = getGeminiApiKey();
    if (!key) {
        throw new Error(
            "GEMINI_API_KEY is not set in environment (Google AI Studio key)"
        );
    }
    if (!client) {
        client = new GoogleGenAI({ apiKey: key });
    }
    return client;
}
/** Live / ephemeral tokens need v1alpha. */
function getGeminiLiveClient() {
    const key = getGeminiApiKey();
    if (!key) {
        throw new Error(
            "GEMINI_API_KEY is not set in environment (Google AI Studio key)"
        );
    }
    if (!liveClient) {
        liveClient = new GoogleGenAI({
            apiKey: key,
            httpOptions: { apiVersion: "v1alpha" },
        });
    }
    return liveClient;
}
function getGeminiChatModelName() {
    return process.env.GEMINI_CHAT_MODEL || "gemini-flash-latest";
}
function getGeminiEmbedModelName() {
    return process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
}
function getGeminiLiveModelName() {
    return (
        process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview"
    );
}
/** Prefer Gemini for text when key is present, unless LLM_PROVIDER=openai. */
function useGeminiForText() {
    const provider = String(process.env.LLM_PROVIDER || "")
        .trim()
        .toLowerCase();
    if (provider === "openai") return false;
    if (provider === "gemini") return true;
    return Boolean(getGeminiApiKey());
}
/** Live voice: gemini by default when key present; LIVE_VOICE_PROVIDER overrides. */
function useGeminiForLiveVoice() {
    const provider = String(process.env.LIVE_VOICE_PROVIDER || "")
        .trim()
        .toLowerCase();
    if (provider === "openai") return false;
    if (provider === "gemini") return true;
    return Boolean(getGeminiApiKey());
}
module.exports = {
    getGeminiClient,
    getGeminiLiveClient,
    getGeminiApiKey,
    getGeminiChatModelName,
    getGeminiEmbedModelName,
    getGeminiLiveModelName,
    useGeminiForText,
    useGeminiForLiveVoice,
};
