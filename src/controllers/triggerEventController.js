// controllers/triggerEventController.js
const TriggerSchedule = require("../models/triggerEventModel");
const Device = require("../models/deviceModel");
const { generateCron } = require("../queues/cronHelper");
const { addScheduleJob, removeScheduleJob } = require("../queues/scheduleService");

// ==================== CREATE TRIGGER EVENT ====================
const createTriggerSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, days = [] } = req.body;
        const user = req.user;

        if (!deviceId || !startTime) {
            return res.status(400).json({
                success: false,
                message: "deviceId and startTime are required"
            });
        }

        const device = await Device.findOne({ deviceId });
        if (!device || device.category !== "trigger") {
            return res.status(403).json({
                success: false,
                message: "Invalid or non-trigger device"
            });
        }

        const intervalSeconds = device.interval || 5;
        const isRecurring = days.length > 0;

        let startCron = null;

        if (isRecurring) {
            startCron = generateCron(startTime, days);
            console.log(`🔄 Recurring Trigger Schedule: ${startTime} every ${days.join(', ')}`);
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
            startCron
        });

        // ==================== ADD ONLY START JOB ====================
        const startJobId = `trigger-start-${deviceId}-${schedule._id.toString()}`;

        if (isRecurring) {
            // Recurring → Use Cron
            await addScheduleJob(startJobId, {
                deviceId,
                command: "ON",
                type: "start",
                eventId: schedule._id.toString(),
                isRecurring: true
            }, startCron);
        } else {
            // One-time → Use Delay
            const now = new Date();
            const [hour, minute] = startTime.split(":").map(Number);

            const startDate = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                hour,
                minute
            ));

            const delayMs = Math.max(0, startDate.getTime() - now.getTime());

            await addScheduleJob(startJobId, {
                deviceId,
                command: "ON",
                type: "start",
                eventId: schedule._id.toString(),
                isRecurring: false
            }, null, delayMs);   // delayMs = null cron
        }

        res.status(201).json({
            success: true,
            message: `${isRecurring ? "Recurring" : "One-time"} trigger schedule created successfully`,
            schedule
        });

    } catch (error) {
        console.error("Create Trigger Schedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
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

        if (schedules.length === 0) {
            return res.status(404).json({ message: "no event found" });
        }

        return res.status(200).json({
            success: true,
            count: schedules.length,
            schedules
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
const toggleTriggerEventStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // "ACTIVE" or "INACTIVE"

        if (!["ACTIVE", "INACTIVE"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const schedule = await TriggerSchedule.findById(id);
        if (!schedule) {
            return res.status(404).json({ success: false, message: "Schedule not found" });
        }

        schedule.status = status;
        await schedule.save();

        // TODO: Agar Inactive kar rahe ho to jobs ko pause/remove kar sakte ho (optional)

        res.status(200).json({
            success: true,
            message: `Schedule ${status.toLowerCase()} successfully`,
            schedule
        });
    } catch (error) {
        console.error("Toggle Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==================== DELETE TRIGGER EVENT ====================
const deleteTriggerEvent = async (req, res) => {
    try {
        const { id } = req.params;

        const schedule = await TriggerSchedule.findById(id);
        if (!schedule) {
            return res.status(404).json({ success: false, message: "Schedule not found" });
        }

        // Remove jobs from Redis/Queue
        const startJobId = `trigger-start-${schedule.deviceId}-${schedule._id}`;
        const endJobId = `trigger-end-${schedule.deviceId}-${schedule._id}`;

        await removeScheduleJob(startJobId);
        await removeScheduleJob(endJobId);

        // Delete from MongoDB
        await TriggerSchedule.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: "Trigger schedule and its jobs deleted successfully"
        });
    } catch (error) {
        console.error("Delete Trigger Schedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { createTriggerSchedule, getTriggerEventsByDeviceID, toggleTriggerEventStatus, deleteTriggerEvent, getCurrentOrNextTriggerEventData };