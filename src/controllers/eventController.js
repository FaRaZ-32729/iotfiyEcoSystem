// src/controllers/eventController.js
const Event = require("../models/eventModel");
const Device = require("../models/deviceModel");
const { generateCron, isOvernight } = require("../queues/cronHelper");
const { addScheduleJob } = require("../queues/scheduleService");
const { publishCommand } = require("../mqtt/commandPublisher");
const scheduleQueue = require("../queues/scheduleQueue");
const { reconcileMissedCommands } = require("../services/reconciliationService");

// src/controllers/eventController.js

const createSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, endTime, days = [], command = "ON" } = req.body;
        const user = req.user;

        if (!deviceId || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: "deviceId, startTime, endTime are required" });
        }

        const device = await Device.findOne({ deviceId });
        if (!device || device.category !== "scheduling") {
            return res.status(403).json({ success: false, message: "Invalid or non-scheduling device" });
        }

        const overnight = isOvernight(startTime, endTime);
        const isRecurring = days.length > 0;

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

        const startJobId = `start-${deviceId}-${Date.now()}`;
        const endJobId = `end-${deviceId}-${Date.now()}`;


        const schedule = await Event.create({
            deviceId,
            startTime,
            endTime,
            days: isRecurring ? days : [],
            command,
            isOvernight: overnight,
            isRecurring,
            startCron,
            endCron,
            createdBy: user._id,
            status: "ACTIVE"
        });

        // Add jobs
        await addScheduleJob(startJobId, { deviceId, command: "ON", type: "start", startTime, endTime, days, eventId: schedule._id.toString(), isRecurring }, startCron);
        await addScheduleJob(endJobId, { deviceId, command: "OFF", type: "end", startTime, endTime, days, eventId: schedule._id.toString(), isRecurring }, endCron);


        res.status(201).json({
            success: true,
            message: `${scheduleType} schedule created successfully`,
            schedule,
            type: scheduleType
        });

    } catch (error) {
        console.error("Create Schedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
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

// Get Current/Next Schedule
// const getCurrentOrNextScheduleData = async (deviceId) => {
//     try {
//         const now = new Date();

//         // Current UTC Time (HH:mm)
//         const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

//         // Current UTC Day
//         const currentDay = now.toLocaleString('en-US', { 
//             weekday: 'long', 
//             timeZone: 'UTC' 
//         }).toLowerCase();

//         console.log(`🔍 Checking schedule for device ${deviceId} | Time: ${currentTime} | Day: ${currentDay}`);

//         // Get all active schedules for this device
//         const schedules = await Event.find({
//             deviceId: deviceId,
//             status: "ACTIVE"
//         }).sort({ startTime: 1 });   // Sort by start time

//         let currentEvent = null;
//         let nextEvent = null;
//         let closestNextTime = null;

//         for (const sch of schedules) {
//             const { startTime, endTime, days, isOvernight, isRecurring } = sch;

//             // Skip if this schedule is not for today (for recurring)
//             if (isRecurring && !days.includes(currentDay)) {
//                 continue;
//             }

//             // ==================== CHECK IF CURRENTLY ACTIVE ====================
//             let isActiveNow = false;

//             if (!isOvernight) {
//                 // Normal Schedule
//                 if (currentTime >= startTime && currentTime < endTime) {
//                     isActiveNow = true;
//                 }
//             } else {
//                 // Overnight Schedule (e.g., 22:00 → 02:00)
//                 if (currentTime >= startTime || currentTime < endTime) {
//                     isActiveNow = true;
//                 }
//             }

//             if (isActiveNow) {
//                 currentEvent = sch;
//                 break;   // First active event is current
//             }

//             // ==================== FIND NEXT EVENT ====================
//             if (!currentEvent) {
//                 // Compare start time for next event
//                 if (currentTime < startTime) {
//                     if (!nextEvent || startTime < closestNextTime) {
//                         nextEvent = sch;
//                         closestNextTime = startTime;
//                     }
//                 }
//             }
//         }

//         // Return result
//         if (currentEvent) {
//             return {
//                 type: "CURRENT",
//                 event: currentEvent
//             };
//         } else if (nextEvent) {
//             return {
//                 type: "NEXT",
//                 event: nextEvent
//             };
//         } else {
//             return {
//                 type: "NO_EVENT",
//                 event: null,
//                 message: "No active or upcoming schedule found"
//             };
//         }

//     } catch (err) {
//         console.error("Get Current/Next Schedule Error:", err);
//         return { 
//             type: "NO_EVENT", 
//             event: null,
//             message: "Error fetching schedule"
//         };
//     }
// };
const getCurrentOrNextScheduleData = async (deviceId) => {
    try {
        const now = new Date();

        const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
        const currentDay = now.toLocaleString('en-US', {
            weekday: 'long',
            timeZone: 'UTC'
        }).toLowerCase();

        const schedules = await Event.find({
            deviceId: deviceId,
            status: "ACTIVE"
        }).sort({ startTime: 1 });

        let currentEvent = null;
        let nextEvent = null;

        for (const sch of schedules) {
            const { startTime, endTime, days, isOvernight, isRecurring } = sch;

            if (isRecurring && !days.includes(currentDay)) continue;

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
                currentEvent = sch;
                break;
            } else if (!currentEvent && currentTime < startTime) {
                if (!nextEvent || startTime < nextEvent.startTime) {
                    nextEvent = sch;
                }
            }
        }

        // ==================== HELPER: Calculate Total Duration ====================
        const calculateTotalDuration = (startTime, endTime) => {
            const [startH, startM] = startTime.split(':').map(Number);
            const [endH, endM] = endTime.split(':').map(Number);

            let duration = (endH * 60 + endM) - (startH * 60 + startM);
            if (duration < 0) duration += 24 * 60;   // Overnight case
            return duration;
        };

        // ==================== RETURN DATA ====================
        if (currentEvent) {
            const totalDuration = calculateTotalDuration(currentEvent.startTime, currentEvent.endTime);

            // Remaining time
            const [endHour, endMinute] = currentEvent.endTime.split(':').map(Number);
            let endDate = new Date(Date.UTC(
                now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), endHour, endMinute, 0
            ));
            if (endDate <= now) endDate.setUTCDate(endDate.getUTCDate() + 1);

            const remainingMinutes = Math.floor((endDate - now) / (1000 * 60));

            return {
                type: "CURRENT",
                event: currentEvent,
                totalDurationMinutes: totalDuration,
                totalDurationText: `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`,
                remainingMinutes: remainingMinutes,
                remainingText: `${remainingMinutes} min remaining`
            };
        }
        else if (nextEvent) {
            const totalDuration = calculateTotalDuration(nextEvent.startTime, nextEvent.endTime);

            return {
                type: "NEXT",
                event: nextEvent,
                totalDurationMinutes: totalDuration,
                totalDurationText: `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`
            };
        }
        else {
            return {
                type: "NO_EVENT",
                event: null,
                message: "No active or upcoming schedule found"
            };
        }

    } catch (err) {
        console.error("Get Current/Next Schedule Error:", err);
        return {
            type: "NO_EVENT",
            event: null,
            message: "Error fetching schedule"
        };
    }
};

