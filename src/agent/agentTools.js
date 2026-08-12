const Organization = require("../models/organizationModel");
const Venue = require("../models/venueModel");
const Device = require("../models/deviceModel");
const User = require("../models/userModel");
const SubscriptionPlan = require("../models/subscriptionPlanModel");
const Event = require("../models/eventModel");
const TriggerSchedule = require("../models/triggerEventModel");
const { retrieve } = require("../rag/ragService");
const { fetchSensorHistory } = require("../services/sensorHistoryService");
const {
    getCurrentOrNextScheduleData,
} = require("../services/scheduleLookupService");
const {
    MUTATION_TOOL_IMPL,
    MUTATION_AGENT_TOOLS,
} = require("./agentMutationTools");

const DEVICE_LIST_SELECT =
    "deviceId deviceName deviceType category status state lastSeen lastUpdateTime venue brandName setTemperature acMode fanSpeed acLocked espTemperature espHumidity espPower espEnergy espCurrent espVoltage espOdour espAQI espSmokePct espWaterLeak temperatureAlert humidityAlert odourAlert aqiAlert smokeAlert waterLeakAlert glAlert voltageAlert currentAlert acHealthAlert energyMonitoringIncluded";

/**
 * Match Dashboard device-card LED (useDeviceWebSocket):
 * - Card does NOT use MongoDB status alone.
 * - Online when live MQTT status/data arrives over WebSocket.
 * - Backup: if no data for 90s → offline (60s interval + 30s grace).
 * Agent has no live WS, so approximate with lastUpdateTime / lastSeen freshness (same 90s).
 */
const ONLINE_STALE_MS = 90 * 1000;

function computeConnectivity(d) {
    const dbStatus = String(d?.status || "offline").toLowerCase();
    const now = Date.now();
    const lastSeenMs = d?.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    const lastUpdateMs = d?.lastUpdateTime
        ? new Date(d.lastUpdateTime).getTime()
        : 0;
    // Prefer sensor/data activity (same idea as WS receivedAt); fall back to status lastSeen.
    const freshest = Math.max(lastUpdateMs || 0, lastSeenMs || 0);
    const ageMs = freshest ? now - freshest : null;
    const recentlyActive =
        ageMs != null && ageMs >= 0 && ageMs <= ONLINE_STALE_MS;

    // Mirror card: start from "offline unless recently heard" — do not trust sticky DB online.
    let isOnline = false;
    let reason = "no_recent_activity";

    if (dbStatus === "offline" && !recentlyActive) {
        isOnline = false;
        reason = "db_status_offline";
    } else if (recentlyActive) {
        isOnline = true;
        reason =
            lastUpdateMs && lastUpdateMs === freshest
                ? "recent_data_within_90s"
                : "recent_status_within_90s";
    } else if (dbStatus === "online") {
        isOnline = false;
        reason = "db_online_but_stale_over_90s_like_dashboard";
    } else {
        isOnline = false;
        reason = "offline";
    }

    return {
        dbStatus,
        isOnline,
        connectivity: isOnline ? "online" : "offline",
        lastActivityAt: freshest ? new Date(freshest).toISOString() : null,
        lastActivityAgeSeconds:
            ageMs != null && ageMs >= 0 ? Math.round(ageMs / 1000) : null,
        lastActivityAgeMinutes:
            ageMs != null && ageMs >= 0 ? Math.round(ageMs / 60000) : null,
        connectivityNote: reason,
        matchesDashboardCardLogic:
            "Same 90s presence idea as device-card LED (WS data/status). dbStatus alone can be sticky/wrong.",
    };
}

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
    const connectivity = computeConnectivity(d);
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
        // Prefer isOnline / connectivity for answers — dbStatus alone can be stale.
        status: connectivity.connectivity,
        isOnline: connectivity.isOnline,
        dbStatus: connectivity.dbStatus,
        connectivityNote: connectivity.connectivityNote,
        lastActivityAt: connectivity.lastActivityAt,
        lastActivityAgeMinutes: connectivity.lastActivityAgeMinutes,
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

const DAY_ORDER = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];
const PK_OFFSET_MINUTES = 5 * 60; // Asia/Karachi (PKT, no DST)

