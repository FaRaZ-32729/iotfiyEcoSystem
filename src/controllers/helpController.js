const { chat } = require("../rag/ragService");
const { agentChat, agentChatStream } = require("../agent/agentService");
const { transcribeAudioBuffer } = require("../rag/transcribeService");
const {
    createRealtimeSession,
    executeRealtimeTool,
    formatVoiceAnswerForChat,
} = require("../agent/realtimeService");

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

/**
 * POST /api/help/realtime/session
 * Returns ephemeral client secret for browser WebRTC (Live Voice).
 * Does not replace existing /chat or /transcribe flows.
 */
async function helpRealtimeSession(req, res) {
    try {
        const session = await createRealtimeSession(req.user);
        return res.status(200).json({
            success: true,
            provider: session.provider || "openai",
            clientSecret: session.clientSecret,
            expiresAt: session.expiresAt,
            model: session.model,
            voice: session.voice,
            liveConfig: session.liveConfig || null,
        });
    } catch (err) {
        console.error("[help/realtime/session]", err.message || err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: FRIENDLY_UNAVAILABLE,
        });
    }
}

/**
 * POST /api/help/realtime/tool
 * Body: { name, arguments? } — runs existing agent tools for Live Voice.
 */
async function helpRealtimeTool(req, res) {
    try {
        const name = req.body?.name;
        const args = req.body?.arguments ?? req.body?.args ?? {};
        const result = await executeRealtimeTool(req.user, name, args);
        return res.status(200).json({ success: true, result });
    } catch (err) {
        console.error("[help/realtime/tool]", err.message || err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: FRIENDLY_UNAVAILABLE,
            result: { error: err.message || "Tool failed" },
        });
    }
}

/**
 * POST /api/help/realtime/format-chat
 * Body: { spokenText, userText? } — chat-friendly Markdown from spoken answer.
 */
async function helpRealtimeFormatChat(req, res) {
    try {
        const spokenText = String(req.body?.spokenText || "").trim();
        if (!spokenText) {
            return res.status(400).json({
                success: false,
                message: "spokenText is required",
            });
        }
        const text = await formatVoiceAnswerForChat({
            spokenText,
            userText: req.body?.userText,
        });
        return res.status(200).json({ success: true, text });
    } catch (err) {
        console.error("[help/realtime/format-chat]", err.message || err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: FRIENDLY_UNAVAILABLE,
        });
    }
}

module.exports = {
    helpChat,
    helpChatStream,
    helpTranscribe,
    helpRealtimeSession,
    helpRealtimeTool,
    helpRealtimeFormatChat,
};
