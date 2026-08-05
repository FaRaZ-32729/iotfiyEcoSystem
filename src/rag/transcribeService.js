const { getOpenAIClient, getTranscribeModelName } = require("./openaiClient");

/**
 * Speech → text via OpenAI Audio Transcriptions API.
 * Same OPENAI_API_KEY as chat/embeddings; billed separately per audio minute.
 */
async function OpenAIFile(buffer, name, type) {
    const OpenAI = require("openai");
    if (typeof OpenAI.toFile === "function") {
        return OpenAI.toFile(buffer, name, { type });
    }
    return new File([buffer], name, { type });
}

async function transcribeAudioBuffer({ buffer, filename, mimeType }) {
    if (!buffer?.length) {
        const err = new Error("Empty audio");
        err.statusCode = 400;
        throw err;
    }

    const client = getOpenAIClient();
    const model = getTranscribeModelName();
    const name = filename || "audio.webm";
    const type = mimeType || "audio/webm";

    const run = async (modelName) => {
        const file = await OpenAIFile(buffer, name, type);
        const result = await client.audio.transcriptions.create({
            file,
            model: modelName,
        });
        return {
            text: String(result?.text || "").trim(),
            model: modelName,
        };
    };

    try {
        return await run(model);
    } catch (err) {
        // Some accounts only have whisper-1 enabled
        if (model !== "whisper-1") {
            return run("whisper-1");
        }
        throw err;
    }
}

module.exports = { transcribeAudioBuffer };
