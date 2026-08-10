const { GoogleGenAI } = require("@google/genai");

let client = null;
let liveClient = null;
/** Sticky index into the key pool (advances only on rotatable errors). */
let keyIndex = 0;

/**
 * Priority order from env:
 *   GEMINI_API_KEYS=key1,key2,key3
 * Falls back to single GEMINI_API_KEY / GOOGLE_API_KEY / GOOGLE_GENAI_API_KEY.
 */
function getGeminiApiKeys() {
    const multi = String(process.env.GEMINI_API_KEYS || "")
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean);
    if (multi.length) return multi;

    const single = (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_GENAI_API_KEY ||
        ""
    ).trim();
    return single ? [single] : [];
}

function getGeminiApiKey() {
    const keys = getGeminiApiKeys();
    if (!keys.length) return "";
    if (keyIndex < 0 || keyIndex >= keys.length) keyIndex = 0;
    return keys[keyIndex];
}

function maskKey(key) {
    const s = String(key || "");
    if (s.length <= 8) return "****";
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function resetGeminiClients() {
    client = null;
    liveClient = null;
}

/**
 * Quota / dead-key errors → try next project key.
 * Do NOT rotate on 400 / 503 / network (same key + backoff is correct).
 */
function isRotatableGeminiError(err) {
    const status =
        err?.status ||
        err?.statusCode ||
        err?.code ||
        err?.error?.code ||
        err?.response?.status;
    const msg = String(
        err?.message ||
            err?.error?.message ||
            err?.statusText ||
            ""
    ).toLowerCase();
    const statusStr = String(status || "").toLowerCase();

    if (Number(status) === 429) return true;
    if (statusStr === "resource_exhausted") return true;
    if (msg.includes("resource_exhausted")) return true;
    if (msg.includes("quota") && (msg.includes("exceed") || msg.includes("exhausted")))
        return true;
    if (msg.includes("rate limit") || msg.includes("too many requests"))
        return true;

    if (Number(status) === 403) return true;
    if (msg.includes("api_key_invalid") || msg.includes("api key not valid"))
        return true;
    if (msg.includes("permission_denied") && msg.includes("api key"))
        return true;

    return false;
}

/**
 * Advance sticky key index. Returns false if no next key left.
 */
function rotateToNextGeminiKey(reason = "") {
    const keys = getGeminiApiKeys();
    if (keys.length <= 1) return false;
    if (keyIndex >= keys.length - 1) return false;

    const from = maskKey(keys[keyIndex]);
    keyIndex += 1;
    const to = maskKey(keys[keyIndex]);
    resetGeminiClients();
    console.warn(
        `[gemini] rotating API key ${from} → ${to} (${keyIndex + 1}/${keys.length})${reason ? ` reason=${reason}` : ""}`
    );
    return true;
}

function getGeminiClient() {
    const key = getGeminiApiKey();
    if (!key) {
        throw new Error(
            "GEMINI_API_KEY / GEMINI_API_KEYS is not set in environment (Google AI Studio key)"
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
            "GEMINI_API_KEY / GEMINI_API_KEYS is not set in environment (Google AI Studio key)"
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

/**
 * Run `fn(ai)` with automatic key rotation on quota / invalid-key errors.
 * Stays on the working key afterwards (sticky).
 */
async function withGeminiRetry(fn) {
    const keys = getGeminiApiKeys();
    if (!keys.length) {
        throw new Error(
            "GEMINI_API_KEY / GEMINI_API_KEYS is not set in environment (Google AI Studio key)"
        );
    }

    let lastErr;
    const maxAttempts = keys.length - keyIndex;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn(getGeminiClient());
        } catch (err) {
            lastErr = err;
            const reason = String(err?.message || err).slice(0, 180);
            if (!isRotatableGeminiError(err) || !rotateToNextGeminiKey(reason)) {
                throw err;
            }
        }
    }
    throw lastErr;
}

async function withGeminiLiveRetry(fn) {
    const keys = getGeminiApiKeys();
    if (!keys.length) {
        throw new Error(
            "GEMINI_API_KEY / GEMINI_API_KEYS is not set in environment (Google AI Studio key)"
        );
    }

    let lastErr;
    const maxAttempts = keys.length - keyIndex;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn(getGeminiLiveClient());
        } catch (err) {
            lastErr = err;
            const reason = String(err?.message || err).slice(0, 180);
            if (!isRotatableGeminiError(err) || !rotateToNextGeminiKey(reason)) {
                throw err;
            }
        }
    }
    throw lastErr;
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
    getGeminiApiKeys,
    getGeminiChatModelName,
    getGeminiEmbedModelName,
    getGeminiLiveModelName,
    useGeminiForText,
    useGeminiForLiveVoice,
    withGeminiRetry,
    withGeminiLiveRetry,
    isRotatableGeminiError,
    rotateToNextGeminiKey,
};
