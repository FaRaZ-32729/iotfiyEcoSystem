const Organization = require("../models/organizationModel");
const Venue = require("../models/venueModel");
const Device = require("../models/deviceModel");
const User = require("../models/userModel");
const SubscriptionPlan = require("../models/subscriptionPlanModel");
const { retrieve } = require("../rag/ragService");

const DEVICE_LIST_SELECT =
    "deviceId deviceName deviceType category status state lastSeen lastUpdateTime venue brandName setTemperature acMode fanSpeed acLocked espTemperature espHumidity espPower espEnergy espCurrent espVoltage espOdour espAQI espSmokePct espWaterLeak temperatureAlert humidityAlert odourAlert aqiAlert smokeAlert waterLeakAlert glAlert voltageAlert currentAlert acHealthAlert energyMonitoringIncluded";

/**
 * Resolve venue ObjectIds this user is allowed to see.
 */
async function getAccessibleVenueIds(user) {
    if (!user) return [];

    if (user.role === "admin") {
        const venues = await Venue.find({}).select("_id").lean();
        return venues.map((v) => v._id);
    }

    if (user.role === "manager") {
        const orgs = await Organization.find({ owner: user._id }).select("_id").lean();
        const orgIds = orgs.map((o) => o._id);
        if (!orgIds.length) return [];
        const venues = await Venue.find({ organization: { $in: orgIds } })
            .select("_id")
            .lean();
        return venues.map((v) => v._id);
    }

    // sub-user
    if (!user.venues?.length) return [];
    return user.venues.map((v) => v.venueId).filter(Boolean);
}

async function assertDeviceAccess(user, device) {
    if (!device) return false;
    if (user.role === "admin") return true;
    const venueIds = await getAccessibleVenueIds(user);
    const venueId = device.venue?._id || device.venue;
    return venueIds.some((id) => String(id) === String(venueId));
}

function slimDevice(d) {
    if (!d) return null;
    const category = d.category;
    const canHaveSchedules =
        category === "scheduling" ||
        category === "trigger" ||
        d.deviceType === "AC";
    return {
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        deviceType: d.deviceType,
        category,
        canHaveSchedules,
        scheduleNote:
            category === "monitoring"
                ? "Monitoring devices cannot have ON/OFF schedules — only sensing and alerts."
                : canHaveSchedules
                  ? "This device can use scheduling/trigger features in the dashboard."
                  : null,
        status: d.status,
        state: d.state,
        venueName: d.venue?.name || null,
        organizationName: d.venue?.organization?.name || null,
        lastSeen: d.lastSeen,
        lastUpdateTime: d.lastUpdateTime,
        setTemperature: d.setTemperature,
        acMode: d.acMode,
        fanSpeed: d.fanSpeed,
        acLocked: d.acLocked,
        brandName: d.brandName,
        energyMonitoringIncluded: d.energyMonitoringIncluded,
        live: {
            temperature: d.espTemperature,
            humidity: d.espHumidity,
            powerW: d.espPower,
            energyKwh: d.espEnergy,
            currentA: d.espCurrent,
            voltageV: d.espVoltage,
            odour: d.espOdour,
            aqi: d.espAQI,
            smokePct: d.espSmokePct,
            waterLeak: d.espWaterLeak,
        },
        alerts: {
            temperature: d.temperatureAlert,
            humidity: d.humidityAlert,
            odour: d.odourAlert,
            aqi: d.aqiAlert,
            smoke: d.smokeAlert,
            waterLeak: d.waterLeakAlert,
            gas: d.glAlert,
            voltage: d.voltageAlert,
            current: d.currentAlert,
            acHealth: d.acHealthAlert,
        },
    };
}

