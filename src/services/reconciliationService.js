// src/services/reconciliationService.js
const Schedule = require("../models/eventModel");
const Device = require("../models/deviceModel");
const { publishCommand } = require("../mqtt/commandPublisher");
const { runAcScheduledCommand } = require("./acScheduleHelper");

const reconcileMissedCommands = async (deviceId, options = {}) => {
    try {
        const reason = options.reason || "reconcile_unspecified";
        const now = new Date();

        const currentHour = String(now.getUTCHours()).padStart(2, '0');
        const currentMinute = String(now.getUTCMinutes()).padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;

        const utcDay = now.toLocaleString('en-US', {
            weekday: 'long',
            timeZone: 'UTC'
        }).toLowerCase();

        const today = now.toISOString().split('T')[0];

        console.log(
            `[AC-IR-DEBUG] reconcileMissedCommands device=${deviceId} ` +
                `reason=${reason} utc=${currentTime} day=${utcDay}`
        );
        console.log(`🔍 Reconciling at UTC ${currentTime} | Day: ${utcDay} | Device: ${deviceId}`);

        const device = await Device.findOne({ deviceId });
        const isAc = device?.deviceType === "AC";

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

            if (schedule.manualOverride && schedule.overrideDate === today) {
                console.log(`⛔ Skipping reconciliation for ${deviceId} - Manual Override is active today`);
                continue;
            }

            if (schedule.isRecurring && schedule.status === "INACTIVE") {
                console.log(`⛔ Skipping reconciliation for ${deviceId} - Recurring event is INACTIVE`);
                continue;
            }

            const { startTime, endTime, days, isOvernight, isRecurring } = schedule;

            if (isRecurring && days.length && !days.includes(utcDay)) continue;

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

        if (!activeSchedule) {
            console.log(`⏭️  No active schedule window currently for ${deviceId}`);
            return;
        }

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

        if (endDate <= now) {
            endDate.setUTCDate(endDate.getUTCDate() + 1);
        }

        durationSeconds = Math.floor((endDate - now) / 1000);

        const eventCommand = activeSchedule.command || "ON";

        if (isAc && device) {
            console.log(`✅ Found active AC schedule → Sending ${eventCommand} to ${deviceId}`);
            await runAcScheduledCommand(device, activeSchedule, eventCommand, {
                scheduleId: activeSchedule._id,
                durationSeconds: eventCommand === "ON" ? durationSeconds : null,
                reason: `reconcile:${reason}`,
            });
            return;
        }

        if (eventCommand === "ON") {
            console.log(`✅ Found active schedule → Sending ON command to ${deviceId}`);
            publishCommand(deviceId, {
                type: "COMMAND",
                command: "ON",
                scheduleId: activeSchedule._id,
                durationSeconds: durationSeconds
            });
        } else {
            console.log(`⏭️ Active schedule command is OFF for non-AC device ${deviceId} — skip reconcile`);
        }

    } catch (error) {
        console.error("Reconciliation Error:", error);
    }
};

module.exports = { reconcileMissedCommands };