function parseHHmmToMinutes(hhmm) {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function minutesToHHmm(totalMinutes) {
    const mins = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Convert stored UTC HH:mm → Pakistan clock (+5). dayShift 0 or +1 (or rarely more). */
function utcHHmmToPakistan(hhmmUtc) {
    if (!hhmmUtc) return null;
    const pkTotal = parseHHmmToMinutes(hhmmUtc) + PK_OFFSET_MINUTES;
    const dayShift = Math.floor(pkTotal / (24 * 60));
    return {
        time: minutesToHHmm(pkTotal),
        dayShift,
    };
}

function shiftWeekdays(days, dayShift) {
    if (!dayShift || !Array.isArray(days) || !days.length) {
        return (days || []).map((d) => String(d).toLowerCase());
    }
    return days.map((d) => {
        const idx = DAY_ORDER.indexOf(String(d).toLowerCase().trim());
        if (idx < 0) return String(d).toLowerCase();
        return DAY_ORDER[(idx + dayShift + 70) % 7];
    });
}

function formatClockLabel(hhmm, zone) {
    if (!hhmm) return null;
    const [h, m] = String(hhmm).split(":").map(Number);
    const hour = Number.isFinite(h) ? h : 0;
    const min = Number.isFinite(m) ? m : 0;
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${String(min).padStart(2, "0")} ${ampm} ${zone}`;
}

function slimScheduleEvent(ev) {
    if (!ev) return null;
    const startPk = utcHHmmToPakistan(ev.startTime);
    const endPk = ev.endTime ? utcHHmmToPakistan(ev.endTime) : null;
    const daysUtc = (ev.days || []).map((d) => String(d).toLowerCase());
    const daysPakistan = shiftWeekdays(daysUtc, startPk?.dayShift || 0);
    const dayChangesInPakistan = (startPk?.dayShift || 0) !== 0;

    return {
        eventId: String(ev._id),
        deviceId: ev.deviceId,
        startTimeUtc: ev.startTime,
        endTimeUtc: ev.endTime || null,
        startTimePakistan: startPk?.time || null,
        endTimePakistan: endPk?.time || null,
        startLabelUtc: formatClockLabel(ev.startTime, "UTC"),
        endLabelUtc: ev.endTime ? formatClockLabel(ev.endTime, "UTC") : null,
        startLabelPakistan: startPk
            ? formatClockLabel(startPk.time, "Pakistan (PKT)")
            : null,
        endLabelPakistan: endPk
            ? formatClockLabel(endPk.time, "Pakistan (PKT)")
            : null,
        daysUtc,
        daysPakistan,
        days: daysUtc,
        dayChangesInPakistan,
        timezoneNote: dayChangesInPakistan
            ? "UTC→Pakistan (+5h) crosses midnight — weekday in Pakistan can be the NEXT day vs UTC days."
            : "Pakistan is UTC+5; same calendar day for this start time.",
        command: ev.command || null,
        setTemperature: ev.setTemperature ?? null,
        status: ev.status,
        isRecurring: !!ev.isRecurring,
        isOvernight: !!ev.isOvernight,
        intervalSeconds: ev.intervalSeconds ?? null,
        createdAt: ev.createdAt || null,
    };
}

function clockContextForAssistant() {
    const now = new Date();
    const fmt = (timeZone) =>
        now.toLocaleString("en-US", {
            timeZone,
            weekday: "long",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });
    return {
        nowUtc: fmt("UTC"),
        nowPakistan: fmt("Asia/Karachi"),
        pakistanOffset: "UTC+5 (PKT)",
        howToSpeakTimes:
            "ALWAYS say times as: (1) UTC first, then (2) Pakistan local. Weekday may differ after +5h (e.g. Thu 19:07 UTC = Fri 12:07 AM Pakistan).",
    };
}

function utcNowClock() {
    const now = new Date();
    const currentTime = `${String(now.getUTCHours()).padStart(2, "0")}:${String(
        now.getUTCMinutes()
    ).padStart(2, "0")}`;
    const currentDay = now
        .toLocaleString("en-US", { weekday: "long", timeZone: "UTC" })
        .toLowerCase();
    return { now, currentTime, currentDay };
}

/**
 * Upcoming trigger fire (triggers have startTime only, no end window).
 */
function getNextTriggerFromList(events = []) {
    const { currentTime, currentDay } = utcNowClock();
    let next = null;

    for (const ev of events) {
        if (String(ev.status || "").toUpperCase() !== "ACTIVE") continue;
        const days = (ev.days || []).map((d) => String(d).toLowerCase());
        const isRecurring = !!ev.isRecurring && days.length > 0;
        if (isRecurring && !days.includes(currentDay)) continue;

        if (currentTime < ev.startTime) {
            if (!next || ev.startTime < next.startTime) next = ev;
        }
    }

    if (!next) return { type: "NO_EVENT", event: null, message: "No upcoming trigger today" };
    return {
        type: "NEXT",
        event: slimScheduleEvent(next),
        isTrigger: true,
        note: "Trigger events fire at startTime. Report UTC then Pakistan (PKT). Weekday may change after +5h.",
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
            scope: "entire_application",
            organizations: orgs.map((o) => ({
                id: String(o._id),
                name: o.name,
                ownerName: o.owner?.name || null,
                ownerEmail: o.owner?.email || null,
            })),
            instructionForAssistant:
                "Admin sees ALL organizations in the app. Answer with the count immediately. Do NOT say admin lacks org data or redirect to subscription usage.",
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
            "Schedules only for category scheduling/trigger (and AC). Monitoring devices cannot have schedules. Write tools exist for org/venue/device/team when the user is allowed. For online/offline use isOnline/connectivity — not raw dbStatus alone (can be stale).",
        alertReminder:
            "For 'which devices have alerts?' do NOT use this list. Call listMyActiveAlerts — Dashboard Alerts panel only shows devices with at least one alert flag true.",
        eventReminder:
            "For schedules/events (upcoming, current, AC setpoint on event, devices with events) call getDeviceEvents, getCurrentOrNextEvent, or listDevicesWithEvents — do NOT guess.",
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

/**
 * Resolve a device the user can access (by id or unique name).
 */
async function resolveAccessibleDevice(user, { deviceId, deviceName } = {}) {
    if (!deviceId && !deviceName) {
        return {
            error: "Provide deviceId (preferred) or deviceName",
        };
    }

    let device = null;
    if (deviceId) {
        device = await Device.findOne({
            deviceId: String(deviceId).trim().toUpperCase(),
        })
            .select("deviceId deviceName deviceType category venue status lastSeen lastUpdateTime")
            .lean();
    } else {
        const venueIds = await getAccessibleVenueIds(user);
        const filter = {
            deviceName: new RegExp(`^${escapeRegex(deviceName)}$`, "i"),
        };
        if (user.role !== "admin") filter.venue = { $in: venueIds };

        const matches = await Device.find(filter)
            .select("deviceId deviceName deviceType category venue status lastSeen lastUpdateTime")
            .lean();

        if (matches.length > 1) {
            return {
                error: "Multiple devices share this name. Ask for deviceId.",
                matches: matches.map((d) => ({
                    deviceId: d.deviceId,
                    deviceName: d.deviceName,
                    deviceType: d.deviceType,
                    category: d.category,
                })),
            };
        }
        device = matches[0] || null;
    }

    if (!device) return { error: "Device not found" };
    const ok = await assertDeviceAccess(user, device);
    if (!ok) return { error: "You do not have access to this device" };
    return { device };
}

function formatScheduleLookup(info) {
    if (!info) {
        return { type: "NO_EVENT", event: null, message: "No schedule data" };
    }
    const base = {
        type: info.type || "NO_EVENT",
        message: info.message || null,
        totalDurationMinutes: info.totalDurationMinutes ?? null,
        totalDurationText: info.totalDurationText ?? null,
        remainingMinutes: info.remainingMinutes ?? null,
        remainingText: info.remainingText ?? null,
        isTrigger: !!info.isTrigger,
        event: slimScheduleEvent(info.event),
    };
    return base;
}

/**
 * List all schedule/trigger events configured on a device (Events section).
 */
async function getDeviceEvents(user, args = {}) {
    const resolved = await resolveAccessibleDevice(user, args);
    if (resolved.error) return resolved;

    const device = resolved.device;
    const statusFilter = String(args.status || "ACTIVE").toUpperCase();
    const wantAll = statusFilter === "ALL";

    if (device.category === "monitoring" && device.deviceType !== "AC") {
        return {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: device.category,
            count: 0,
            events: [],
            message:
                "Monitoring devices do not have ON/OFF schedules. Use getDeviceSnapshot for live readings.",
        };
    }

    if (device.category === "trigger") {
        const filter = { deviceId: device.deviceId };
        if (!wantAll) filter.status = statusFilter;
        const events = await TriggerSchedule.find(filter)
            .sort({ startTime: 1 })
            .lean();
        return {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: "trigger",
            eventKind: "trigger",
            count: events.length,
            events: events.map(slimScheduleEvent),
            clock: clockContextForAssistant(),
            timesAreUtc: true,
            alsoPakistanPkt: true,
            instructionForAssistant:
                "Trigger schedules (startTime only). Say UTC first, then Pakistan (PKT +5) from startTimePakistan/daysPakistan. If dayChangesInPakistan, mention weekday can differ.",
        };
    }

    // scheduling category + AC
    const filter = { deviceId: device.deviceId };
    if (!wantAll) filter.status = statusFilter;
    const events = await Event.find(filter).sort({ startTime: 1 }).lean();
    return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        eventKind: "schedule",
        count: events.length,
        events: events.map(slimScheduleEvent),
        clock: clockContextForAssistant(),
        timesAreUtc: true,
        alsoPakistanPkt: true,
        instructionForAssistant:
            "Scheduling/AC events. For AC ON, include setTemperature. ALWAYS say UTC time/days first, then Pakistan local from *Pakistan fields. Day may change after +5h.",
    };
}

/**
 * Current running window or next upcoming event for one device.
 * Reuses dashboard schedule lookup for scheduling/AC.
 */
async function getCurrentOrNextEvent(user, args = {}) {
    const resolved = await resolveAccessibleDevice(user, args);
    if (resolved.error) return resolved;

    const device = resolved.device;

    if (device.category === "monitoring" && device.deviceType !== "AC") {
        return {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            type: "NO_EVENT",
            event: null,
            message: "Monitoring devices do not have schedules/events.",
        };
    }

    if (device.category === "trigger") {
        const events = await TriggerSchedule.find({
            deviceId: device.deviceId,
            status: "ACTIVE",
        })
            .sort({ startTime: 1 })
            .lean();
        const lookup = getNextTriggerFromList(events);
        return {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: "trigger",
            eventKind: "trigger",
            ...lookup,
            allActiveCount: events.length,
            clock: clockContextForAssistant(),
            timesAreUtc: true,
            alsoPakistanPkt: true,
            instructionForAssistant:
                "NEXT trigger fire. Say UTC first, then Pakistan local from event fields. Day may differ after +5h.",
        };
    }

    const info = await getCurrentOrNextScheduleData(device.deviceId);
    const formatted = formatScheduleLookup(info);
    return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        eventKind: "schedule",
        ...formatted,
        clock: clockContextForAssistant(),
        timesAreUtc: true,
        alsoPakistanPkt: true,
        instructionForAssistant:
            "type=CURRENT running now; type=NEXT upcoming. Say UTC first, then Pakistan (startTimePakistan/daysPakistan). If dayChangesInPakistan, mention weekday change. Include setTemperature for AC.",
    };
}

/**
 * Find devices that have ACTIVE schedules/triggers configured,
 * and/or currently running (CURRENT) schedule windows.
 */
async function listDevicesWithEvents(user, args = {}) {
    const venueIds = await getAccessibleVenueIds(user);
    if (!venueIds.length && user.role !== "admin") {
        return { count: 0, devices: [], message: "No accessible venues/devices" };
    }

    const deviceFilter = {};
    if (user.role !== "admin") deviceFilter.venue = { $in: venueIds };
    if (args.deviceType) {
        deviceFilter.deviceType = String(args.deviceType).toUpperCase();
    }
    if (args.category) {
        deviceFilter.category = String(args.category).toLowerCase().trim();
    }
    if (args.deviceId) {
        deviceFilter.deviceId = String(args.deviceId).trim().toUpperCase();
    }
    if (args.deviceName) {
        deviceFilter.deviceName = new RegExp(escapeRegex(args.deviceName), "i");
    }
    if (args.venueName) {
        const venues = await Venue.find({
            ...(user.role === "admin" ? {} : { _id: { $in: venueIds } }),
            name: new RegExp(escapeRegex(args.venueName), "i"),
        })
            .select("_id")
            .lean();
        deviceFilter.venue = { $in: venues.map((v) => v._id) };
    }

    // Only devices that can have events
    if (!deviceFilter.category && !deviceFilter.deviceType) {
        deviceFilter.$or = [
            { category: "scheduling" },
            { category: "trigger" },
            { deviceType: "AC" },
        ];
    }

    const devices = await Device.find(deviceFilter)
        .populate({
            path: "venue",
            select: "name organization",
            populate: { path: "organization", select: "name" },
        })
        .select(
            "deviceId deviceName deviceType category status lastSeen lastUpdateTime venue"
        )
        .lean();

    if (!devices.length) {
        return { count: 0, devices: [], message: "No scheduling/trigger/AC devices found" };
    }

    const ids = devices.map((d) => d.deviceId);
    const onlyCurrentlyRunning = args.currentlyRunning === true;

    const [scheduleEvents, triggerEvents] = await Promise.all([
        Event.find({ deviceId: { $in: ids }, status: "ACTIVE" }).lean(),
        TriggerSchedule.find({ deviceId: { $in: ids }, status: "ACTIVE" }).lean(),
    ]);

    const schedulesByDevice = new Map();
    for (const ev of scheduleEvents) {
        if (!schedulesByDevice.has(ev.deviceId)) schedulesByDevice.set(ev.deviceId, []);
        schedulesByDevice.get(ev.deviceId).push(ev);
    }
    const triggersByDevice = new Map();
    for (const ev of triggerEvents) {
        if (!triggersByDevice.has(ev.deviceId)) triggersByDevice.set(ev.deviceId, []);
        triggersByDevice.get(ev.deviceId).push(ev);
    }

    const rows = [];
    for (const d of devices) {
        const isTrigger = d.category === "trigger";
        const configured = isTrigger
            ? triggersByDevice.get(d.deviceId) || []
            : schedulesByDevice.get(d.deviceId) || [];

        if (!configured.length) continue;

        let lookup = null;
        if (isTrigger) {
            lookup = getNextTriggerFromList(configured);
        } else {
            lookup = formatScheduleLookup(
                await getCurrentOrNextScheduleData(d.deviceId)
            );
        }

        const isCurrentlyRunning = lookup?.type === "CURRENT";
        if (onlyCurrentlyRunning && !isCurrentlyRunning) continue;

        rows.push({
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            deviceType: d.deviceType,
            category: d.category,
            venueName: d.venue?.name || null,
            organizationName: d.venue?.organization?.name || null,
            ...computeConnectivity(d),
            activeEventCount: configured.length,
            events: configured.map(slimScheduleEvent),
            currentOrNext: lookup,
            hasCurrentlyRunningEvent: isCurrentlyRunning,
        });
    }

    return {
        count: rows.length,
        currentlyRunningOnly: onlyCurrentlyRunning,
        devices: rows,
        clock: clockContextForAssistant(),
        timesAreUtc: true,
        alsoPakistanPkt: true,
        instructionForAssistant:
            "Devices with ACTIVE events. Say UTC times first, then Pakistan local from event *Pakistan fields (day may change +5h). Prefer isOnline over dbStatus. AC setTemperature from events.",
    };
}

/**
 * Historical sensor series (same backend as Dashboard Download Modal).
 * Averages/min/max are computed here — assistant must not invent them.
 */
async function getDeviceSensorHistory(user, args = {}) {
    const resolved = await resolveAccessibleDevice(user, args);
    if (resolved.error) return resolved;

    const device = resolved.device;
    let start;
    let end;

    if (args.start && args.end) {
        start = new Date(args.start);
        end = new Date(args.end);
    } else if (args.lastHours != null || args.lastDays != null) {
        end = new Date();
        const hours =
            args.lastHours != null
                ? Number(args.lastHours)
                : Number(args.lastDays) * 24;
        if (!Number.isFinite(hours) || hours <= 0) {
            return { error: "lastHours / lastDays must be a positive number" };
        }
        start = new Date(end.getTime() - hours * 3600 * 1000);
    } else {
        end = new Date();
        start = new Date(end.getTime() - 24 * 3600 * 1000);
    }

    // Single calendar day: if only start given as date-like, expand to full day
    // (already handled when model passes start+end of day)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { error: "Invalid start/end date" };
    }
    if (end < start) return { error: "end must be after start" };

    // Default: return rows like Download Modal. Use summary-only only when asked for averages.
    const mode = String(args.mode || "both").toLowerCase();
    const wantRows = mode !== "summary";
    const maxRows = wantRows
        ? Math.min(Math.max(parseInt(args.maxRows, 10) || 500, 1), 500)
        : null;

    let intervalValue =
        args.intervalValue != null && String(args.intervalValue).trim() !== ""
            ? args.intervalValue
            : undefined;
    let intervalUnit = args.intervalUnit
        ? String(args.intervalUnit).toLowerCase()
        : undefined;

    // Only auto-bucket for SUMMARY on LONG ranges (never for listing rows / no-interval asks).
    // Do NOT auto-interval a single day — that diverges from Download Modal raw rows.
    let autoInterval = false;
    if (
        mode === "summary" &&
        (intervalValue == null || String(intervalValue).trim() === "") &&
        !intervalUnit
    ) {
        const spanMs = end.getTime() - start.getTime();
        if (spanMs > 7 * 86400000) {
            intervalValue = 4;
            intervalUnit = "h";
            autoInterval = true;
        } else if (spanMs > 2 * 86400000) {
            intervalValue = 1;
            intervalUnit = "h";
            autoInterval = true;
        }
    }

    console.log("[agent:getDeviceSensorHistory] request", {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        mode,
        start: start.toISOString(),
        end: end.toISOString(),
        intervalValue: intervalValue ?? null,
        intervalUnit: intervalUnit ?? null,
        autoInterval,
        wantRows,
        maxRows,
        args,
    });

    const result = await fetchSensorHistory({
        deviceId: device.deviceId,
        start,
        end,
        intervalValue,
        intervalUnit,
        includeSummary: true,
        // Listing readings: do not subsample unless over maxRows
        maxRows: wantRows ? maxRows : null,
    });

    console.log("[agent:getDeviceSensorHistory] result", {
        ok: result.ok,
        deviceId: result.deviceId || device.deviceId,
        count: result.count,
        returnedRowCount: result.returnedRowCount,
        truncated: result.truncated,
        interval: result.interval,
        historicalStorageAvailable: result.historicalStorageAvailable,
        message: result.message,
        firstRow: result.rows?.[0],
        lastRow: result.rows?.length
            ? result.rows[result.rows.length - 1]
            : undefined,
    });

    if (!result.ok && result.historicalStorageAvailable === false) {
        return {
            historicalStorageAvailable: false,
            deviceId: result.deviceId || device.deviceId,
            deviceName: result.deviceName || device.deviceName,
            deviceType: result.deviceType || device.deviceType,
            message: result.message,
            hintForAssistant: result.hintForAssistant,
            suggestion: "Call getDeviceSnapshot for the latest live reading.",
        };
    }

    if (!result.ok) {
        return { error: result.message || "Failed to fetch sensor history" };
    }

    const base = {
        historicalStorageAvailable: true,
        deviceId: result.deviceId,
        deviceName: result.deviceName,
        deviceType: result.deviceType,
        range: { start: result.start, end: result.end },
        interval: result.interval,
        autoIntervalApplied: autoInterval || false,
        fields: result.fields,
        pointCount: result.count,
        summary: result.summary,
        totalUnitsKWh: result.totalUnits,
    };

    if (!wantRows) {
        return {
            ...base,
            instructionForAssistant:
                "Use summary averages/min/max (server-computed). pointCount is number of points used. If 0, say no data. Never invent readings.",
        };
    }

    return {
        ...base,
        rows: result.rows,
        sampleRows: result.rows,
        truncated: result.truncated,
        returnedRowCount: result.returnedRowCount,
        instructionForAssistant:
            `You MUST report ALL ${result.returnedRowCount ?? result.rows?.length ?? 0} returned rows (or clearly say count=${result.count}). Do not say there are only 2 if returnedRowCount is higher. No interval was applied unless interval/autoIntervalApplied is set. Never invent or drop readings.`,
    };
}

async function computeManagerUsageStats(managerId, plan) {
    if (!plan) {
        return {
            error: "No subscription plan on this manager account",
        };
    }

    const usedOrganizations = await Organization.countDocuments({ owner: managerId });
    const orgIds = (
        await Organization.find({ owner: managerId }).select("_id").lean()
    ).map((o) => o._id);
    const usedVenues = await Venue.countDocuments({
        organization: { $in: orgIds },
    });
    const venueIds = (
        await Venue.find({ organization: { $in: orgIds } }).select("_id").lean()
    ).map((v) => v._id);
    const usedDevices = await Device.countDocuments({ venue: { $in: venueIds } });
    const usedUsers = await User.countDocuments({
        creatorId: managerId,
        role: "user",
    });

    const maxUsers = plan.maxUsers || 10;
    const usage = {
        organizations: {
            used: usedOrganizations,
            total: plan.maxOrganizations,
            remaining: Math.max(0, plan.maxOrganizations - usedOrganizations),
            atLimit: usedOrganizations >= plan.maxOrganizations,
        },
        venues: {
            used: usedVenues,
            total: plan.maxVenues,
            remaining: Math.max(0, plan.maxVenues - usedVenues),
            atLimit: usedVenues >= plan.maxVenues,
        },
        devices: {
            used: usedDevices,
            total: plan.maxDevices,
            remaining: Math.max(0, plan.maxDevices - usedDevices),
            atLimit: usedDevices >= plan.maxDevices,
        },
        users: {
            used: usedUsers,
            total: maxUsers,
            remaining: Math.max(0, maxUsers - usedUsers),
            atLimit: usedUsers >= maxUsers,
        },
    };

    const limitsReached = [];
    if (usage.organizations.atLimit) limitsReached.push("organizations");
    if (usage.venues.atLimit) limitsReached.push("venues");
    if (usage.devices.atLimit) limitsReached.push("devices");
    if (usage.users.atLimit) limitsReached.push("users");

    return { usage, limitsReached };
}

/**
 * Admin only: all managers with plan + usage/limits (same view as Admin → Managers).
 */
async function listAllManagers(user, args = {}) {
    if (user.role !== "admin") {
        return {
            error: "Only admins can list all managers. Managers should use listMyTeamMembers for their sub-users.",
            count: 0,
            managers: [],
        };
    }

    const planType = args.planType
        ? String(args.planType).toLowerCase().trim()
        : null;
    const atLimit = args.atLimit
        ? String(args.atLimit).toLowerCase().trim()
        : null;
    const managerEmail = args.managerEmail
        ? String(args.managerEmail).toLowerCase().trim()
        : null;
    const managerName = args.managerName
        ? String(args.managerName).trim()
        : null;
    const isActive =
        args.isActive === true || args.isActive === "true"
            ? true
            : args.isActive === false || args.isActive === "false"
              ? false
              : null;

    const filter = { role: "manager" };
    if (managerEmail) filter.email = managerEmail;
    if (managerName) filter.name = new RegExp(escapeRegex(managerName), "i");
    if (isActive !== null) filter.isActive = isActive;

    const managers = await User.find(filter)
        .select("name email isActive currentSubscription createdAt")
        .populate({
            path: "currentSubscription",
            populate: {
                path: "plan",
                select:
                    "name type price durationDays maxOrganizations maxVenues maxDevices maxUsers",
            },
        })
        .sort({ createdAt: -1 })
        .lean();

    const rows = [];
    for (const manager of managers) {
        const sub = manager.currentSubscription;
        const plan = sub?.plan || null;

        if (planType && (!plan || String(plan.type).toLowerCase() !== planType)) {
            continue;
        }

        const usageResult = plan
            ? await computeManagerUsageStats(manager._id, plan)
            : { usage: null, limitsReached: [], error: "No active plan" };

        if (atLimit) {
            const key = atLimit === "organization" ? "organizations" : atLimit;
            if (!usageResult.limitsReached?.includes(key)) continue;
        }

        rows.push({
            id: String(manager._id),
            name: manager.name,
            email: manager.email,
            isActive: manager.isActive !== false,
            subscription: plan
                ? {
                      planName: plan.name,
                      planType: plan.type,
                      status: sub?.status || null,
                      isActive: sub?.status === "active",
                  }
                : null,
            usage: usageResult.usage || null,
            limitsReached: usageResult.limitsReached || [],
            teamUsersCount: usageResult.usage?.users?.used ?? null,
        });
    }

    const activeCount = rows.filter((m) => m.isActive).length;

    return {
        count: rows.length,
        totalManagersInSystem: rows.length,
        activeManagers: activeCount,
        inactiveManagers: rows.length - activeCount,
        managers: rows,
        instructionForAssistant:
            "Admin CAN view all managers, their plans (free/basic/premium/custom), and which limits are full (organizations/venues/devices/users). Never say admin cannot see managers.",
        filtersApplied: {
            planType: planType || null,
            atLimit: atLimit || null,
            managerEmail: managerEmail || null,
            managerName: managerName || null,
            isActive,
        },
    };
}

async function listMyTeamMembers(user) {
    if (user.role === "user") {
        return {
            error: "Only managers can list their team members (sub-users).",
            count: 0,
            members: [],
        };
    }

    if (user.role === "admin") {
        return {
            error:
                "Admin does not have 'team members' under their own account. Use listAllManagers to see every manager and their subscription/limits.",
            count: 0,
            members: [],
            hint: "Call listAllManagers for manager count, premium plans, and limit status.",
        };
    }

    const managerId = user._id;

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
    if (user.role === "admin") {
        const count = await User.countDocuments({ role: "manager" });
        return {
            count,
            role: "admin",
            note: "This is the total number of managers on the platform. Use listAllManagers for plan and limit details.",
        };
    }

    if (user.role !== "manager") {
        return {
            error: "Only managers can count their team members (sub-users).",
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
    if (user.role === "admin") {
        return {
            error:
                "Admin account has no personal subscription usage. Use listAllManagers to see each manager's plan and limits.",
        };
    }

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

/**
 * Admin: total orgs, venues, devices, managers in one call.
 * Use for "how many organizations in my application?"
 */
async function getPlatformOverview(user) {
    if (user.role !== "admin") {
        return {
            error:
                "Platform-wide totals are for admin only. Use listMyOrganizations / listMyVenues / listMyDevices for your account scope.",
        };
    }

    const [organizations, venues, devices, managers] = await Promise.all([
        Organization.countDocuments({}),
        Venue.countDocuments({}),
        Device.countDocuments({}),
        User.countDocuments({ role: "manager" }),
    ]);

    const orgList = await Organization.find({})
        .select("name")
        .sort({ name: 1 })
        .lean();

    return {
        scope: "entire_application",
        totals: {
            organizations,
            venues,
            devices,
            managers,
        },
        organizationNames: orgList.map((o) => o.name),
        instructionForAssistant:
            "Give the user the totals immediately. Admin has full read access to all orgs/venues/devices/managers. Never ask 'would you like me to provide that?' — just answer.",
    };
}

const TOOL_IMPL = {
    listMyOrganizations: (user, args) => listMyOrganizations(user, args),
    listMyVenues: (user, args) => listMyVenues(user, args),
    listMyDevices: (user, args) => listMyDevices(user, args),
    listMyActiveAlerts: (user, args) => listMyActiveAlerts(user, args),
    getDeviceSnapshot: (user, args) => getDeviceSnapshot(user, args),
    getDeviceSensorHistory: (user, args) => getDeviceSensorHistory(user, args),
    getDeviceEvents: (user, args) => getDeviceEvents(user, args),
    getCurrentOrNextEvent: (user, args) => getCurrentOrNextEvent(user, args),
    listDevicesWithEvents: (user, args) => listDevicesWithEvents(user, args),
    listMyTeamMembers: (user, args) => listMyTeamMembers(user, args),
    countMyTeamMembers: (user, args) => countMyTeamMembers(user, args),
    listAllManagers: (user, args) => listAllManagers(user, args),
    getPlatformOverview: (user, args) => getPlatformOverview(user, args),
    getMySubscriptionUsage: (user, args) => getMySubscriptionUsage(user, args),
    listSubscriptionPlans: (user, args) => listSubscriptionPlans(user, args),
    searchHelpDocs: (user, args) => searchHelpDocs(user, args),
    ...MUTATION_TOOL_IMPL,
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
            name: "getPlatformOverview",
            description:
                "ADMIN ONLY. Total counts across the ENTIRE application: organizations, venues, devices, managers. REQUIRED when admin asks 'how many organizations/venues/devices in my application?' or platform totals. Returns count + org names.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyOrganizations",
            description:
                "List organizations the user can access. ADMIN: ALL organizations in the entire app (with owner). Manager: their orgs. REQUIRED for admin org count — NOT getMySubscriptionUsage.",
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
                "READ-ONLY: Get one device's latest stored live metrics and settings. Prefer deviceId. Includes canHaveSchedules and isOnline (prefer over dbStatus). Does not create or change anything.",
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
            name: "getDeviceEvents",
            description:
                "REQUIRED for listing schedules/events on a device (Events section): AC schedules, scheduling-category devices, or trigger schedules. Returns start/end times (UTC), days, command, and AC setTemperature when set. Prefer deviceId. status defaults to ACTIVE; pass ALL for inactive too.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    status: {
                        type: "string",
                        description: "ACTIVE (default) | INACTIVE | ALL",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getCurrentOrNextEvent",
            description:
                "REQUIRED for 'upcoming schedule/event', 'currently running event', or 'AC event pe temperature kya set hai' on ONE device. Returns type CURRENT|NEXT|NO_EVENT with event details (including setTemperature for AC). Prefer deviceId. Reuses dashboard schedule logic.",
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
            name: "listDevicesWithEvents",
            description:
                "REQUIRED for 'kis devices par event/schedule lagi hai?', 'currently running events', AC/scheduling/trigger overview. Lists accessible devices that have ACTIVE events. Set currentlyRunning=true to only devices with a CURRENT schedule window. Optional filters: deviceType, category, deviceName, venueName, deviceId.",
            parameters: {
                type: "object",
                properties: {
                    currentlyRunning: {
                        type: "boolean",
                        description:
                            "If true, only devices whose schedule window is CURRENTLY active",
                    },
                    deviceType: { type: "string" },
                    category: {
                        type: "string",
                        description: "scheduling | trigger",
                    },
                    deviceName: { type: "string" },
                    deviceId: { type: "string" },
                    venueName: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "getDeviceSensorHistory",
            description:
                "READ-ONLY historical sensor data — SAME query as Dashboard Download Modal. For a single day with NO interval: pass start+end for that day, omit intervalValue/intervalUnit, use mode=both (default). That returns every raw row (pointCount/returnedRowCount must match Download Modal). For averages only use mode=summary. For buckets e.g. every 4 hours pass intervalValue=4 and intervalUnit=h. Prefer deviceId. If historicalStorageAvailable=false, use getDeviceSnapshot for live only.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    start: {
                        type: "string",
                        description:
                            "ISO start (for Aug 6 2026 single day use 2026-08-06T00:00:00.000Z or local day start)",
                    },
                    end: {
                        type: "string",
                        description:
                            "ISO end (for that single day use end of day). Required with start.",
                    },
                    lastDays: {
                        type: "number",
                        description: "Relative range ending now, e.g. 7 for last week",
                    },
                    lastHours: {
                        type: "number",
                        description: "Relative range ending now in hours",
                    },
                    intervalValue: {
                        type: "number",
                        description:
                            "ONLY if user asks for an interval/bucket. Omit entirely when user wants all raw readings.",
                    },
                    intervalUnit: {
                        type: "string",
                        description: "m | h | d — only with intervalValue",
                    },
                    mode: {
                        type: "string",
                        description:
                            "both (default, returns all rows + summary) | samples | summary (averages only)",
                    },
                    maxRows: {
                        type: "number",
                        description: "Cap rows (default 500). Raise only if needed.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listAllManagers",
            description:
                "ADMIN ONLY. List all managers on the platform with subscription plan (free/basic/premium/custom), active/inactive status, usage vs limits (orgs/venues/devices/team users), and which limits are full. Use for: 'kitne managers hain?', 'premium plan wale managers', 'kis manager ki org limit full hai?'. Optional filters: planType, atLimit (organizations|venues|devices|users), managerEmail, managerName, isActive.",
            parameters: {
                type: "object",
                properties: {
                    planType: {
                        type: "string",
                        description: "free | basic | premium | custom",
                    },
                    atLimit: {
                        type: "string",
                        description:
                            "Filter managers who hit limit: organizations | venues | devices | users",
                    },
                    managerEmail: { type: "string" },
                    managerName: { type: "string" },
                    isActive: {
                        type: "boolean",
                        description: "true = active managers only, false = inactive only",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listMyTeamMembers",
            description:
                "For MANAGERS only: list their sub-users (name, email, permission, venues). Admins must use listAllManagers instead.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "countMyTeamMembers",
            description:
                "For managers: count sub-users under them. For admin: total manager count on platform (use listAllManagers for details).",
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
                "REQUIRED for how-to UI questions: OTA (admin), Plan Management, device rename, permissions, admin flows. Admin OTA → search 'admin OTA management upload firmware start OTA'. Never guess OTA steps — search first.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" },
                },
                required: ["query"],
            },
        },
    },
    ...MUTATION_AGENT_TOOLS,
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
    getDeviceSensorHistory,
    getDeviceEvents,
    getCurrentOrNextEvent,
    listDevicesWithEvents,
    listMyTeamMembers,
    countMyTeamMembers,
    listAllManagers,
    getPlatformOverview,
    getMySubscriptionUsage,
    listSubscriptionPlans,
    searchHelpDocs,
};