async function listMyOrganizations(user) {
    if (user.role === "admin") {
        const orgs = await Organization.find({})
            .select("name owner createdAt")
            .populate("owner", "name email")
            .lean();
        return {
            count: orgs.length,
            organizations: orgs.map((o) => ({
                id: String(o._id),
                name: o.name,
                ownerName: o.owner?.name || null,
                ownerEmail: o.owner?.email || null,
            })),
        };
    }

    if (user.role === "manager") {
        const orgs = await Organization.find({ owner: user._id })
            .select("name createdAt")
            .lean();
        return {
            count: orgs.length,
            organizations: orgs.map((o) => ({
                id: String(o._id),
                name: o.name,
            })),
        };
    }

    const u = await User.findById(user._id)
        .populate("organizations", "name createdAt")
        .lean();
    const orgs = u?.organizations || [];
    return {
        count: orgs.length,
        organizations: orgs.map((o) => ({
            id: String(o._id),
            name: o.name,
        })),
    };
}

async function listMyVenues(user, args = {}) {
    const { organizationName, organizationId } = args;
    let venueFilter = {};

    if (user.role === "admin") {
        if (organizationId) venueFilter.organization = organizationId;
        else if (organizationName) {
            const org = await Organization.findOne({
                name: new RegExp(`^${escapeRegex(organizationName)}$`, "i"),
            })
                .select("_id")
                .lean();
            if (!org) return { count: 0, venues: [], message: "Organization not found" };
            venueFilter.organization = org._id;
        }
    } else if (user.role === "manager") {
        const orgs = await Organization.find({ owner: user._id }).select("_id name").lean();
        let orgIds = orgs.map((o) => o._id);
        if (organizationId) {
            orgIds = orgIds.filter((id) => String(id) === String(organizationId));
        } else if (organizationName) {
            orgIds = orgs
                .filter((o) => o.name.toLowerCase() === String(organizationName).toLowerCase())
                .map((o) => o._id);
        }
        if (!orgIds.length) return { count: 0, venues: [], message: "No matching organizations" };
        venueFilter.organization = { $in: orgIds };
    } else {
        const ids = await getAccessibleVenueIds(user);
        if (!ids.length) return { count: 0, venues: [], message: "No venues assigned" };
        venueFilter._id = { $in: ids };
    }

    const venues = await Venue.find(venueFilter)
        .populate("organization", "name")
        .select("name organization createdAt")
        .lean();

    return {
        count: venues.length,
        venues: venues.map((v) => ({
            id: String(v._id),
            name: v.name,
            organizationName: v.organization?.name || null,
            organizationId: v.organization?._id ? String(v.organization._id) : null,
        })),
    };
}

async function listMyDevices(user, args = {}) {
    const { deviceType, deviceName, venueName, deviceId, category } = args;
    const venueIds = await getAccessibleVenueIds(user);
    if (!venueIds.length && user.role !== "admin") {
        return { count: 0, devices: [], message: "No accessible venues/devices" };
    }

    const filter = {};
    if (user.role !== "admin") {
        filter.venue = { $in: venueIds };
    }
    if (deviceType) filter.deviceType = String(deviceType).toUpperCase();
    if (category) filter.category = String(category).toLowerCase().trim();
    if (deviceId) filter.deviceId = String(deviceId).trim().toUpperCase();
    if (deviceName) filter.deviceName = new RegExp(escapeRegex(deviceName), "i");
    if (venueName) {
        const venues = await Venue.find({
            ...(user.role === "admin" ? {} : { _id: { $in: venueIds } }),
            name: new RegExp(escapeRegex(venueName), "i"),
        })
            .select("_id")
            .lean();
        filter.venue = { $in: venues.map((v) => v._id) };
    }

    const devices = await Device.find(filter)
        .populate({
            path: "venue",
            select: "name organization",
            populate: { path: "organization", select: "name" },
        })
        .select(DEVICE_LIST_SELECT)
        .lean();

    const slim = devices.map(slimDevice);
    return {
        count: slim.length,
        devices: slim,
        hint:
            slim.length > 1
                ? "Multiple devices matched. Ask the user for deviceId (unique) or exact deviceName."
                : undefined,
        capabilityReminder:
            "Schedules only for category scheduling/trigger (and AC). Monitoring devices cannot have schedules. All tools are read-only.",
        alertReminder:
            "For 'which devices have alerts?' do NOT use this list. Call listMyActiveAlerts — Dashboard Alerts panel only shows devices with at least one alert flag true.",
    };
}