// const manualToggle = async (req, res) => {
//     try {
//         const { deviceId, eventId } = req.body;
//         const user = req.user;

//         console.log(req.body)

//         if (!deviceId) {
//             return res.status(400).json({ success: false, message: "deviceId is required" });
//         }

//         if (!eventId) {
//             return res.status(400).json({ success: false, message: "eventId is required" });
//         }

//         const device = await Device.findOne({ deviceId });


//         if (!device) {
//             return res.status(404).json({ success: false, message: "Device not found" });
//         }

//         if (device.status !== "online") {
//             return res.status(400).json({
//                 success: false,
//                 message: "Device is offline. Cannot send command."
//             });
//         }

//         const activeSchedule = await Event.findOne({
//             _id: eventId,
//             deviceId: deviceId,
//             status: "ACTIVE"
//         });

//         if (!activeSchedule) {
//             return res.status(400).json({ success: false, message: "No event found" });
//         }

//         const newCommand = device.state === "ON" ? "OFF" : "ON";

//         console.log(`🔧 Manual Toggle: ${device.state} → ${newCommand} for ${deviceId}`);

//         // Send command
//         const success = publishCommand(deviceId, {
//             type: "COMMAND",
//             command: newCommand,
//             isManual: true,
//             timestamp: new Date().toISOString()
//         });

