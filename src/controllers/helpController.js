const { chat, chatStream } = require("../rag/ragService");

const FRIENDLY_UNAVAILABLE =
    "Currently the service is unavailable. Sorry for the inconvenience — please try again.";

/**
 * POST /api/help/chat
 * Body: { message: string, history?: [{ role: 'user'|'bot', text: string }] }
 */
async function helpChat(req, res) {
    try {
        const { message, history } = req.body || {};
        const result = await chat({ message, history });
        return res.status(200).json({
            success: true,
            answer: result.answer,
            sources: result.sources,
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
 * POST /api/help/chat/stream — SSE token stream (ChatGPT-style live typing)
 */
async function helpChatStream(req, res) {
    const { message, history } = req.body || {};

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

    try {
        for await (const event of chatStream({ message, history })) {
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

module.exports = { helpChat, helpChatStream };
