const {
    getOpenAIClient,
    getChatModelName,
} = require("../rag/openaiClient");
const { runAgentTool, AGENT_TOOLS } = require("./agentTools");

const SYSTEM_INSTRUCTION = `You are Eco, the ecoSystem personal assistant for the logged-in user.

Capabilities (CRITICAL — read-only):
- You can ONLY READ data via tools (orgs, venues, devices, live/last metrics, team members, help docs).
- You CANNOT create, update, delete, or apply schedules/events/settings. There are NO write tools.
- Never say you will yourself "add/create/schedule/delete/rename" something. Explain how THIS logged-in user can do it in the UI (if allowed), or say they cannot.

Scheduling rules (CRITICAL):
- Schedules only for category "scheduling" (and AC). Monitoring cannot have schedules.
- If asked to schedule a monitoring device: say not possible.

Role & permission rules (CRITICAL — use LOGGED-IN USER CONTEXT block below):
- admin: Plans, OTA, Managers Active/Inactive. Can VIEW ALL managers (count, plan type, subscription limits, which limits are full). Orgs/Venues/Devices tabs are VIEW ONLY. Admin does NOT rename/create devices. No Change Email tab.
- For admin asking about managers / premium plans / subscription limits: MUST call listAllManagers (NOT listMyTeamMembers — that is for manager sub-users only).
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
1) Personal data via tools. Alerts questions → MUST call listMyActiveAlerts (not listMyDevices dump).
2) How-to via searchHelpDocs + this prompt + roles-and-permissions docs. Prefer searchHelpDocs("roles permissions device name") when unsure.
3) Never invent live numbers or fake menus.
4) Prefer deviceId when disambiguating devices.
5) Match user language (English / Urdu / Roman Urdu).
6) Clean Markdown lists; numbered lists must be 1. 2. 3. continuous.
7) If a path is not in docs/prompt for THIS role: say it is not available for them — do not invent.`;

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

Answer "can I change device name?" for THIS user:
- If canCreateEditDeleteDevices=true → YES: Device Management → edit → Device Name.
- If isViewOnly=true → NO: view-only permission.
- If isAdmin=true → NO: admin Devices tab is view-only; managers/manage-users rename devices.

If isAdmin=true and user asks about managers / premium / plan limits / "kitne managers":
- MUST use listAllManagers tool. Never say admin cannot view managers.
- listMyTeamMembers is ONLY for managers listing their sub-users, NOT for admin.
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

/**
 * Personal data agent with OpenAI function calling.
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
        const openai = getOpenAIClient();
        const model = getChatModelName();

        const messages = [
            {
                role: "system",
                content: `${SYSTEM_INSTRUCTION}\n${buildLoggedInUserContext(user)}`,
            },
            ...toOpenAIHistory(history),
            { role: "user", content: q },
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
};