//         if (!success) {
//             return res.status(500).json({ success: false, message: "Failed to send command" });
//         }

//         // Update device state immediately
//         device.state = newCommand;
//         await device.save();

//         // ==================== OVERRIDE LOGIC ====================
//         const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC

//         // Find active schedule for today
//         // const activeSchedule = await Event.findOne({
//         //     deviceId,
//         //     status: "ACTIVE",
//         //     days: { $in: [new Date().toLocaleString('en-US', { weekday: 'long' }).toLowerCase()] }
//         // });

//         if (activeSchedule) {
//             activeSchedule.manualOverride = true;
//             activeSchedule.overrideDate = today;
//             await activeSchedule.save();

//             console.log(`🚫 Manual override activated for schedule ${activeSchedule._id} today`);
//         }

//         res.json({
//             success: true,
//             message: `Device manually turned ${newCommand}`,
//             newState: newCommand,
//             deviceId
//         });

//     } catch (error) {
//         console.error("Manual Toggle Error:", error);
//         res.status(500).json({ success: false, message: error.message });
//     }
// };

// ==================== GET EVENTS BY DEVICE ID ====================

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

        const newCommand = device.state === "ON" ? "OFF" : "ON";

        console.log(`🔧 Manual Toggle: ${device.state} → ${newCommand} for ${deviceId}`);

        // Send command to device
        const success = publishCommand(deviceId, {
            type: "COMMAND",
            command: newCommand,
            isManual: true,
            timestamp: new Date().toISOString()
        });

        if (!success) {
            return res.status(500).json({ success: false, message: "Failed to send command" });
        }

        // Update device state immediately
        device.state = newCommand;
        await device.save();

        // ==================== MANUAL OVERRIDE LOGIC (Only if eventId is provided) ====================
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

        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No events found"
            });
        }

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
const toggleScheduleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // "ACTIVE" or "INACTIVE"

        if (!["ACTIVE", "INACTIVE"].includes(status)) {
            return res.status(400).json({ success: false, message: "Status must be ACTIVE or INACTIVE" });
        }

        const schedule = await Event.findById(id);
        if (!schedule) {
            return res.status(404).json({ success: false, message: "Schedule not found" });
        }

        if (!schedule.isRecurring) {
            return res.status(400).json({ success: false, message: "Only recurring schedules can be toggled" });
        }

        schedule.status = status;
        await schedule.save();

        let reconciliationTriggered = false;

        // ==================== RECONCILIATION LOGIC ====================
        if (status === "ACTIVE") {
            console.log(`🔄 Schedule activated → Running reconciliation for device ${schedule.deviceId}`);

            // Call reconciliation to check if we should send ON command immediately
            await reconcileMissedCommands(schedule.deviceId);
            reconciliationTriggered = true;
        }

        return res.json({
            success: true,
            message: `Schedule ${status.toLowerCase()} successfully`,
            schedule
        });

    } catch (error) {
        console.error("Toggle Schedule Status Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ==================== DELETE SCHEDULE + REMOVE FROM REDIS ====================
const deleteSchedule = async (req, res) => {
    try {
        const { id } = req.params;

        const schedule = await Event.findById(id);
        if (!schedule) {
            return res.status(404).json({ success: false, message: "Schedule not found" });
        }

        // Remove repeatable jobs from BullMQ
        if (schedule.startJobId) {
            try {
                await scheduleQueue.removeRepeatableByKey(schedule.startJobId);
                console.log(`🗑️ Removed start job from Redis: ${schedule.startJobId}`);
            } catch (e) {
                console.warn(`Could not remove startJobId: ${schedule.startJobId}`);
            }
        }

        if (schedule.endJobId) {
            try {
                await scheduleQueue.removeRepeatableByKey(schedule.endJobId);
                console.log(`🗑️ Removed end job from Redis: ${schedule.endJobId}`);
            } catch (e) {
                console.warn(`Could not remove endJobId: ${schedule.endJobId}`);
            }
        }

        // Delete from MongoDB
        await Event.deleteOne({ _id: id });

        res.json({
            success: true,
            message: "Schedule deleted successfully and removed from queue"
        });

    } catch (error) {
        console.error("Delete Schedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { createSchedule, manualToggle, getEventsByDevice, toggleScheduleStatus, deleteSchedule, getCurrentOrNextScheduleData };