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

            if (schedule.isRecurring && schedule.status === "INACTIVE") {
                console.log(`⛔ Skipping reconciliation for ${deviceId} - Recurring event is INACTIVE`);
                continue;
            }

            const { startTime, endTime, days, isOvernight } = schedule;

            if (!days.includes(utcDay)) continue;

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
                activeSchedule = schedule;
                break;
            }
        }

        if (activeSchedule) {
            let durationSeconds = null;

            const [endHour, endMinute] = activeSchedule.endTime.split(':').map(Number);

            let endDate = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                endHour,
                endMinute,
                0
            ));

            // Handle overnight case
            if (endDate <= now) {
                endDate.setUTCDate(endDate.getUTCDate() + 1);
            }

            durationSeconds = Math.floor((endDate - now) / 1000);

            console.log(`✅ Found active schedule → Sending ON command to ${deviceId}`);

            publishCommand(deviceId, {
                type: "COMMAND",
                command: "ON",
                scheduleId: activeSchedule._id,
                durationSeconds: durationSeconds
            });
        } else {
            console.log(`⏭️  No active schedule window currently for ${deviceId}`);
        }

    } catch (error) {
        console.error("Reconciliation Error:", error);
    }
};

module.exports = { reconcileMissedCommands };