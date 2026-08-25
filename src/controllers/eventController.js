// src/controllers/eventController.js
const Event = require("../models/eventModel");
const Device = require("../models/deviceModel");
const { generateCron, isOvernight } = require("../queues/cronHelper");
const { addScheduleJob, removeScheduleJob, removeJobsForEventId } = require("../queues/scheduleService");
const { publishCommand } = require("../mqtt/commandPublisher");
const scheduleQueue = require("../queues/scheduleQueue");
const { reconcileMissedCommands } = require("../services/reconciliationService");
const {
    getCurrentOrNextScheduleData,
} = require("../services/scheduleLookupService");

/** Push CURRENT/NEXT (or NO_EVENT) to dashboard cards — does not wait for ESP status. */
const emitDeviceScheduleUpdate = async (deviceId, reason = "schedule_mutation") => {
    if (!deviceId || !global.io) return;
    try {
        const eventData = await getCurrentOrNextScheduleData(deviceId);
        global.io.emit(`device/${deviceId}/schedule`, {
            ...eventData,
        });
        console.log(
            `[SCHEDULE-DEBUG][EMIT] device=${deviceId} reason=${reason} ` +
                `type=${eventData?.type || "?"} eventId=${eventData?.event?._id || "none"}`
        );
    } catch (err) {
        console.error(`[SCHEDULE-DEBUG][EMIT] failed device=${deviceId}:`, err.message);
    }
};

/**
 * Core schedule-creation logic — the single source of truth shared by the HTTP
 * controller (POST /api/event/create) and the ECO assistant tool (createEvent).
 * Contains all validation, conflict detection, Event.create, and BullMQ start/end
 * job enqueue. Returns a normalized result:
 *   { status, ok, schedule, device, scheduleType, body }
 * where `body` is the EXACT JSON payload the HTTP endpoint returns (so the
 * controller stays behavior-identical) and the extra fields are for programmatic
 * callers (the agent tool). Throws only on unexpected (DB) errors — callers wrap
 * in try/catch. NOTE: this does NOT check that `user` may access the device;
 * the HTTP route enforces that via middleware and the agent tool enforces
 * ownership before calling this.
 */
