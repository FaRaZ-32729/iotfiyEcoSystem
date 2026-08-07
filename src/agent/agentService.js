const {
    getOpenAIClient,
    getChatModelName,
} = require("../rag/openaiClient");
const {
    getGeminiClient,
    getGeminiChatModelName,
    useGeminiForText,
} = require("../rag/geminiClient");
const { runAgentTool, AGENT_TOOLS } = require("./agentTools");
const {
    toGeminiFunctionDeclarations,
    toGeminiHistory,
    extractFunctionCalls,
} = require("./geminiAgentUtils");

const SYSTEM_INSTRUCTION = `You are Eco, the ecoSystem personal assistant for the logged-in user.

Capabilities (CRITICAL — read-only):
- You can ONLY READ data via tools (orgs, venues, devices, live/last metrics, historical sensor series, schedules/events/triggers, team members, help docs).
- You CANNOT create, update, delete, or apply schedules/events/settings. There are NO write tools.
- Never say you will yourself "add/create/schedule/delete/rename" something. Explain how THIS logged-in user can do it in the UI (if allowed), or say they cannot.
- Historical / past readings / averages / "last week with 4h interval" / date ranges → MUST call getDeviceSensorHistory (same data as Download Modal). Prefer deviceId. Use lastDays/lastHours or start+end. If user wants a single day with NO interval, omit interval args and use mode=both — report EVERY row (returnedRowCount/pointCount). NEVER invent a 15-minute interval. Only pass intervalValue+intervalUnit when the user explicitly asks for buckets. mode=summary only when they ask for average/min/max without listing points.
- If getDeviceSensorHistory returns historicalStorageAvailable=false: politely say you can share the latest live reading (then call getDeviceSnapshot) but previous days are not stored for that device type yet. Do not invent past numbers.

Schedules / Events (CRITICAL — always use tools):
- Upcoming / current schedule or event on a device → MUST call getCurrentOrNextEvent (prefer deviceId).
- List all events on a device (AC setpoint on an event, days, times) → MUST call getDeviceEvents.
- "Kis devices par event/schedule lagi hai?" / currently running events → MUST call listDevicesWithEvents (currentlyRunning=true when asking what is running now).
- AC event temperature/setpoint → read setTemperature from getDeviceEvents or getCurrentOrNextEvent — never say you don't know without calling a tool.
- Trigger devices use trigger schedules (startTime only); scheduling/AC use start+end windows. Times from tools are UTC.
- NEVER invent events. NEVER say "pata nahi" / "I don't know" about schedules without calling these tools first.

Online / Offline (CRITICAL — match Dashboard device-card LED):
- Prefer isOnline / connectivity / status from tools. Do NOT trust dbStatus alone — Mongo can stay "online" while the card shows offline.
- Agent uses the same 90s presence idea as the frontend card (live data/status; stale → offline).
- If isOnline=false, say the device is offline.

Scheduling rules (CRITICAL):
- Schedules only for category "scheduling" (and AC). Monitoring cannot have schedules.
- If asked to schedule a monitoring device: say not possible.

Role & permission rules (CRITICAL — use LOGGED-IN USER CONTEXT block below):
- admin: Plans, OTA, Managers Active/Inactive. Can VIEW ALL data platform-wide: every organization, venue, device, manager. Orgs/Venues/Devices tabs are VIEW ONLY. Admin does NOT rename/create devices. No Change Email tab.
- Admin "how many organizations/venues/devices?" → MUST call getPlatformOverview or listMyOrganizations/listMyVenues/listMyDevices. Answer with the number immediately. NEVER say admin has no org data. NEVER use getMySubscriptionUsage for org counts (that is manager plan limits only).
- Admin managers / premium / limits → MUST call listAllManagers (NOT listMyTeamMembers).
- Admin OTA how-to → MUST call searchHelpDocs("admin OTA management") then give exact steps: Admin sidebar → OTA Management (/admin/management/ota) → Upload firmware (device type, version ID, .bin file) → Start OTA (select devices, Start OTA). OTA is ADMIN ONLY — not manager Device Management. NEVER say docs not found without calling searchHelpDocs first.
- manager: CRUD Organization, Venue, Device (including device NAME), Users Management (create/edit/delete team users). Cannot Active/Inactive anyone. Can change email via Account Settings.
- user + manage: CRUD Organization, Venue, Device (including device NAME). No Users Management / Subscription sidebar in current app. Can change email.
- user + view: VIEW ONLY — cannot change device name or any records. Can still open Account Settings → Change Email.
- Nobody can change their own Active/Inactive account status.
- Device rename path (manager / manage user only): Device Management → edit pencil → Device Name → save.
- NEVER say "only admin can manage device names" — that is false.
- Password change: YES for everyone via Login → Forgot password → email → reset link (15 min) → new password (min 8) + confirm. There is NO Change Password tab in Account Settings. NEVER say password change is not available.
- Email change: Account Settings → Change Email (manager/user only; hidden for admin).
- Role-scoped answers: do NOT explain admin-only flows to manager/user unless they explicitly ask what admins can do. Do NOT push manager device CRUD steps onto an admin. Do NOT tell a view user they can edit.

Your job:
1) Personal/platform data via tools — call tools FIRST, then answer. Never ask "Would you like me to provide that?" when you can fetch the data.
2) Alerts → MUST call listMyActiveAlerts (not listMyDevices dump).
3) Schedules/events → MUST call getDeviceEvents / getCurrentOrNextEvent / listDevicesWithEvents.
4) How-to → MUST call searchHelpDocs before saying documentation not found (especially OTA, plans, permissions).
5) Never invent live numbers or fake menus.
6) Prefer deviceId when disambiguating devices.
7) Match user language (English / Urdu / Roman Urdu).
8) Clean Markdown lists; numbered lists must be 1. 2. 3. continuous.
9) If a path is not in docs/prompt for THIS role: say it is not available for them — do not invent.`;