const ACTIVE_ALERT_OR = [
    { temperatureAlert: true },
    { humidityAlert: true },
    { odourAlert: true },
    { aqiAlert: true },
    { smokeAlert: true },
    { waterLeakAlert: true },
    { glAlert: true },
    { voltageAlert: true },
    { currentAlert: true },
];

function buildActiveAlerts(device) {
    const activeAlerts = [];
    if (device.temperatureAlert) {
        activeAlerts.push({
            type: "temperature",
            value: device.espTemperature ?? null,
            display:
                device.espTemperature != null && device.espTemperature !== ""
                    ? `${device.espTemperature}°C`
                    : "--",
        });
    }
    if (device.humidityAlert) {
        activeAlerts.push({
            type: "humidity",
            value: device.espHumidity ?? null,
            display:
                device.espHumidity != null && device.espHumidity !== ""
                    ? `${device.espHumidity}%`
                    : "--",
        });
    }
    if (device.odourAlert) {
        activeAlerts.push({
            type: "odour",
            value: device.espOdour ?? null,
            display:
                device.espOdour != null && device.espOdour !== ""
                    ? String(device.espOdour)
                    : "--",
        });
    }
    if (device.aqiAlert) {
        activeAlerts.push({
            type: "AQI",
            value: device.espAQI ?? null,
            display:
                device.espAQI != null && device.espAQI !== ""
                    ? String(device.espAQI)
                    : "--",
        });
    }
    if (device.smokeAlert) {
        activeAlerts.push({
            type: "smoke",
            value: device.espSmokePct ?? null,
            display:
                device.espSmokePct != null ? `${device.espSmokePct}%` : "Detected",
        });
    }
    if (device.waterLeakAlert) {
        activeAlerts.push({
            type: "waterLeak",
            value: device.espWaterLeak ?? null,
            display: "Detected",
        });
    }
    if (device.glAlert) {
        activeAlerts.push({
            type: "gass",
            value: device.espGL ?? null,
            display:
                device.espGL != null && device.espGL !== ""
                    ? String(device.espGL)
                    : "--",
        });
    }
    if (device.voltageAlert) {
        activeAlerts.push({
            type: "voltage",
            value: device.espVoltage ?? null,
            display:
                device.espVoltage != null && device.espVoltage !== ""
                    ? `${device.espVoltage}V`
                    : "--",
        });
    }
    if (device.currentAlert) {
        activeAlerts.push({
            type: "current",
            value: device.espCurrent ?? null,
            display:
                device.espCurrent != null && device.espCurrent !== ""
                    ? `${device.espCurrent}A`
                    : "--",
        });
    }
    return activeAlerts;
}

/**
 * Same membership rule as Dashboard Alerts panel (/alerts/by-venue|by-org):
 * only devices with at least one *Alert boolean true.
 */
async function listMyActiveAlerts(user, args = {}) {
    const { venueName, organizationName } = args;
    const venueIds = await getAccessibleVenueIds(user);
    if (!venueIds.length && user.role !== "admin") {
        return {
            count: 0,
            devices: [],
            message: "No accessible venues/devices",
        };
    }

    const filter = {
        $or: ACTIVE_ALERT_OR,
    };

    if (user.role !== "admin") {
        filter.venue = { $in: venueIds };
    }

    if (venueName || organizationName) {
        const venueQuery = {
            ...(user.role === "admin" ? {} : { _id: { $in: venueIds } }),
        };
        if (venueName) {
            venueQuery.name = new RegExp(escapeRegex(venueName), "i");
        }
        if (organizationName) {
            const orgs = await Organization.find({
                name: new RegExp(escapeRegex(organizationName), "i"),
            })
                .select("_id")
                .lean();
            venueQuery.organization = { $in: orgs.map((o) => o._id) };
        }
        const venues = await Venue.find(venueQuery).select("_id").lean();
        filter.venue = { $in: venues.map((v) => v._id) };
    }

    const devices = await Device.find(filter)
        .populate({
            path: "venue",
            select: "name organization",
            populate: { path: "organization", select: "name" },
        })
        .select(
            "deviceId deviceName deviceType category venue temperatureAlert humidityAlert odourAlert aqiAlert smokeAlert waterLeakAlert glAlert voltageAlert currentAlert espTemperature espHumidity espOdour espAQI espSmokePct espWaterLeak espGL espVoltage espCurrent lastUpdateTime"
        )
        .sort({ lastUpdateTime: -1 })
        .lean();

    const rows = devices.map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        deviceType: d.deviceType,
        category: d.category,
        venueName: d.venue?.name || null,
        organizationName: d.venue?.organization?.name || null,
        activeAlerts: buildActiveAlerts(d),
        lastUpdateTime: d.lastUpdateTime,
    }));

    return {
        count: rows.length,
        devices: rows,
        matchesDashboardAlertsPanel: true,
        instructionForAssistant:
            "List ONLY these devices. For each device list ONLY activeAlerts (type + display). Never invent devices. Never list false/cleared alerts. Values may be '--' when the metric snapshot is empty — still an active alert if listed here.",
    };
}

