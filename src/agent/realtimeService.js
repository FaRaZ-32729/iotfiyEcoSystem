const {
    getOpenAIClient,
    getChatModelName,
    getRealtimeModelName,
} = require("../rag/openaiClient");
const { AGENT_TOOLS, runAgentTool } = require("./agentTools");
const {
    SYSTEM_INSTRUCTION,
    buildLoggedInUserContext,
} = require("./agentService");

const END_LIVE_SESSION_TOOL_NAME = "endLiveVoiceSession";

const END_LIVE_SESSION_TOOL = {
    type: "function",
    name: END_LIVE_SESSION_TOOL_NAME,
    description:
        "End the live voice call/session. Call ONLY when the user clearly wants to hang up: goodbye, end the call/session, thanks for your time (and done), that's all, bas itna, call band karo, etc. Do NOT call for a casual 'thank you' or 'thank you so much' while they may still continue. ALWAYS speak the FULL warm goodbye first (complete sentences), THEN call this tool.",
    parameters: { type: "object", properties: {} },
};

const VOICE_SPEECH_ADDENDUM = `
=== LIVE VOICE MODE (speech-to-speech) ===
You are speaking aloud to the user over a live voice call. Name: Eco. Wake phrase: "Hey Eco".

Speech style (CRITICAL):
- Talk like a helpful human on a phone call — natural sentences, short turns.
- Do NOT speak markdown, bullet points, numbered lists, headings, or "asterisk" formatting.
- For multiple items (devices, users, orgs): speak them conversationally in a flowing list ("First…, then…, and finally…") — never "1. 2. 3." out loud.
- Match the user's language automatically (English, Urdu, Roman Urdu, mixed). Do not force a language.
- If tools will take a moment, briefly say you are checking, then call tools, then answer with the facts.
- Keep answers concise unless the user asks for detail.
- Read-only rules from the main instructions still apply — never invent live numbers; call tools first.

Ending the call (CRITICAL):
- Clear hang-up intent only: goodbye, end the call/session, thanks for your time / you can end now, that's all, bas itna, call band karo, etc.
- A casual "thank you" or "thank you so much" alone is NOT hang-up intent — keep the session open and reply normally.
- When it IS hang-up intent:
  1) Speak your COMPLETE goodbye first (full sentences; never cut yourself off).
  2) Only AFTER that spoken goodbye, call tool ${END_LIVE_SESSION_TOOL_NAME}.
- Never call ${END_LIVE_SESSION_TOOL_NAME} in the middle of a sentence or before finishing the goodbye.
=== END LIVE VOICE MODE ===`;

/**
 * Chat Completions tools → Realtime flat function tools (+ live-only end session).
 */
function toRealtimeTools(tools = AGENT_TOOLS) {
    const mapped = tools.map((t) => {
        const fn = t.function || t;
        return {
            type: "function",
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters || { type: "object", properties: {} },
        };
    });
    mapped.push(END_LIVE_SESSION_TOOL);
    return mapped;
}

function buildVoiceInstructions(user) {
    return `${SYSTEM_INSTRUCTION}\n${buildLoggedInUserContext(user)}\n${VOICE_SPEECH_ADDENDUM}`;
}

/**
 * Mint ephemeral Realtime client secret for WebRTC (API key stays on server).
 */
async function createRealtimeSession(user) {
    if (!user) {
        const e = new Error("Unauthorized");
        e.statusCode = 401;
        throw e;
    }

    const openai = getOpenAIClient();
    const model = getRealtimeModelName();
    const instructions = buildVoiceInstructions(user);
    const tools = toRealtimeTools();

    const created = await openai.realtime.clientSecrets.create(
        {
            session: {
                type: "realtime",
                model,
                instructions,
                output_modalities: ["audio"],
                tools,
                tool_choice: "auto",
                audio: {
                    input: {
                        transcription: {
                            model: "gpt-4o-mini-transcribe",
                        },
                        turn_detection: {
                            type: "semantic_vad",
                            create_response: true,
                            interrupt_response: true,
                        },
                    },
                    output: {
                        voice: "coral",
                    },
                },
            },
        },
        {
            headers: {
                "OpenAI-Safety-Identifier": String(user._id || user.email || "eco-user"),
            },
        }
    );

    return {
        clientSecret: created.value,
        expiresAt: created.expires_at,
        model,
        voice: "coral",
    };
}

async function executeRealtimeTool(user, name, args = {}) {
    if (!user) {
        const e = new Error("Unauthorized");
        e.statusCode = 401;
        throw e;
    }
    const toolName = String(name || "").trim();
    if (!toolName) {
        const e = new Error("tool name is required");
        e.statusCode = 400;
        throw e;
    }

    console.log(
        `[realtime] tool=${toolName} user=${user.email || user._id} role=${user.role}`
    );

    if (toolName === END_LIVE_SESSION_TOOL_NAME) {
        return {
            ok: true,
            endSession: true,
            message: "Live voice session should end only after goodbye audio finishes.",
        };
    }

    return runAgentTool(user, toolName, args && typeof args === "object" ? args : {});
}

/**
 * Spoken answer → chat-friendly Markdown (lists OK). Does not change what was spoken.
 */
async function formatVoiceAnswerForChat({ spokenText, userText }) {
    const spoken = String(spokenText || "").trim();
    if (!spoken) return "";

    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: getChatModelName(),
            temperature: 0.2,
            messages: [
                {
                    role: "system",
                    content: `You convert an assistant's SPOKEN answer into a clean chat message for the ecoSystem Help chat UI.

Rules:
- Keep the SAME facts and the SAME language as the spoken answer.
- Use Markdown when it helps reading: numbered lists for multiple devices/users/orgs, **bold** for names, short paragraphs.
- Do NOT invent data that was not spoken.
- Do NOT add greetings, disclaimers, or meta commentary.
- Return ONLY the chat message body.`,
                },
                {
                    role: "user",
                    content: `User said:\n${String(userText || "(unknown)").trim()}\n\nAssistant spoke:\n${spoken}`,
                },
            ],
        });
        const out = String(completion.choices?.[0]?.message?.content || "").trim();
        return out || spoken;
    } catch (err) {
        console.error("[formatVoiceAnswerForChat]", err.message || err);
        return spoken;
    }
}

module.exports = {
    createRealtimeSession,
    executeRealtimeTool,
    formatVoiceAnswerForChat,
    toRealtimeTools,
    buildVoiceInstructions,
    END_LIVE_SESSION_TOOL_NAME,
};
