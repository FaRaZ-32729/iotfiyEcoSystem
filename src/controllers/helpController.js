const { chat } = require("../rag/ragService");
const { agentChat, agentChatStream } = require("../agent/agentService");
const { transcribeAudioBuffer } = require("../rag/transcribeService");

const FRIENDLY_UNAVAILABLE =
    "Currently the service is unavailable. Sorry for the inconvenience — please try again.";

/**
 * POST /api/help/chat
 * Body: { message, history?, mode?: 'docs'|'agent' }
 * Default: agent (personal data). mode=docs keeps pure RAG.
 */
async function helpChat(req, res) {
    try {
        const { message, history, mode } = req.body || {};
        const result =
            mode === "docs"
                ? await chat({ message, history })
                : await agentChat({ user: req.user, message, history });
        return res.status(200).json({
            success: true,
            answer: result.answer,
            sources: result.sources || [],
        });
    } catch (err) {
        const status = err.statusCode || 500;
        console.error("[help/chat]", err.message || err);
        return res.status(status).json({
            success: false,
            message: FRIENDLY_UNAVAILABLE,
        });
    }
}

/**
 * POST /api/help/chat/stream — SSE (personal agent by default)
 */
async function helpChatStream(req, res) {
    const { message, history, mode } = req.body || {};

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }

    const writeEvent = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const stream =
        mode === "docs"
            ? require("../rag/ragService").chatStream({ message, history })
            : agentChatStream({ user: req.user, message, history });

    try {
        for await (const event of stream) {
            if (event.type === "error") {
                console.error("[help/chat/stream]", event.message);
                writeEvent({ type: "error", message: FRIENDLY_UNAVAILABLE });
                break;
            }
            writeEvent(event);
        }
    } catch (err) {
        console.error("[help/chat/stream]", err.message || err);
        writeEvent({
            type: "error",
            message: FRIENDLY_UNAVAILABLE,
        });
    } finally {
        res.end();
    }
}

/**
 * POST /api/help/transcribe
 * multipart field "audio" — returns { text }
 * Why backend? API key must never sit in the browser.
 */
async function helpTranscribe(req, res) {
    try {
        if (!req.file?.buffer?.length) {
            return res.status(400).json({
                success: false,
                message: "No audio received. Please try again.",
            });
        }

        const { text } = await transcribeAudioBuffer({
            buffer: req.file.buffer,
            filename: req.file.originalname || "voice.webm",
            mimeType: req.file.mimetype,
        });

        if (!text) {
            return res.status(200).json({
                success: true,
                text: "",
                message: "Could not hear anything clearly. Please try again.",
            });
        }

        return res.status(200).json({ success: true, text });
    } catch (err) {
        console.error("[help/transcribe]", err.message || err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: FRIENDLY_UNAVAILABLE,
        });
    }
}

module.exports = { helpChat, helpChatStream, helpTranscribe };
