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

        // Check device exists and is Trigger type
        const device = await Device.findOne({ deviceId });
        if (!device || device.category !== "trigger") {
            return res.status(403).json({
                success: false,
                message: "Invalid or non-trigger device"
            });
        }

        const intervalSeconds = device.interval || 5;

        // Calculate endTime = startTime + interval
        const [hours, minutes] = startTime.split(":").map(Number);
        let endHours = hours;
        let endMinutes = minutes + intervalSeconds;
        let isOvernight = false;

        // Proper overnight calculation
        if (endMinutes >= 60) {
            endHours += Math.floor(endMinutes / 60);
            endMinutes = endMinutes % 60;

            // Agar endHours 24 ya usse zyada ho gaya to overnight hai
            if (endHours >= 24) {
                isOvernight = true;
                endHours = endHours % 24;
            }
        }

        const endTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;

        const isRecurring = days.length > 0;

        let startCron, endCron;

        if (isRecurring) {
            // ==================== RECURRING SCHEDULE ====================
            startCron = generateCron(startTime, days);

            let endDays = isOvernight ? shiftDays(days) : [...days];   // Overnight logic
            endCron = generateCron(endTime, endDays);

            console.log(`🔄 Recurring Trigger Schedule: ${startTime} → ${endTime} | Overnight: ${isOvernight}`);

        } else {
            // ==================== ONE-TIME SCHEDULE (Today) ====================
            const now = new Date();
            const utcDayName = now.toLocaleString('en-US', {
                weekday: 'long',
                timeZone: 'UTC'
            }).toLowerCase();

            startCron = generateCron(startTime, [utcDayName]);

            if (isOvernight) {
                const nextDayName = getNextDayName(utcDayName);
                endCron = generateCron(endTime, [nextDayName]);
                console.log(`🌙 One-time Overnight Trigger: ${utcDayName} ${startTime} → ${nextDayName} ${endTime}`);
            } else {
                endCron = generateCron(endTime, [utcDayName]);
                console.log(`📅 One-time Trigger: ${utcDayName} ${startTime} → ${endTime}`);
            }
        }

        const schedule = await TriggerSchedule.create({
            deviceId,
            startTime,
            endTime,
            days: isRecurring ? days : [],
            intervalSeconds,
            command: "ON",
            createdBy: user._id,
            status: "ACTIVE",
            isRecurring,
            isOvernight,
            startCron,
            endCron
        });

        // Add jobs to queue
        const startJobId = `trigger-start-${deviceId}-${schedule._id.toString()}`;
        const endJobId = `trigger-end-${deviceId}-${schedule._id.toString()}`;

        await addScheduleJob(startJobId, {
            deviceId,
            command: "ON",
            type: "start",
            eventId: schedule._id.toString(),
            isRecurring
        }, startCron);

        await addScheduleJob(endJobId, {
            deviceId,
            command: "OFF",
            type: "end",
            eventId: schedule._id.toString(),
            isRecurring
        }, endCron);

        res.status(201).json({
            success: true,
            message: `${isRecurring ? "Recurring" : "One-time"} trigger event created successfully`,
            schedule,
            isOvernight,
            isRecurring
        });

    } catch (error) {
        console.error("Create Trigger event Error:", error);
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

        // Get all ACTIVE events for this trigger device
        const events = await TriggerSchedule.find({
            deviceId: deviceId,
            status: "ACTIVE"
        }).sort({ startTime: 1 });

        let currentEvent = null;
        let nextEvent = null;

        for (const ev of events) {
            const { startTime, endTime, isOvernight } = ev;

            let isActiveNow = false;

            if (!isOvernight) {
                if (currentTime >= startTime && currentTime < endTime) {
                    isActiveNow = true;
                }
            } else {
                if (currentTime >= startTime || currentTime < endTime) {
                    isActiveNow = true;
                }
            }

            if (isActiveNow) {
                currentEvent = ev;
                break;
            } else if (!currentEvent && currentTime < startTime) {
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

            if (endDate <= now) endDate.setUTCDate(endDate.getUTCDate() + 1);

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
                message: "No active or upcoming trigger event",
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