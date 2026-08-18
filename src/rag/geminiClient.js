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
 * Quota / dead-key / overload → try next project key.
 * Do NOT rotate on generic 400 INVALID_ARGUMENT (fix payload / context instead).
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
    if (Number(status) === 503) return true; // model overloaded — other keys often work
    if (statusStr === "resource_exhausted" || statusStr === "unavailable")
        return true;
    if (msg.includes("resource_exhausted") || msg.includes("unavailable"))
        return true;
    if (msg.includes("quota") && (msg.includes("exceed") || msg.includes("exhausted")))
        return true;
    if (msg.includes("rate limit") || msg.includes("too many requests"))
        return true;
    if (msg.includes("overloaded")) return true;
    if (msg.includes("high demand")) return true;

    if (Number(status) === 403) return true;
    if (msg.includes("api_key_invalid") || msg.includes("api key not valid"))
        return true;
    if (msg.includes("permission_denied") && msg.includes("api key"))
        return true;

    // Dead / disabled Google Cloud key — skip and try next in the pool
    if (Number(status) === 401) return true;
    if (statusStr === "unauthenticated") return true;
    if (msg.includes("account_state_invalid")) return true;
    if (msg.includes("bound service account")) return true;
    if (msg.includes("api key") && (msg.includes("deleted") || msg.includes("disabled")))
        return true;

    return false;
}

/** 503 / overloaded: same model is busy — try a lighter model, not 18 keys. */
function isCapacityError(err) {
    const status =
        err?.status ||
        err?.statusCode ||
        err?.code ||
        err?.error?.code ||
        err?.response?.status;
    const msg = String(
        err?.message || err?.error?.message || err?.statusText || ""
    ).toLowerCase();
    const statusStr = String(status || "").toLowerCase();
    if (Number(status) === 503) return true;
    if (statusStr === "unavailable") return true;
    if (msg.includes("unavailable") || msg.includes("overloaded")) return true;
    if (msg.includes("high demand")) return true;
    return false;
}

/** Per-model quota or a fallback model that this project does not have. */
function shouldFallbackChatModel(err) {
    if (isCapacityError(err)) return true;
    const status =
        err?.status ||
        err?.statusCode ||
        err?.code ||
        err?.error?.code ||
        err?.response?.status;
    const msg = String(
        err?.message || err?.error?.message || err?.statusText || ""
    ).toLowerCase();
    const statusStr = String(status || "").toLowerCase();
    if (Number(status) === 429) return true;
    if (statusStr === "resource_exhausted") return true;
    if (msg.includes("quota") && (msg.includes("exceed") || msg.includes("exhausted")))
        return true;
    if (Number(status) === 404) return true;
    if (msg.includes("model") && (msg.includes("not found") || msg.includes("not supported")))
        return true;
    return false;
}

function getGeminiChatModels() {
    const fromEnv = String(process.env.GEMINI_CHAT_MODELS || "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const primary = (
        process.env.GEMINI_CHAT_MODEL || "gemini-flash-latest"
    ).trim();
    const fallbacks = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.5-flash-lite",
    ];
    const ordered = fromEnv.length ? fromEnv : [primary, ...fallbacks];
    const seen = new Set();
    return ordered.filter((m) => {
        if (!m || seen.has(m)) return false;
        seen.add(m);
        return true;
    });
}

function getGeminiChatModelName() {
    const models = getGeminiChatModels();
    return models[0];
}

/**
 * Advance sticky key index (wraps so the full pool can be retried).
 * Returns false only when there is a single key (nowhere to rotate).
 */
function rotateToNextGeminiKey(reason = "") {
    const keys = getGeminiApiKeys();
    if (keys.length <= 1) return false;

    const fromIdx = keyIndex;
    const from = maskKey(keys[fromIdx]);
    keyIndex = (keyIndex + 1) % keys.length;
    const to = maskKey(keys[keyIndex]);
    resetGeminiClients();
    console.warn(
        `[gemini] rotating API key ${from} → ${to} (${keyIndex + 1}/${keys.length})${reason ? ` reason=${reason}` : ""}`
    );
    return true;
}

/**
 * Run `fn(ai, model)` with key rotation (429/401) and model fallback (503/429).
 * On high demand or per-model quota: try smaller chat models on the SAME key first.
 * Embeddings should pass `{ models: [embedModel] }` so chat fallbacks are not used.
 */
async function withGeminiRetry(fn, options = {}) {
    const keys = getGeminiApiKeys();
    if (!keys.length) {
        throw new Error(
            "GEMINI_API_KEY / GEMINI_API_KEYS is not set in environment (Google AI Studio key)"
        );
    }

    const models =
        Array.isArray(options.models) && options.models.length
            ? options.models
            : getGeminiChatModels();
    let lastErr;
    let modelIdx = 0;
    const maxKeyTries = keys.length;
    const maxKeysOnCapacity = Math.min(2, keys.length);

    for (let keysTried = 0; keysTried < maxKeyTries; keysTried++) {
        const keyUsed = getGeminiApiKey();
        while (modelIdx < models.length) {
            const model = models[modelIdx];
            try {
                const result = await fn(getGeminiClient(), model);
                if (modelIdx > 0) {
                    console.warn(`[gemini] using fallback model ${model}`);
                }
                return result;
            } catch (err) {
                lastErr = err;
                const status =
                    err?.status ||
                    err?.statusCode ||
                    err?.code ||
                    err?.error?.code ||
                    err?.response?.status ||
                    "n/a";
                const reason = String(
                    err?.message || err?.error?.message || err
                ).slice(0, 240);
                console.error(
                    `[gemini] key=${maskKey(keyUsed)} model=${model} status=${status} msg=${reason}`
                );

                if (!isRotatableGeminiError(err) && !shouldFallbackChatModel(err)) {
                    throw err;
                }

                if (shouldFallbackChatModel(err) && modelIdx < models.length - 1) {
                    const next = models[modelIdx + 1];
                    console.warn(
                        `[gemini] rotating model ${model} → ${next} (capacity/quota)`
                    );
                    modelIdx += 1;
                    continue;
                }

                break;
            }
        }

        modelIdx = 0;
        if (
            isCapacityError(lastErr) &&
            keysTried + 1 >= maxKeysOnCapacity
        ) {
            break;
        }
        if (
            keysTried >= maxKeyTries - 1 ||
            !rotateToNextGeminiKey(String(lastErr?.message || lastErr).slice(0, 180))
        ) {
            break;
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
    const total = keys.length;
    for (let attempt = 0; attempt < total; attempt++) {
        const keyUsed = getGeminiApiKey();
        try {
            return await fn(getGeminiLiveClient());
        } catch (err) {
            lastErr = err;
            const status =
                err?.status ||
                err?.statusCode ||
                err?.code ||
                err?.error?.code ||
                err?.response?.status ||
                "n/a";
            const reason = String(
                err?.message || err?.error?.message || err
            ).slice(0, 240);
            console.error(
                `[gemini:live] attempt ${attempt + 1}/${total} key=${maskKey(keyUsed)} status=${status} msg=${reason}`
            );

            if (!isRotatableGeminiError(err)) {
                throw err;
            }
            if (attempt >= total - 1 || !rotateToNextGeminiKey(reason)) {
                break;
            }
        }
    }
    throw lastErr;
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
    getGeminiChatModels,
    getGeminiEmbedModelName,
    getGeminiLiveModelName,
    useGeminiForText,
    useGeminiForLiveVoice,
    withGeminiRetry,
    withGeminiLiveRetry,
    isRotatableGeminiError,
    rotateToNextGeminiKey,
};