async function getDeviceSnapshot(user, args = {}) {
    const { deviceId, deviceName } = args;
    if (!deviceId && !deviceName) {
        return {
            error: "Provide deviceId (preferred, globally unique) or deviceName",
        };
    }

    let device = null;
    if (deviceId) {
        device = await Device.findOne({
            deviceId: String(deviceId).trim().toUpperCase(),
        })
            .populate({
                path: "venue",
                select: "name organization",
                populate: { path: "organization", select: "name" },
            })
            .select(DEVICE_LIST_SELECT)
            .lean();
    } else {
        const venueIds = await getAccessibleVenueIds(user);
        const filter = {
            deviceName: new RegExp(`^${escapeRegex(deviceName)}$`, "i"),
        };
        if (user.role !== "admin") filter.venue = { $in: venueIds };

        const matches = await Device.find(filter)
            .populate({
                path: "venue",
                select: "name organization",
                populate: { path: "organization", select: "name" },
            })
            .select(DEVICE_LIST_SELECT)
            .lean();

        if (matches.length > 1) {
            return {
                error: "Multiple devices share this name. Ask for deviceId.",
                matches: matches.map((d) => ({
                    deviceId: d.deviceId,
                    deviceName: d.deviceName,
                    venueName: d.venue?.name,
                })),
            };
        }
        device = matches[0] || null;
    }

    if (!device) return { error: "Device not found" };
    const ok = await assertDeviceAccess(user, device);
    if (!ok) return { error: "You do not have access to this device" };

    return { device: slimDevice(device) };
}

async function listMyTeamMembers(user) {
    if (user.role === "user") {
        return {
            error: "Only managers (and admins) can list team members",
            count: 0,
            members: [],
        };
    }

    const managerId = user.role === "manager" ? user._id : null;
    // Admin without managerId: return message to use a manager context — for admin list nothing specific
    if (user.role === "admin") {
        return {
            message:
                "Admin: specify you need a particular manager's team via the logged-in manager account. This session is admin.",
            count: 0,
            members: [],
        };
    }

    const subUsers = await User.find({
        creatorId: managerId,
        role: "user",
    })
        .select("name email role permission venues organizations isActive createdAt")
        .populate("venues.venueId", "name")
        .populate("organizations", "name")
        .lean();

    return {
        count: subUsers.length,
        members: subUsers.map((u) => ({
            name: u.name,
            email: u.email,
            role: u.role,
            permission: u.permission || null,
            isActive: u.isActive !== false,
            venues: (u.venues || []).map((v) => v.venueName || v.venueId?.name).filter(Boolean),
            organizations: (u.organizations || []).map((o) => o.name),
        })),
    };
}

async function countMyTeamMembers(user) {
    if (user.role !== "manager") {
        return {
            error: "Only managers can count their team members",
            count: 0,
        };
    }
    const count = await User.countDocuments({
        creatorId: user._id,
        role: "user",
    });
    return { count };
}

