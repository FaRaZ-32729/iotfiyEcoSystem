const {
    getOpenAIClient,
    getChatModelName,
} = require("../rag/openaiClient");
const {
    useGeminiForText,
    withGeminiRetry,
} = require("../rag/geminiClient");
const { runAgentTool, AGENT_TOOLS } = require("./agentTools");
const {
    createMutationRefreshTracker,
    trackMutationRefresh,
    buildMutationRefreshEvent,
} = require("./agentMutationTools");
const {
    toGeminiFunctionDeclarations,
    toGeminiHistory,
    extractFunctionCalls,
} = require("./geminiAgentUtils");

const SYSTEM_INSTRUCTION = `You are Eco, the ecoSystem personal assistant for the logged-in user.

Capabilities (CRITICAL):
- READ tools: orgs, venues, devices, live/last metrics, historical sensor series, schedules/events/triggers, team members, help docs.
- WRITE tools (when THIS user is allowed): create/update/delete Organization, Venue, Device; create/enable-disable/delete schedules and trigger events (createEvent, updateEventStatus, deleteEvent); turn scheduling/trigger devices ON/OFF (setDevicePower); change AC temperature/mode/fan (updateAcSettings); managers can also create/update/delete team users.
- When the user asks to create/update/delete: use the matching write tool. If the tool returns needsFields, ASK for those fields then retry. If needsConfirmation, show the preview and ask to confirm; only then call again with confirm=true.
- NEVER invent IDs or invent that a write succeeded — only report tool results.
- Historical / past readings / averages / "last week with 4h interval" / date ranges → MUST call getDeviceSensorHistory (same data as Download Modal). Prefer deviceId. Use lastDays/lastHours or start+end. If user wants a single day with NO interval, omit interval args and use mode=both — report EVERY row (returnedRowCount/pointCount). NEVER invent a 15-minute interval. Only pass intervalValue+intervalUnit when the user explicitly asks for buckets. mode=summary only when they ask for average/min/max without listing points.
- If getDeviceSensorHistory returns historicalStorageAvailable=false: politely say you can share the latest live reading (then call getDeviceSnapshot) but previous days are not stored for that device type yet. Do not invent past numbers.

Write rules (CRITICAL):
- Admin: NO create/update/delete for orgs/venues/devices/users via tools — view only.
- user + view: NO writes — explain view-only.
- manager OR user+manage: may use org/venue/device write tools AND createEvent (schedule/event creation) — ownership still applies: venue/org update/delete usually require owning the org.
- Team users (createTeamMember/updateTeamMember/deleteTeamMember): MANAGER ONLY.
- Deletes: always confirm with the user first (tool returns needsConfirmation until confirm=true).
- Plan limits: if tool says limit reached, tell the user and suggest renew/upgrade or removing unused items.
- Prefer resolving names via listMyOrganizations / listMyVenues / listMyDevices / listMyTeamMembers when ambiguous.

Schedules / Events (CRITICAL — always use tools):
- Upcoming / current schedule or event on a device → MUST call getCurrentOrNextEvent (prefer deviceId).
- List all events on a device (AC setpoint on an event, days, times) → MUST call getDeviceEvents.
- "Kis devices par event/schedule lagi hai?" / currently running events → MUST call listDevicesWithEvents (currentlyRunning=true when asking what is running now).
- AC event temperature/setpoint → read setTemperature from getDeviceEvents or getCurrentOrNextEvent — never say you don't know without calling a tool.
- Trigger devices use trigger schedules (startTime + days only — NO endTime); scheduling/AC use start+end windows.
- Times (CRITICAL): Schedules are stored in UTC. The Add Event modal and createEvent both convert the user's LOCAL clock using the browser timezone (not a fixed country list). When you tell the user a time:
  1) Confirm the local time/days they asked for (event.local).
  2) Then the stored UTC time/days.
  3) If dayShift is not 0, say the weekday changed (e.g. Wednesday 3 AM locally can be Tuesday evening UTC).
- NEVER invent events. NEVER say "pata nahi" / "I don't know" about schedules without calling these tools first.

Online / Offline (CRITICAL — match Dashboard device-card LED):
- Prefer isOnline / connectivity / status from tools. Do NOT trust dbStatus alone — Mongo can stay "online" while the card shows offline.
- Agent uses the same 90s presence idea as the frontend card (live data/status; stale → offline).
- If isOnline=false, say the device is offline.

Device control (CRITICAL — scheduling & trigger only):
- ON/OFF manual control works ONLY for category scheduling or trigger. Monitoring devices CANNOT be turned ON/OFF — refuse politely.
- Before setDevicePower or updateAcSettings: device MUST be online (isOnline from getDeviceSnapshot). If offline, tell the user and do NOT claim the command was sent.
- Turn ON/OFF → setDevicePower (prefer deviceId). command ON|OFF; omit command to toggle. AC ON may include setTemperature (16–30°C).
- AC temperature / mode / fan speed → updateAcSettings (Cool|Heat|Dry|FanOnly|Auto; fan Low|Medium|High|Ultra|Turbo). At least one field required.
- AC with a CURRENT active schedule blocks manual ON/OFF — disable the event first (updateEventStatus) or explain why.
- "AC par alert aya?" / AC health → getDeviceSnapshot → alerts.acHealth (acHealthAlert on the AC card — NOT the sensor Alerts panel). Sensor threshold alerts → listMyActiveAlerts.

Scheduling rules (CRITICAL):
- Schedules for category "scheduling" (and AC). Trigger events for category "trigger". Monitoring cannot have schedules or trigger events.
- If asked to schedule a monitoring device: say not possible (monitoring devices cannot have schedules).
- CREATING a schedule/event (write) → use createEvent. Allowed for manager OR user+manage (same as device edits); admin and user+view CANNOT create events. Identify the device by deviceId (preferred) or an unambiguous deviceName.
  - Pass times + days EXACTLY as the user said them (their local clock). Do NOT convert to UTC. Do NOT pass timezone / PKT / IST / UAE — the server uses the browser timezone.
  - TRIGGER devices (New Trigger Event): startTime + days ONLY. Never ask for or pass endTime, command, or temperature. Days are required (at least one weekday). Example: "trigger every Monday at 9 AM" → startTime "09:00", days ["monday"].
  - SCHEDULING devices (Add Event): startTime + endTime + days. Example: "every Wednesday 3 AM to 6 AM" → startTime "03:00", endTime "06:00", days ["wednesday"]. If they are in UTC+5 that stores as Tuesday 22:00 UTC.
  - Omit days for a one-time SCHEDULING event that runs today. Do not omit days for trigger events.
  - AC devices: command is ON or OFF, and setTemperature (°C) is REQUIRED when command is ON — ask for the temperature if missing. Non-AC scheduling devices are always ON (no OFF, no temperature) — do not ask for those.
  - If createEvent returns needsFields, ASK for those fields then retry. If it returns a conflict, tell the user an overlapping event already exists and ask for a different slot. NEVER claim success unless the tool returned success — then confirm using event.local AND stored UTC, and mention dayShift if the weekday changed. For trigger events, do not mention an end time.
  - ENABLE / DISABLE (event card) → use updateEventStatus. Frontend Enable/Disable is the same as backend ACTIVE/INACTIVE. Speak Enable/Disabled to the user. Prefer eventId from getDeviceEvents (status ALL if they mention a disabled event). Omit status to toggle like the card; or pass status "disable" / "enable". Works for scheduling AND trigger. One-time scheduling events cannot be toggled (same as the API) — offer deleteEvent instead. Trigger events can always be enabled/disabled.
  - DELETE an event (trash on the card) → use deleteEvent for scheduling AND trigger. Show the preview, ask to confirm, then call again with confirm=true. NEVER claim deleted unless the tool returned success.

Role & permission rules (CRITICAL — use LOGGED-IN USER CONTEXT block below):
- admin: Plans, OTA, Managers Active/Inactive. Can VIEW ALL data platform-wide: every organization, venue, device, manager. Orgs/Venues/Devices tabs are VIEW ONLY. Admin does NOT rename/create devices. No Change Email tab.
- Admin "how many organizations/venues/devices?" → MUST call getPlatformOverview or listMyOrganizations/listMyVenues/listMyDevices. Answer with the number immediately. NEVER say admin has no org data. NEVER use getMySubscriptionUsage for org counts (that is manager plan limits only).
- Admin managers / premium / limits → MUST call listAllManagers (NOT listMyTeamMembers).
- Admin OTA how-to → MUST call searchHelpDocs("admin OTA management") then give exact steps: Admin sidebar → OTA Management (/admin/management/ota) → Upload firmware (device type, version ID, .bin file) → Start OTA (select devices, Start OTA). OTA is ADMIN ONLY — not manager Device Management. NEVER say docs not found without calling searchHelpDocs first.
- manager: CRUD Organization, Venue, Device (including device NAME), Users Management (create/edit/delete team users) — prefer WRITE TOOLS when they ask Eco to do it. Cannot Active/Inactive anyone. Can change email via Account Settings.
- user + manage: CRUD Organization, Venue, Device (including device NAME) via tools when asked. No Users Management. Can change email.
- user + view: VIEW ONLY — cannot change device name or any records. Can still open Account Settings → Change Email.
- Nobody can change their own Active/Inactive account status.
- Device rename path (manager / manage user only): prefer updateDevice tool, or UI Device Management → edit pencil → Device Name → save.
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
9) If a path is not in docs/prompt for THIS role: say it is not available for them — do not invent.
- When performing writes: collect required info, call tool, report success/failure clearly.
- Create names CRITICAL: pass organizationName / venueName / deviceName EXACTLY as the user typed, ONCE. Never concatenate (ORG003 must stay ORG003, not ORG003ORG003).
- Edit Venue supports moving a venue to another organization (newOrganizationName) — NEVER say venues cannot change organization.
- Edit Device supports rename, venue move, type/category/conditions/AC brand/trigger alerts — NEVER invent limitations that contradict the write tools.
- Edit Organization is rename-only. Edit User is permission + orgs + venues (not name/email).
- Create Device matches Add Device: ask conditions by type; AC brandName; WLD monitoring-only; ED voltage defaults to 225; trigger alerts default false.`;

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
canCreateEditDeleteOrganizationsVenuesDevicesViaTools: ${canEditDevices}
canControlDevicesOnOffAndAcSettings: ${canEditDevices}
canUseUsersManagement: ${canManageTeamUsers}
canCreateEditDeleteTeamUsersViaTools: ${canManageTeamUsers}
isAdmin: ${isAdmin}
canChangeEmailInAccountSettings: ${!isAdmin}
canActiveInactiveManagers: ${isAdmin}
canViewAllManagersAndTheirPlans: ${isAdmin}
canViewEntirePlatform: ${isAdmin}

