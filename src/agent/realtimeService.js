const {
    getOpenAIClient,
    getChatModelName,
    getRealtimeModelName,
} = require("../rag/openaiClient");
const {
    getGeminiChatModelName,
    getGeminiLiveModelName,
    useGeminiForText,
    useGeminiForLiveVoice,
    withGeminiRetry,
    withGeminiLiveRetry,
} = require("../rag/geminiClient");
const { AGENT_TOOLS, runAgentTool } = require("./agentTools");
const {
    SYSTEM_INSTRUCTION,
    buildLoggedInUserContext,
} = require("./agentService");
const { toGeminiFunctionDeclarations } = require("./geminiAgentUtils");
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
You are speaking aloud to the user over a live voice call. Name: Eco. Use a natural male speaking style.
Speech style (CRITICAL):
- Talk like a helpful human on a phone call — natural sentences, short turns.
- Do NOT speak markdown, bullet points, numbered lists, headings, or "asterisk" formatting.
- For multiple items (devices, users, orgs): speak them conversationally in a flowing list ("First…, then…, and finally…") — never "1. 2. 3." out loud.
- Match the user's language automatically (English, Urdu, Roman Urdu, mixed). Do not force a language.
- If tools will take a moment, briefly say you are checking, then call tools, then answer with the facts.
- Keep answers concise unless the user asks for detail.
- Read-only rules from the main instructions still apply — never invent live numbers; call tools first.
- Historical averages/ranges: call getDeviceSensorHistory; speak the server summary (avg/min/max), not invented math over imaginary points.
Ending the call (CRITICAL):
- Clear hang-up intent only: goodbye, end the call/session, thanks for your time / you can end now, that's all, bas itna, call band karo, etc.
- A casual "thank you" or "thank you so much" alone is NOT hang-up intent — keep the session open and reply normally.
- When it IS hang-up intent:
  1) Speak your COMPLETE goodbye first (full sentences; never cut yourself off).
  2) Only AFTER that spoken goodbye, call tool ${END_LIVE_SESSION_TOOL_NAME}.
- Never call ${END_LIVE_SESSION_TOOL_NAME} in the middle of a sentence or before finishing the goodbye.

Wake word / always-on (CRITICAL):
- The mic may stay connected in the background.
- Stay COMPLETELY SILENT until the user clearly wakes you with a greeting or your name — e.g. "Hey Eco", "Hi Eco", "Hello Eco", "Eco", "Are you Eco", "Greetings Eco", "Assalam o Alaikum", "Assalamualaikum", "Salam", or similar.
- If they greet with Assalam/Salam (with or without saying Eco), reply warmly (e.g. Wa Alaikum Assalam) and help them.
- Before wake: do not greet, do not answer questions, do not call tools.
- After wake: respond normally to the following request (short friendly ack is fine if they only greeted you).
- After a farewell / end-call goodbye: go silent again and wait for the next wake.
=== END LIVE VOICE MODE ===`;
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
function buildGeminiLiveTools() {
    const decls = toGeminiFunctionDeclarations(AGENT_TOOLS);
    decls.push({
        name: END_LIVE_SESSION_TOOL_NAME,
        description: END_LIVE_SESSION_TOOL.description,
        parameters: END_LIVE_SESSION_TOOL.parameters,
    });
    return [{ functionDeclarations: decls }];
}
/**
 * Gemini Live ephemeral token for browser (API key stays on server).
 * Config is returned to the client (token alone cannot lock all Live setup fields reliably).
 */
async function createGeminiLiveSession(user) {
    const model = getGeminiLiveModelName();
    const voiceName = process.env.GEMINI_LIVE_VOICE || "Alnilam";
    const instructions = buildVoiceInstructions(user);

    const liveConfig = {
        responseModalities: ["AUDIO"],
        systemInstruction: instructions,
        tools: buildGeminiLiveTools(),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
            voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
            },
        },
    };

    // Unlocked token — client applies liveConfig on connect (avoids field_mask errors).
    const token = await withGeminiLiveRetry((ai) =>
        ai.authTokens.create({
            config: {
                uses: 1,
                newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
                expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            },
        })
    );

    if (!token?.name) {
        throw new Error("Failed to create Gemini Live ephemeral token");
    }

    return {
        provider: "gemini",
        clientSecret: token.name,
        expiresAt: token.expireTime || null,
        model,
        voice: voiceName,
        liveConfig,
    };
}
/**
 * OpenAI Realtime (legacy fallback when LIVE_VOICE_PROVIDER=openai).
 */
async function createOpenAIRealtimeSession(user) {
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
                "OpenAI-Safety-Identifier": String(
                    user._id || user.email || "eco-user"
                ),
            },
        }
    );
    return {
        provider: "openai",
        clientSecret: created.value,
        expiresAt: created.expires_at,
        model,
        voice: "coral",
    };
}
async function createRealtimeSession(user) {
    if (!user) {
        const e = new Error("Unauthorized");
        e.statusCode = 401;
        throw e;
    }
    if (useGeminiForLiveVoice()) {
        return createGeminiLiveSession(user);
    }
    return createOpenAIRealtimeSession(user);
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
            message:
                "Live voice session should end only after goodbye audio finishes.",
        };
    }
    return runAgentTool(
        user,
        toolName,
        args && typeof args === "object" ? args : {}
    );
}
async function formatVoiceAnswerForChat({ spokenText, userText }) {
    const spoken = String(spokenText || "").trim();
    if (!spoken) return "";
    const system = `You convert an assistant's SPOKEN answer into a clean chat message for the ecoSystem Help chat UI.
Rules:
- Keep the SAME facts and the SAME language as the spoken answer.
- Use Markdown when it helps reading: numbered lists for multiple devices/users/orgs, **bold** for names, short paragraphs.
- Do NOT invent data that was not spoken.
- Do NOT add greetings, disclaimers, or meta commentary.
- Return ONLY the chat message body.`;
    const userPrompt = `User said:\n${String(userText || "(unknown)").trim()}\n\nAssistant spoke:\n${spoken}`;
    try {
        if (useGeminiForText()) {
            const result = await withGeminiRetry((ai) =>
                ai.models.generateContent({
                    model: getGeminiChatModelName(),
                    contents: `${system}\n\n${userPrompt}`,
                    config: { temperature: 0.2 },
                })
            );
            const out = String(result?.text || "").trim();
            return out || spoken;
        }
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: getChatModelName(),
            temperature: 0.2,
            messages: [
                { role: "system", content: system },
                { role: "user", content: userPrompt },
            ],
        });
        const out = String(
            completion.choices?.[0]?.message?.content || ""
        ).trim();
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