async function searchHelpDocs(_user, args = {}) {
    const query = String(args.query || "").trim();
    if (!query) return { chunks: [], message: "query required" };
    const chunks = await retrieve(query, 4);
    return {
        chunks: chunks.map((c) => ({
            title: c.title,
            source: c.source,
            content: c.content.slice(0, 1200),
            score: c.score,
        })),
    };
}

/**
 * Manager (or admin with subscription): used / total / remaining for orgs, venues, devices, users.
 */
async function getMySubscriptionUsage(user) {
    let target = user;

    // Sub-user: usage belongs to their manager
    if (user.role === "user" && user.creatorId) {
        target = await User.findById(user.creatorId);
        if (!target) {
            return { error: "Manager account not found for this user" };
        }
    }

    if (!target.currentSubscription) {
        return { error: "No active subscription found on this account" };
    }

    await target.populate({
        path: "currentSubscription",
        populate: { path: "plan" },
    });

    const sub = target.currentSubscription;
    const plan = sub?.plan;
    if (!plan) {
        return { error: "Subscription plan details not found" };
    }

    const usedOrganizations = await Organization.countDocuments({
        owner: target._id,
    });
    const orgIds = (
        await Organization.find({ owner: target._id }).select("_id").lean()
    ).map((o) => o._id);
    const usedVenues = await Venue.countDocuments({
        organization: { $in: orgIds },
    });
    const venueIds = (
        await Venue.find({ organization: { $in: orgIds } }).select("_id").lean()
    ).map((v) => v._id);
    const usedDevices = await Device.countDocuments({
        venue: { $in: venueIds },
    });
    const usedUsers = await User.countDocuments({
        creatorId: target._id,
        role: "user",
    });

    const maxUsers = plan.maxUsers || 10;
    const usage = {
        organizations: {
            used: usedOrganizations,
            total: plan.maxOrganizations,
            remaining: Math.max(0, plan.maxOrganizations - usedOrganizations),
        },
        venues: {
            used: usedVenues,
            total: plan.maxVenues,
            remaining: Math.max(0, plan.maxVenues - usedVenues),
        },
        devices: {
            used: usedDevices,
            total: plan.maxDevices,
            remaining: Math.max(0, plan.maxDevices - usedDevices),
        },
        users: {
            used: usedUsers,
            total: maxUsers,
            remaining: Math.max(0, maxUsers - usedUsers),
        },
    };

    return {
        subscription: {
            planName: plan.name,
            planType: plan.type,
            isActive: sub.status === "active",
            startDate: sub.startDate,
            endDate: sub.endDate,
        },
        usage,
        note: "remaining = how many more of that resource you can still create under the current plan.",
    };
}

/**
 * List subscription plans. Admin can filter to plans they created.
 */
async function listSubscriptionPlans(user, args = {}) {
    const createdByMe = args.createdByMe === true || args.createdByMe === "true";

    if (createdByMe && user.role !== "admin") {
        return {
            error: "Only admins can list plans they created (createdByMe).",
            plans: [],
        };
    }

    const filter = { isActive: true };
    if (createdByMe) {
        filter.createdBy = user._id;
    }

    const plans = await SubscriptionPlan.find(filter)
        .select(
            "name type description price durationDays maxOrganizations maxVenues maxDevices maxUsers isCustom assignedToEmail createdBy createdAt"
        )
        .sort({ price: 1 })
        .lean();

    return {
        count: plans.length,
        plans: plans.map((p) => ({
            id: String(p._id),
            name: p.name,
            type: p.type,
            description: p.description || null,
            price: p.price,
            durationDays: p.durationDays,
            limits: {
                maxOrganizations: p.maxOrganizations,
                maxVenues: p.maxVenues,
                maxDevices: p.maxDevices,
                maxUsers: p.maxUsers,
            },
            isCustom: !!p.isCustom,
            assignedToEmail: p.assignedToEmail || null,
            createdAt: p.createdAt,
        })),
    };
}