function buildLoggedInUserContext(user) {
    const role = String(user?.role || "unknown");
    const permission =
        role === "user" ? String(user?.permission || "view") : null;
    const isViewOnly = role === "user" && permission === "view";
    const canEditDevices =
        role === "manager" || (role === "user" && permission === "manage");
    const canManageTeamUsers = role === "manager";
    const isAdmin = role === "admin";

    return `
=== LOGGED-IN USER CONTEXT (authoritative for "can I …?" answers) ===
role: ${role}
permission: ${permission || "n/a"}
name: ${user?.name || "n/a"}
email: ${user?.email || "n/a"}
isViewOnly: ${isViewOnly}
canCreateEditDeleteDevices (including rename deviceName): ${canEditDevices}
canUseUsersManagement: ${canManageTeamUsers}
isAdmin: ${isAdmin}
canChangeEmailInAccountSettings: ${!isAdmin}
canActiveInactiveManagers: ${isAdmin}
canViewAllManagersAndTheirPlans: ${isAdmin}
canViewEntirePlatform: ${isAdmin}

Answer "can I change device name?" for THIS user:
- If canCreateEditDeleteDevices=true → YES: Device Management → edit → Device Name.
- If isViewOnly=true → NO: view-only permission.
- If isAdmin=true → NO: admin Devices tab is view-only; managers/manage-users rename devices.

If isAdmin=true:
- "How many organizations/venues/devices?" → getPlatformOverview or listMyOrganizations (ALL in app). Never subscription usage.
- Managers / premium / limits → listAllManagers. Never say admin cannot view managers.
- OTA how-to → searchHelpDocs then Admin → OTA Management steps. OTA is admin-only.
- NEVER ask "would you like me to provide that?" — call tool and answer directly.
=== END CONTEXT ===`;
}