const createScheduleForDevice = async ({
    user,
    deviceId,
    startTime,
    endTime,
    days = [],
    command = "ON",
    setTemperature,
}) => {
    if (!deviceId || !startTime || !endTime) {
        return {
            status: 400,
            ok: false,
            schedule: null,
            device: null,
            scheduleType: null,
            body: { success: false, message: "deviceId, startTime, endTime are required" },
        };
    }

    const device = await Device.findOne({ deviceId });
    if (!device || device.category !== "scheduling") {
        return {
            status: 403,
            ok: false,
            schedule: null,
            device: device || null,
            scheduleType: null,
            body: { success: false, message: "Invalid or non-scheduling device" },
        };
    }

    const isAc = device.deviceType === "AC";
    let eventCommand = String(command || "ON").toUpperCase().trim();

    if (isAc) {
        if (!["ON", "OFF"].includes(eventCommand)) {
            return {
                status: 400,
                ok: false,
                schedule: null,
                device,
                scheduleType: null,
                body: { success: false, message: "AC event command must be ON or OFF" },
            };
        }
        if (eventCommand === "ON") {
            const temp = Number(setTemperature);
            if (!Number.isFinite(temp)) {
                return {
                    status: 400,
                    ok: false,
                    schedule: null,
                    device,
                    scheduleType: null,
                    body: {
                        success: false,
                        message: "setTemperature is required when AC event command is ON",
                    },
                };
            }
        }
    } else {
        eventCommand = "ON";
    }

    const overnight = isOvernight(startTime, endTime);
    const isRecurring = days.length > 0;

    // Per-device: block overlapping ACTIVE schedules (same days + overlapping time)
    const existing = await Event.find({ deviceId, status: "ACTIVE" }).lean();
    const conflict = findScheduleConflict(existing, {
        startTime,
        endTime,
        days,
        isOvernight: overnight,
        isRecurring,
    });
    if (conflict) {
        return {
            status: 409,
            ok: false,
            schedule: null,
            device,
            scheduleType: null,
            body: {
                success: false,
                message:
                    "An event already exists for this device on overlapping day(s) and time. Choose a different time or days.",
                conflict: {
                    _id: conflict._id,
                    startTime: conflict.startTime,
                    endTime: conflict.endTime,
                    days: conflict.days,
                },
            },
        };
    }

    let startCron, endCron, scheduleType;

    if (isRecurring) {
        // ==================== RECURRING SCHEDULE ====================
        scheduleType = "recurring";
        startCron = generateCron(startTime, days);

        let endDays = overnight ? shiftDays(days) : [...days];
        endCron = generateCron(endTime, endDays);

    } else {
        // ==================== ONE-TIME SCHEDULE (Today or Overnight) ====================
        scheduleType = "one-time";

        const now = new Date();
        const currentUTCDate = now.toISOString().split('T')[0]; // YYYY-MM-DD

        // Use UTC day
        const utcDayName = now.toLocaleString('en-US', {
            weekday: 'long',
            timeZone: 'UTC'
        }).toLowerCase();

        startCron = generateCron(startTime, [utcDayName]);

        if (overnight) {
            const nextDayName = getNextDayName(utcDayName);
            endCron = generateCron(endTime, [nextDayName]);
            console.log(`🌙 Overnight one-time schedule: ${utcDayName} ${startTime} → ${nextDayName} ${endTime}`);
        } else {
            endCron = generateCron(endTime, [utcDayName]);
        }
    }

    const schedule = await Event.create({
        deviceId,
        startTime,
        endTime,
        days: isRecurring ? days : [],
        command: eventCommand,
        setTemperature: isAc && eventCommand === "ON" ? Number(setTemperature) : null,
        isOvernight: overnight,
        isRecurring,
        startCron,
        endCron,
        createdBy: user._id,
        status: "ACTIVE"
    });

    const daysLabel = isRecurring && days.length
        ? JSON.stringify(days.map((d) => String(d).toLowerCase()))
        : "[one-time/today]";
    console.log(
        `[SCHEDULE-DEBUG][CREATE] Event UTC ${startTime}-${endTime} ` +
            `days=${daysLabel} overnight=${overnight} ` +
            `command=${eventCommand}` +
            (isAc && eventCommand === "ON" && schedule.setTemperature != null
                ? ` setTemperature=${schedule.setTemperature}`
                : "") +
            ` device=${deviceId} eventId=${schedule._id} ` +
            `startCron="${startCron}" endCron="${endCron}"`
    );

    const startJobId = `schedule-start-${deviceId}-${schedule._id.toString()}`;
    const endJobId = `schedule-end-${deviceId}-${schedule._id.toString()}`;

    const jobMeta = {
        deviceId,
        startTime,
        endTime,
        days: isRecurring ? days : [],
        eventId: schedule._id.toString(),
        isRecurring,
        setTemperature: schedule.setTemperature,
    };

    // Start: AC uses event command (ON/OFF); THD/others always ON at window start
    await addScheduleJob(
        startJobId,
        { ...jobMeta, command: isAc ? eventCommand : "ON", type: "start" },
        startCron
    );
    // End: always OFF at window end (worker skips end for AC OFF-only events)
    await addScheduleJob(
        endJobId,
        { ...jobMeta, command: "OFF", type: "end" },
        endCron
    );

    await emitDeviceScheduleUpdate(deviceId, "event_create");

    // If create lands inside an active window (incl. overnight), force apply now.
    // Immediate trigger in addScheduleJob usually covers this; reconcile is a
    // safety net when that path misses (overnight edge) or device was already ON.
    try {
        const live = await getCurrentOrNextScheduleData(deviceId);
        if (live?.type === "CURRENT" && live?.event) {
            console.log(
                `[SCHEDULE-DEBUG][CREATE] CURRENT window → reconcile device=${deviceId} ` +
                    `command=${live.event.command || "ON"} eventId=${live.event._id}`
            );
            await reconcileMissedCommands(deviceId, {
                reason: "event_create_inside_window",
            });
        }
    } catch (err) {
        console.error(
            `[SCHEDULE-DEBUG][CREATE] reconcile after create failed device=${deviceId}:`,
            err.message
        );
    }

    return {
        status: 201,
        ok: true,
        schedule,
        device,
        scheduleType,
        body: {
            success: true,
            message: `${scheduleType} schedule created successfully`,
            schedule,
            type: scheduleType,
        },
    };
};

const createSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, endTime, days = [], command = "ON", setTemperature } = req.body;

        const result = await createScheduleForDevice({
            user: req.user,
            deviceId,
            startTime,
            endTime,
            days,
            command,
            setTemperature,
        });

        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Create Schedule Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Helper Functions
const getNextDayName = (day) => {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const index = days.indexOf(day);
    return days[(index + 1) % 7];
};

const shiftDays = (days) => {
    const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return days.map(d => {
        const idx = dayOrder.indexOf(d.toLowerCase().trim());
        return dayOrder[(idx + 1) % 7];
    });
};

const toMinutes = (hhmm = "") => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * Expand a schedule into same-day minute segments (handles overnight → next day).
 * One-time (no days) uses today's UTC weekday.
 */
const buildTimeSegments = ({ startTime, endTime, days = [], isOvernight: overnight, isRecurring }) => {
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    let dayList = (days || []).map((d) => String(d).toLowerCase().trim()).filter(Boolean);

    if (!isRecurring || dayList.length === 0) {
        const todayUtc = new Date()
            .toLocaleString("en-US", { weekday: "long", timeZone: "UTC" })
            .toLowerCase();
        dayList = [todayUtc];
    }

    const segments = [];
    for (const day of dayList) {
        if (overnight) {
            segments.push({ day, start, end: 24 * 60 });
            segments.push({ day: getNextDayName(day), start: 0, end });
        } else {
            segments.push({ day, start, end });
        }
    }
    return segments;
};

const segmentsOverlap = (a, b) =>
    a.day === b.day && a.start < b.end && b.start < a.end;

/** Returns the conflicting existing event, or null */
const findScheduleConflict = (existingEvents, candidate) => {
    const candSegs = buildTimeSegments(candidate);
    for (const ev of existingEvents) {
        const evSegs = buildTimeSegments({
            startTime: ev.startTime,
            endTime: ev.endTime,
            days: ev.days || [],
            isOvernight: !!ev.isOvernight,
            isRecurring: !!ev.isRecurring && (ev.days || []).length > 0,
        });
        const hits = candSegs.some((c) => evSegs.some((e) => segmentsOverlap(c, e)));
        if (hits) return ev;
    }
    return null;
};