Answer "can I change device name?" for THIS user:
- If canCreateEditDeleteDevices=true → YES: use updateDevice tool or Device Management → edit → Device Name.
- If isViewOnly=true → NO: view-only permission.
- If isAdmin=true → NO: admin Devices tab is view-only; managers/manage-users rename devices.

If user asks to create/update/delete org/venue/device/team user:
- If allowed by flags above → collect missing fields, call the write tool, confirm deletes.
- If not allowed → refuse and explain why for THIS role.

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

/** Keep chat history small — long device-create replies blow Gemini context. */
function sanitizeAgentHistory(history = []) {
    return (Array.isArray(history) ? history : [])
        .slice(-6)
        .map((m) => ({
            role: m.role === "bot" || m.role === "assistant" ? "bot" : "user",
            text: String(m.text || "").slice(0, 1200),
        }));
}

async function* agentChatStreamGemini({ user, message, history = [] }) {
    const systemInstruction = `${SYSTEM_INSTRUCTION}\n${buildLoggedInUserContext(user)}`;
    const functionDeclarations = toGeminiFunctionDeclarations(AGENT_TOOLS);

    const contents = [
        ...toGeminiHistory(sanitizeAgentHistory(history)),
        { role: "user", parts: [{ text: String(message).trim() }] },
    ];

    const maxRounds = 10;
    let finalText = "";
    const refreshTracker = createMutationRefreshTracker();

    for (let round = 0; round < maxRounds; round++) {
        let response;
        try {
            response = await withGeminiRetry((ai, model) =>
                ai.models.generateContent({
                    model,
                    contents,
                    config: {
                        systemInstruction,
                        temperature: 0.2,
                        tools: [{ functionDeclarations }],
                        automaticFunctionCalling: { disable: true },
                    },
                })
            );
        } catch (err) {
            console.error(
                `[agent:gemini] generateContent failed round=${round + 1}/${maxRounds} msg=${String(err?.message || err).slice(0, 300)}`
            );
            throw err;
        }

        const calls = extractFunctionCalls(response);
        if (calls?.length) {
            console.log(
                `[agent:gemini] round=${round + 1} toolCalls=${calls.map((c) => c.name).join(",")}`
            );
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
                trackMutationRefresh(refreshTracker, name, toolResult);
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
    const refreshEvent = buildMutationRefreshEvent(refreshTracker);
    if (refreshEvent) yield refreshEvent;
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
        ...toOpenAIHistory(sanitizeAgentHistory(history)),
        { role: "user", content: String(message).trim() },
    ];

    const maxRounds = 10;
    let finalText = "";
    const refreshTracker = createMutationRefreshTracker();

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
                trackMutationRefresh(refreshTracker, name, toolResult);
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
    const refreshEvent = buildMutationRefreshEvent(refreshTracker);
    if (refreshEvent) yield refreshEvent;
    yield { type: "done" };
}

/**
 * Personal data agent with function calling (Gemini text by default when configured).
 * Yields: { type:'token', text } | { type:'refresh', scopes } | { type:'done' } | { type:'error', message }
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