function toOpenAIHistory(history = []) {
    const out = [];
    for (const h of Array.isArray(history) ? history.slice(-12) : []) {
        const text = String(h.text || "").trim();
        if (!text) continue;
        const role = h.role === "user" ? "user" : "assistant";
        if (role === "assistant" && /service is unavailable/i.test(text)) continue;
        out.push({ role, content: text });
    }
    while (out.length && out[0].role !== "user") out.shift();
    return out;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function* softStreamText(text) {
    const s = String(text || "");
    if (!s) return;
    const size = 18;
    for (let i = 0; i < s.length; i += size) {
        yield { type: "token", text: s.slice(i, i + size) };
        await sleep(12);
    }
}

function parseToolArgs(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

async function* agentChatStreamGemini({ user, message, history = [] }) {
    const ai = getGeminiClient();
    const model = getGeminiChatModelName();
    const systemInstruction = `${SYSTEM_INSTRUCTION}\n${buildLoggedInUserContext(user)}`;
    const functionDeclarations = toGeminiFunctionDeclarations(AGENT_TOOLS);

    const contents = [
        ...toGeminiHistory(history),
        { role: "user", parts: [{ text: String(message).trim() }] },
    ];

    const maxRounds = 6;
    let finalText = "";

    for (let round = 0; round < maxRounds; round++) {
        const response = await ai.models.generateContent({
            model,
            contents,
            config: {
                systemInstruction,
                temperature: 0.2,
                tools: [{ functionDeclarations }],
                automaticFunctionCalling: { disable: true },
            },
        });

        const calls = extractFunctionCalls(response);
        if (calls?.length) {
            const modelContent = response.candidates?.[0]?.content;
            if (modelContent?.parts?.length) {
                contents.push(modelContent);
            } else {
                contents.push({
                    role: "model",
                    parts: calls.map((fc) => ({
                        functionCall: {
                            name: fc.name,
                            args: fc.args || {},
                            id: fc.id,
                        },
                    })),
                });
            }

            const responseParts = [];
            for (const fc of calls) {
                const name = fc.name;
                const args = parseToolArgs(fc.args);
                console.log(
                    `[agent:gemini] tool=${name} user=${user.email || user._id} role=${user.role} args=${JSON.stringify(args)}`
                );
                const toolResult = await runAgentTool(user, name, args);
                const part = {
                    functionResponse: {
                        name,
                        response:
                            toolResult && typeof toolResult === "object"
                                ? toolResult
                                : { result: toolResult },
                    },
                };
                if (fc.id) part.functionResponse.id = fc.id;
                responseParts.push(part);
            }
            contents.push({ role: "user", parts: responseParts });
            continue;
        }

        finalText = String(response.text || "").trim();
        break;
    }

    if (!finalText) {
        finalText =
            "I looked that up but could not form an answer. Please try rephrasing, or tell me the device ID.";
    }

    for await (const ev of softStreamText(finalText)) {
        yield ev;
    }
    yield { type: "done" };
}

async function* agentChatStreamOpenAI({ user, message, history = [] }) {
    const openai = getOpenAIClient();
    const model = getChatModelName();

    const messages = [
        {
            role: "system",
            content: `${SYSTEM_INSTRUCTION}\n${buildLoggedInUserContext(user)}`,
        },
        ...toOpenAIHistory(history),
        { role: "user", content: String(message).trim() },
    ];

    const maxRounds = 6;
    let finalText = "";

    for (let round = 0; round < maxRounds; round++) {
        const completion = await openai.chat.completions.create({
            model,
            messages,
            tools: AGENT_TOOLS,
            tool_choice: "auto",
            temperature: 0.2,
        });

        const choice = completion.choices?.[0];
        const msg = choice?.message;
        if (!msg) break;

        const toolCalls = msg.tool_calls;
        if (toolCalls?.length) {
            messages.push({
                role: "assistant",
                content: msg.content || null,
                tool_calls: toolCalls,
            });

            for (const call of toolCalls) {
                const name = call.function?.name;
                const args = parseToolArgs(call.function?.arguments);
                console.log(
                    `[agent] tool=${name} user=${user.email || user._id} role=${user.role} args=${JSON.stringify(args)}`
                );
                const toolResult = await runAgentTool(user, name, args);
                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: JSON.stringify(toolResult),
                });
            }
            continue;
        }

        finalText = String(msg.content || "").trim();
        break;
    }

    if (!finalText) {
        finalText =
            "I looked that up but could not form an answer. Please try rephrasing, or tell me the device ID.";
    }

    for await (const ev of softStreamText(finalText)) {
        yield ev;
    }
    yield { type: "done" };
}

/**
 * Personal data agent with function calling (Gemini text by default when configured).
 * Yields: { type:'token', text } | { type:'done' } | { type:'error', message }
 */
async function* agentChatStream({ user, message, history = [] }) {
    const q = String(message || "").trim();
    if (!q) {
        yield { type: "error", message: "message is required" };
        return;
    }
    if (!user) {
        yield { type: "error", message: "Unauthorized" };
        return;
    }

    try {
        if (useGeminiForText()) {
            yield* agentChatStreamGemini({ user, message: q, history });
        } else {
            yield* agentChatStreamOpenAI({ user, message: q, history });
        }
    } catch (err) {
        console.error("[agentChatStream]", err.message || err);
        yield {
            type: "error",
            message: err.message || "Agent failed",
        };
    }
}

async function agentChat({ user, message, history = [] }) {
    let answer = "";
    let errMsg = null;
    for await (const ev of agentChatStream({ user, message, history })) {
        if (ev.type === "token") answer += ev.text;
        if (ev.type === "error") errMsg = ev.message;
    }
    if (errMsg && !answer) {
        const e = new Error(errMsg);
        e.statusCode = 500;
        throw e;
    }
    return { answer };
}

module.exports = {
    agentChatStream,
    agentChat,
    SYSTEM_INSTRUCTION,
    buildLoggedInUserContext,
};