function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOOL_IMPL = {
    listMyOrganizations: (user, args) => listMyOrganizations(user, args),
    listMyVenues: (user, args) => listMyVenues(user, args),
    listMyDevices: (user, args) => listMyDevices(user, args),
    listMyActiveAlerts: (user, args) => listMyActiveAlerts(user, args),
    getDeviceSnapshot: (user, args) => getDeviceSnapshot(user, args),
    listMyTeamMembers: (user, args) => listMyTeamMembers(user, args),
    countMyTeamMembers: (user, args) => countMyTeamMembers(user, args),
    getMySubscriptionUsage: (user, args) => getMySubscriptionUsage(user, args),
    listSubscriptionPlans: (user, args) => listSubscriptionPlans(user, args),
    searchHelpDocs: (user, args) => searchHelpDocs(user, args),
};

async function runAgentTool(user, name, args = {}) {
    const fn = TOOL_IMPL[name];
    if (!fn) return { error: `Unknown tool: ${name}` };
    try {
        return await fn(user, args || {});
    } catch (err) {
        console.error(`[agentTool:${name}]`, err.message || err);
        return { error: err.message || "Tool failed" };
    }
}

/** OpenAI Chat Completions tools */
const AGENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "listMyOrganizations",
            description: "List organizations the logged-in user can access.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyVenues",
            description:
                "List venues the user can access. Optionally filter by organization name or id.",
            parameters: {
                type: "object",
                properties: {
                    organizationName: { type: "string" },
                    organizationId: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyDevices",
            description:
                "List devices the user can access (all devices, including ones with no alerts). Filter by deviceType, deviceName, venueName, deviceId, or category. Do NOT use this to answer 'which devices have alerts?' — use listMyActiveAlerts instead.",
            parameters: {
                type: "object",
                properties: {
                    deviceType: { type: "string" },
                    deviceName: { type: "string" },
                    venueName: { type: "string" },
                    deviceId: { type: "string" },
                    category: {
                        type: "string",
                        description: "monitoring | scheduling | trigger",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyActiveAlerts",
            description:
                "REQUIRED for questions like 'which devices have alerts?', 'alert panel devices', 'kis devices pe alert hai'. Returns ONLY devices that currently appear in the Dashboard Alerts panel (at least one alert flag true), with activeAlerts types and display values. Optional venueName / organizationName filters.",
            parameters: {
                type: "object",
                properties: {
                    venueName: { type: "string" },
                    organizationName: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getDeviceSnapshot",
            description:
                "READ-ONLY: Get one device's latest stored live metrics and settings. Prefer deviceId. Includes canHaveSchedules. Does not create or change anything.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyTeamMembers",
            description:
                "For managers: list sub-users (name, email, permission, venues). Not for role=user.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "countMyTeamMembers",
            description: "For managers: how many sub-users are under them.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "getMySubscriptionUsage",
            description:
                "READ-ONLY: How many organizations, venues, devices, and team users are used vs plan limits, and how many remaining can still be created. Use when asked 'kitne aur devices/orgs/venues/users bana sakta hun?' or subscription limits.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "listSubscriptionPlans",
            description:
                "READ-ONLY: List active subscription plans (name, type, price, limits). For admin asking which plans they created, set createdByMe=true.",
            parameters: {
                type: "object",
                properties: {
                    createdByMe: {
                        type: "boolean",
                        description:
                            "If true (admin only), only plans created by this admin.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "searchHelpDocs",
            description:
                "Search ecoSystem product help docs (how-to UI flows, roles/permissions, device rename, AC lock, alerts, OTA, plans, categories). Not for inventing menus. Prefer this for 'can I change device name' / permission questions.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" },
                },
                required: ["query"],
            },
        },
    },
];

module.exports = {
    runAgentTool,
    AGENT_TOOLS,
    AGENT_FUNCTION_DECLARATIONS: AGENT_TOOLS,
    listMyOrganizations,
    listMyVenues,
    listMyDevices,
    listMyActiveAlerts,
    getDeviceSnapshot,
    listMyTeamMembers,
    countMyTeamMembers,
    getMySubscriptionUsage,
    listSubscriptionPlans,
    searchHelpDocs,
};
