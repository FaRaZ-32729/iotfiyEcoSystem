// src/services/scheduler/reconciliationService.js
const Schedule = require("../models/eventModel");
const { publishCommand } = require("../mqtt/commandPublisher");

const reconcileMissedCommands = async (deviceId) => {
    try {
        const now = new Date();

        // Get current UTC time in HH:mm format
        const currentHour = String(now.getUTCHours()).padStart(2, '0');
        const currentMinute = String(now.getUTCMinutes()).padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;

        // Get UTC day name correctly
        const utcDay = now.toLocaleString('en-US', { 
            weekday: 'long', 
            timeZone: 'UTC' 
        }).toLowerCase();

        console.log(`🔍 Reconciling at UTC ${currentTime} | Day: ${utcDay} | Device: ${deviceId}`);

        const schedules = await Schedule.find({
            deviceId,
            status: "ACTIVE"
        });

        if (!schedules.length) {
            console.log(`No active schedules for device ${deviceId}`);
            return;
        }

        let activeSchedule = null;

        for (const schedule of schedules) {
            const { startTime, endTime, days, isOvernight } = schedule;

            if (!days.includes(utcDay)) continue;

            let isActiveNow = false;

            if (!isOvernight) {
                if (currentTime >= startTime && currentTime < endTime) {
                    isActiveNow = true;
                }
            } else {
                // Overnight schedule (e.g., 22:00 to 06:00)
                if (currentTime >= startTime || currentTime < endTime) {
                    isActiveNow = true;
                }
            }

            if (isActiveNow) {
                activeSchedule = schedule;
                break;
            }
        }

        if (activeSchedule) {
            console.log(`✅ Found active schedule → Sending ON command to ${deviceId}`);
            publishCommand(deviceId, {
                type: "COMMAND",
                command: "ON",
                scheduleId: activeSchedule._id
            });
        } else {
            console.log(`⏭️  No active schedule window currently for ${deviceId}`);
        }

    } catch (error) {
        console.error("Reconciliation Error:", error);
    }
};

module.exports = { reconcileMissedCommands };