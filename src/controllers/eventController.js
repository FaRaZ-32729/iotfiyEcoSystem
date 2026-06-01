// src/controllers/eventController.js
const Event = require("../models/eventModel");
const Device = require("../models/deviceModel");
const { generateCron, isOvernight } = require("../queues/cronHelper");
const { addScheduleJob } = require("../queues/scheduleService");

// src/controllers/eventController.js
const createSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, endTime, days, command = "ON" } = req.body;
        const user = req.user;

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
        const startJobId = `${deviceId}-ON-${startCron}`;
        const endJobId = `${deviceId}-OFF-${endCron}`;

        // Add ON Job
        await addScheduleJob(startJobId, {
            scheduleId: startJobId,
            deviceId,
            command: "ON",
            type: "start"
        }, startCron);

        // Add OFF Job
        await addScheduleJob(endJobId, {
            scheduleId: endJobId,
            deviceId,
            command: "OFF",
            type: "end"
        }, endCron);

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


module.exports = { createSchedule };