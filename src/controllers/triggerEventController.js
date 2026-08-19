// controllers/triggerEventController.js
const TriggerSchedule = require("../models/triggerEventModel");
const Device = require("../models/deviceModel");
const { generateCron } = require("../queues/cronHelper");
const { addScheduleJob, removeScheduleJob, removeJobsForEventId } = require("../queues/scheduleService");

/**
 * Core trigger-event creation — shared by POST /api/trigger/create-event
 * and Eco createEvent (trigger devices: startTime + days only, no end window).
 */
const createTriggerScheduleForDevice = async ({
    user,
    deviceId,
    startTime,
    days = [],
}) => {
    if (!deviceId || !startTime) {
        return {
            status: 400,
            ok: false,
            schedule: null,
            device: null,
            scheduleType: null,
            body: {
                success: false,
                message: "deviceId and startTime are required",
            },
        };
    }

    const device = await Device.findOne({ deviceId });
    if (!device || device.category !== "trigger") {
        return {
            status: 403,
            ok: false,
            schedule: null,
            device: device || null,
            scheduleType: null,
            body: {
                success: false,
                message: "Invalid or non-trigger device",
            },
        };
    }

    const intervalSeconds = device.interval || 5;
    const isRecurring = days.length > 0;
    const scheduleType = isRecurring ? "recurring" : "one-time";

    let startCron = null;

    if (isRecurring) {
        startCron = generateCron(startTime, days);
        console.log(`🔄 Recurring Trigger Schedule: ${startTime} every ${days.join(", ")}`);
    } else {
        console.log(`📅 One-time Trigger Schedule: ${startTime}`);
    }

    const schedule = await TriggerSchedule.create({
        deviceId,
        startTime,
        days: isRecurring ? days : [],
        intervalSeconds,
        command: "ON",
        createdBy: user._id,
        status: "ACTIVE",
        isRecurring,
        startCron,
    });

    const startJobId = `trigger-start-${deviceId}-${schedule._id.toString()}`;

    if (isRecurring) {
        await addScheduleJob(
            startJobId,
            {
                deviceId,
                command: "ON",
                type: "start",
                eventId: schedule._id.toString(),
                isRecurring: true,
            },
            startCron
        );
    } else {
        const now = new Date();
        const [hour, minute] = startTime.split(":").map(Number);

        const startDate = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                hour,
                minute
            )
        );

        const delayMs = Math.max(0, startDate.getTime() - now.getTime());

        await addScheduleJob(
            startJobId,
            {
                deviceId,
                command: "ON",
                type: "start",
                eventId: schedule._id.toString(),
                isRecurring: false,
            },
            null,
            delayMs
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
            message: `${isRecurring ? "Recurring" : "One-time"} trigger schedule created successfully`,
            schedule,
        },
    };
};

const createTriggerSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, days = [] } = req.body;
        const result = await createTriggerScheduleForDevice({
            user: req.user,
            deviceId,
            startTime,
            days,
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Create Trigger Schedule Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Helper Function
const getNextDayName = (day) => {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const index = days.indexOf(day);
    return days[(index + 1) % 7];
};

// Helper Function
const shiftDays = (days) => {
    const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return days.map(d => {
        const idx = dayOrder.indexOf(d.toLowerCase().trim());
        return dayOrder[(idx + 1) % 7];
    });
};

// ==================== GET TRIGGER EVENTS BY DEVICE ID ====================
const getTriggerEventsByDeviceID = async (req, res) => {
    try {
        const { deviceId } = req.params;

        const schedules = await TriggerSchedule.find({ deviceId })
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: schedules.length,
            schedules,
        });
    } catch (error) {
        console.error("Get Trigger Events Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ====================== TRIGGER DEVICE - CURRENT/NEXT EVENT ======================
const getCurrentOrNextTriggerEventData = async (deviceId) => {
    try {
        const now = new Date();

        const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
        const currentDay = now.toLocaleString('en-US', {
            weekday: 'long',
            timeZone: 'UTC'
        }).toLowerCase();

        // Get all ACTIVE trigger events
        const events = await TriggerSchedule.find({
            deviceId: deviceId,
            status: "ACTIVE"
        }).sort({ startTime: 1 });

        let currentEvent = null;
        let nextEvent = null;

        for (const ev of events) {
            const { startTime, endTime, days, isOvernight, isRecurring } = ev;

            // Recurring event hai to current day check karo
            if (isRecurring && days && days.length > 0) {
                if (!days.map(d => d.toLowerCase()).includes(currentDay)) {
                    continue;
                }
            }

            let isActiveNow = false;

            if (!isOvernight) {
                if (currentTime >= startTime && currentTime < endTime) {
                    isActiveNow = true;
                }
            } else {
                // Overnight case
                if (currentTime >= startTime || currentTime < endTime) {
                    isActiveNow = true;
                }
            }

            if (isActiveNow) {
                currentEvent = ev;
                break;                    // Pehla active event
            }
            else if (!currentEvent && currentTime < startTime) {
                // Sabse jaldi aane wala next event
                if (!nextEvent || startTime < nextEvent.startTime) {
                    nextEvent = ev;
                }
            }
        }

        if (currentEvent) {
            // Calculate remaining time
            const [endH, endM] = currentEvent.endTime.split(':').map(Number);
            let endDate = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                endH,
                endM,
                0
            ));

            if (endDate <= now) {
                endDate.setUTCDate(endDate.getUTCDate() + 1);
            }

            const remainingMs = endDate - now;
            const remainingMinutes = Math.floor(remainingMs / (1000 * 60));

            return {
                type: "CURRENT",
                event: currentEvent,
                remainingMinutes: remainingMinutes > 0 ? remainingMinutes : 0,
                remainingText: remainingMinutes > 0 ? `${remainingMinutes} min remaining` : "Ending soon",
                isTrigger: true
            };
        }
        else if (nextEvent) {
            return {
                type: "NEXT",
                event: nextEvent,
                isTrigger: true
            };
        }
        else {
            return {
                type: "NO_EVENT",
                event: null,
                message: "No active or upcoming trigger event found",
                isTrigger: true
            };
        }

    } catch (err) {
        console.error("Get Current/Next Trigger Event Error:", err);
        return {
            type: "NO_EVENT",
            event: null,
            message: "Error fetching trigger event",
            isTrigger: true
        };
    }
};

// ==================== TOGGLE ACTIVE / INACTIVE ====================
const toggleTriggerEventStatusForEvent = async ({ id, status }) => {
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return {
            status: 400,
            ok: false,
            schedule: null,
            body: { success: false, message: "Invalid status" },
        };
    }

    const schedule = await TriggerSchedule.findById(id);
    if (!schedule) {
        return {
            status: 404,
            ok: false,
            schedule: null,
            body: { success: false, message: "Schedule not found" },
        };
    }

    schedule.status = status;
    await schedule.save();

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

const toggleTriggerEventStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const result = await toggleTriggerEventStatusForEvent({ id, status });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Toggle Status Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==================== DELETE TRIGGER EVENT ====================
const deleteTriggerEventForEvent = async ({ id }) => {
    const schedule = await TriggerSchedule.findById(id);
    if (!schedule) {
        return {
            status: 404,
            ok: false,
            schedule: null,
            body: { success: false, message: "Schedule not found" },
        };
    }

    const startJobId = `trigger-start-${schedule.deviceId}-${schedule._id}`;
    const endJobId = `trigger-end-${schedule.deviceId}-${schedule._id}`;

    await removeScheduleJob(startJobId);
    await removeScheduleJob(endJobId);
    await removeJobsForEventId(schedule._id);
    await TriggerSchedule.findByIdAndDelete(id);

    return {
        status: 200,
        ok: true,
        schedule,
        body: {
            success: true,
            message: "Trigger schedule and its jobs deleted successfully",
        },
    };
};

const deleteTriggerEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await deleteTriggerEventForEvent({ id });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Delete Trigger Schedule Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createTriggerSchedule,
    createTriggerScheduleForDevice,
    getTriggerEventsByDeviceID,
    toggleTriggerEventStatus,
    toggleTriggerEventStatusForEvent,
    deleteTriggerEvent,
    deleteTriggerEventForEvent,
    getCurrentOrNextTriggerEventData,
};