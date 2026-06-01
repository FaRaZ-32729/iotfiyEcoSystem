// src/controllers/eventController.js
const Event = require("../models/eventModel");
const scheduleQueue = require("../queues/scheduleQueue");
const Device = require("../models/deviceModel");

const createSchedule = async (req, res) => {
    try {
        const { deviceId, startTime, endTime, days, command = "ON" } = req.body;
        const user = req.user;

        // Validate device exists and belongs to user
        const device = await Device.findOne({ deviceId });
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        // Check permission
        if (device.category !== "scheduling") {
            return res.status(403).json({ success: false, message: "Events can only be set for scheduling devices" });
        }

        const isOvernight = startTime > endTime;

        const schedule = await Event.create({
            deviceId,
            startTime,
            endTime,
            days,
            command,
            isOvernight,
            createdBy: user._id,
            status: "ACTIVE"
        });

        // Add recurring job to BullMQ
        await scheduleQueue.add(`schedule-${schedule._id}`, {
            scheduleId: schedule._id,
            deviceId,
            command,
            startTime,
            endTime,
            days,
            isOvernight
        }, {
            repeat: {
                cron: `0 ${startTime.split(':')[0]} * * ${days.map(d => d.slice(0, 3).toUpperCase()).join(',')}`
            }
        });

        res.status(201).json({
            success: true,
            message: "Schedule created successfully",
            schedule
        });

    } catch (error) {
        console.error("Create Schedule Error:", error);
        res.status(500).json({ success: false, message: "Failed to create schedule" });
    }
};

module.exports = { createSchedule };