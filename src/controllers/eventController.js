// src/controllers/eventController.js
const Event = require("../models/eventModel");
const Device = require("../models/deviceModel");
const { generateCron, isOvernight } = require("../queues/cronHelper");
const { addScheduleJob } = require("../queues/scheduleService");
const { publishCommand } = require("../mqtt/commandPublisher");

// src/controllers/eventController.js
const createSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, endTime, days, command = "ON" } = req.body;
        const user = req.user;

        // Validation
        if (!deviceId || !startTime || !endTime || !days || days.length === 0) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const device = await Device.findOne({ deviceId });
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        if (device.category !== "scheduling") {
            return res.status(403).json({ success: false, message: "Only scheduling devices allowed" });
        }

        const overnight = isOvernight(startTime, endTime);

        // Generate Cron Expressions
        const startCron = generateCron(startTime, days);
        let endDays = [...days];

        if (overnight) {
            const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
            endDays = days.map(d => {
                const idx = dayOrder.indexOf(d.toLowerCase().trim());
                return dayOrder[(idx + 1) % 7];
            });
        }

        const endCron = generateCron(endTime, endDays);

        console.log(`📅 New Schedule → Start: ${startCron} | End: ${endCron} | Overnight: ${overnight}`);

        // Unique Job IDs
        const startJobId = `start-${deviceId}-${Date.now()}`;
        const endJobId = `end-${deviceId}-${Date.now()}`;

        // Add ON Job
        await addScheduleJob(startJobId, {
            scheduleId: startJobId,
            deviceId,
            command: "ON",
            type: "start",
            startTime: startTime,     // ← Add this
            endTime: endTime          // ← Add this
        }, startCron);

        // Add OFF Job
        await addScheduleJob(endJobId, {
            scheduleId: endJobId,
            deviceId,
            command: "OFF",
            type: "end",
            startTime: startTime,     // ← Add this
            endTime: endTime          // ← Add this
        }, endCron);


        console.log("Start Job Added with Cron:", startCron);
        console.log("End Job Added with Cron:", endCron);

        // Save to Database
        const schedule = await Event.create({
            deviceId,
            startTime,
            endTime,
            days,
            command,
            isOvernight: overnight,
            startCron,
            endCron,
            startJobId,
            endJobId,
            createdBy: user._id,
            status: "ACTIVE"
        });

        res.status(201).json({
            success: true,
            message: "Schedule created successfully",
            schedule
        });

    } catch (error) {
        console.error("Create Schedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


const manualToggle = async (req, res) => {
    try {
        const { deviceId } = req.body;
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

        // Send command
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

        // ==================== OVERRIDE LOGIC ====================
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC

        // Find active schedule for today
        const activeSchedule = await Event.findOne({
            deviceId,
            status: "ACTIVE",
            days: { $in: [new Date().toLocaleString('en-US', { weekday: 'long' }).toLowerCase()] }
        });

        if (activeSchedule) {
            activeSchedule.manualOverride = true;
            activeSchedule.overrideDate = today;
            await activeSchedule.save();

            console.log(`🚫 Manual override activated for schedule ${activeSchedule._id} today`);
        }

        res.json({
            success: true,
            message: `Device manually turned ${newCommand}`,
            newState: newCommand,
            deviceId
        });

    } catch (error) {
        console.error("Manual Toggle Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { createSchedule, manualToggle };