const manualToggle = async (req, res) => {
    try {
        const { deviceId, eventId } = req.body;
        const user = req.user;

        if (!deviceId) {
            return res.status(400).json({ success: false, message: "deviceId is required" });
        }

        const device = await Device.findOne({ deviceId });
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        if (device.status !== "online") {
            return res.status(400).json({
                success: false,
                message: "Device is offline. Cannot send command."
            });
        }

        // AC: hard-block On/Off while a CURRENT ACTIVE schedule window is running
        if (device.deviceType === "AC") {
            const scheduleInfo = await getCurrentOrNextScheduleData(deviceId);
            if (scheduleInfo?.type === "CURRENT" && scheduleInfo?.event) {
                return res.status(400).json({
                    success: false,
                    message: "Disable active schedule first before manually toggling AC",
                    currentEvent: scheduleInfo.event,
                });
            }
        }

        const newCommand = device.state === "ON" ? "OFF" : "ON";

        console.log(`🔧 Manual Toggle: ${device.state} → ${newCommand} for ${deviceId}`);

        // AC: Ackit apply keys (power.on / power.off + optional temp)
        let success;
        if (device.deviceType === "AC") {
            const { publishAcMqttCommand, emitAcDeviceLive } = require("../services/acScheduleHelper");

            const mqttResult = await publishAcMqttCommand(
                device,
                newCommand,
                newCommand === "ON" ? device.setTemperature : null
            );
            if (!mqttResult?.ok) {
                return res.status(mqttResult?.status || 500).json({
                    success: false,
                    message: mqttResult?.message || "Failed to send command",
                });
            }
            device.state = newCommand;
            device.lastUpdateTime = new Date();
            await device.save();
            emitAcDeviceLive(device);
        } else {
            success = publishCommand(deviceId, {
                type: "COMMAND",
                command: newCommand,
                isManual: true,
                timestamp: new Date().toISOString()
            });

            if (!success) {
                return res.status(500).json({ success: false, message: "Failed to send command" });
            }

            device.state = newCommand;
            await device.save();

            if (global.io) {
                global.io.emit(`device/${deviceId}`, {
                    deviceId: device.deviceId,
                    deviceName: device.deviceName,
                    deviceType: device.deviceType,
                    category: device.category,
                    state: device.state,
                    timestamp: new Date(),
                });
            }
        }

        // ==================== MANUAL OVERRIDE LOGIC (Only if eventId is provided) ====================
        // Note: AC hard-block above means this override path is for non-AC / no CURRENT window
        if (eventId) {
            const activeSchedule = await Event.findOne({
                _id: eventId,
                deviceId: deviceId,
                status: "ACTIVE"
            });

            if (activeSchedule) {
                const today = new Date().toISOString().split('T')[0];

                activeSchedule.manualOverride = true;
                activeSchedule.overrideDate = today;
                await activeSchedule.save();

                console.log(`🚫 Manual override activated for schedule ${activeSchedule._id} today`);
            } else {
                console.warn(`⚠️ Event ${eventId} not found or not active for manual override`);
            }
        } else {
            console.log(`ℹ️ No eventId provided → Only device state toggled (no manual override)`);
        }

        return res.json({
            success: true,
            message: `Device manually turned ${newCommand}`,
            newState: newCommand,
            deviceId,
            eventOverrideApplied: !!eventId
        });

    } catch (error) {
        console.error("Manual Toggle Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getEventsByDevice = async (req, res) => {
    try {
        const { deviceId } = req.params;

        const events = await Event.find({ deviceId })
            .sort({ createdAt: -1 })
            .select("-__v");

        // Always 200 with array — empty list is valid (e.g. after deleting last event)
        return res.json({
            success: true,
            count: events.length,
            events
        });
    } catch (error) {
        console.error("Get Events Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==================== TOGGLE ACTIVE/INACTIVE (Recurring Only) ====================
const toggleScheduleStatusForEvent = async ({ id, status }) => {
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return {
            status: 400,
            ok: false,
            schedule: null,
            body: { success: false, message: "Status must be ACTIVE or INACTIVE" },
        };
    }

    const schedule = await Event.findById(id);
    if (!schedule) {
        return {
            status: 404,
            ok: false,
            schedule: null,
            body: { success: false, message: "Schedule not found" },
        };
    }

    if (!schedule.isRecurring) {
        return {
            status: 400,
            ok: false,
            schedule,
            body: {
                success: false,
                message: "Only recurring schedules can be toggled",
            },
        };
    }

    schedule.status = status;
    await schedule.save();

    if (status === "ACTIVE") {
        console.log(`🔄 Schedule activated → Running reconciliation for device ${schedule.deviceId}`);
        await reconcileMissedCommands(schedule.deviceId, {
            reason: "schedule_toggled_active",
        });
    }

    await emitDeviceScheduleUpdate(schedule.deviceId, `event_toggle_${status.toLowerCase()}`);

    return {
        status: 200,
        ok: true,
        schedule,
        body: {
            success: true,
            message: `Schedule ${status.toLowerCase()} successfully`,
            schedule,
        },
    };
};

const toggleScheduleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const result = await toggleScheduleStatusForEvent({ id, status });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Toggle Schedule Status Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==================== DELETE SCHEDULE + REMOVE FROM REDIS ====================
const deleteScheduleForEvent = async ({ id }) => {
    const schedule = await Event.findById(id);
    if (!schedule) {
        return {
            status: 404,
            ok: false,
            schedule: null,
            body: { success: false, message: "Schedule not found" },
        };
    }

    const startJobId = `schedule-start-${schedule.deviceId}-${schedule._id}`;
    const endJobId = `schedule-end-${schedule.deviceId}-${schedule._id}`;

    await removeScheduleJob(startJobId);
    await removeScheduleJob(endJobId);
    await removeJobsForEventId(schedule._id);
    const deviceId = schedule.deviceId;
    await Event.findByIdAndDelete(id);

    await emitDeviceScheduleUpdate(deviceId, "event_delete");

    return {
        status: 200,
        ok: true,
        schedule,
        body: {
            success: true,
            message: "Schedule deleted successfully and removed from queue",
        },
    };
};

const deleteSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await deleteScheduleForEvent({ id });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Delete Schedule Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    createSchedule,
    createScheduleForDevice,
    manualToggle,
    getEventsByDevice,
    toggleScheduleStatus,
    toggleScheduleStatusForEvent,
    deleteSchedule,
    deleteScheduleForEvent,
    getCurrentOrNextScheduleData,
};