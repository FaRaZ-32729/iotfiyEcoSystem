// src/services/reconciliationService.js
const Schedule = require("../models/eventModel");
const Device = require("../models/deviceModel");
const { publishCommand } = require("../mqtt/commandPublisher");
const { runAcScheduledCommand } = require("./acScheduleHelper");
const {
    hasOneTimeWindow,
} = require("./oneTimeScheduleUtils");
const { isUtcTimeInsideEventWindow } = require("../queues/cronHelper");

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
            return { hadActiveEvent: false };
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

            // ONE-TIME ONLY — absolute window; recurring unchanged below
            if (hasOneTimeWindow(schedule)) {
                const t = Date.now();
                const startMs = new Date(schedule.windowStartAt).getTime();
                const endMs = new Date(schedule.windowEndAt).getTime();
                if (t < startMs || t >= endMs) continue;
                activeSchedule = schedule;
                break;
            }

            if (isRecurring && days.length && !days.includes(utcDay)) continue;

            let isActiveNow = isUtcTimeInsideEventWindow({
                currentTimeHm: currentTime,
                startTime,
                endTime,
                isOvernight,
            });

            if (isActiveNow) {
                activeSchedule = schedule;
                break;
            }
        }

        if (!activeSchedule) {
            console.log(`⏭️  No active schedule window currently for ${deviceId}`);
            return { hadActiveEvent: false };
        }

        let durationSeconds = null;

        // ONE-TIME ONLY — recurring duration uses HH:mm end below
        if (hasOneTimeWindow(activeSchedule)) {
            const endMs = new Date(activeSchedule.windowEndAt).getTime();
            durationSeconds = Math.max(
                0,
                Math.floor((endMs - now.getTime()) / 1000)
            );
        } else {
            const [endHour, endMinute] = activeSchedule.endTime
                .split(":")
                .map(Number);

            let endDate = new Date(
                Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    endHour,
                    endMinute,
                    0
                )
            );

            if (endDate <= now) {
                endDate.setUTCDate(endDate.getUTCDate() + 1);
            }

            durationSeconds = Math.floor((endDate - now) / 1000);
        }

        const eventCommand = activeSchedule.command || "ON";
        const espSnapshot = options.espSnapshot || null;

        if (isAc && device) {
            if (espSnapshot) {
                console.log(
                    `[AC-RECONNECT] active event device=${deviceId} ` +
                        `event=${eventCommand}@${activeSchedule.setTemperature ?? "-"} ` +
                        `esp=${espSnapshot.state ?? "-"}@${espSnapshot.setTemperature ?? "-"}`
                );
            }
            console.log(`✅ Found active AC schedule → Sending ${eventCommand} to ${deviceId}`);
            const runOptions = {
                scheduleId: activeSchedule._id,
                durationSeconds: eventCommand === "ON" ? durationSeconds : null,
                reason: `reconcile:${reason}`,
                isScheduleStart: true,
                scheduleEventId: activeSchedule._id.toString(),
            };
            if (espSnapshot) {
                if (espSnapshot.state != null) {
                    runOptions.actualEspState = espSnapshot.state;
                }
                if (
                    espSnapshot.setTemperature != null &&
                    Number.isFinite(Number(espSnapshot.setTemperature))
                ) {
                    runOptions.actualEspSetTemp = Number(espSnapshot.setTemperature);
                }
            }
            await runAcScheduledCommand(device, activeSchedule, eventCommand, runOptions);
            return { hadActiveEvent: true };
        }

        if (eventCommand === "ON") {
            console.log(`✅ Found active schedule → Sending ON command to ${deviceId}`);
            publishCommand(deviceId, {
                type: "COMMAND",
                command: "ON",
                scheduleId: activeSchedule._id,
                durationSeconds: durationSeconds
            });
            return { hadActiveEvent: true };
        } else {
            console.log(`⏭️ Active schedule command is OFF for non-AC device ${deviceId} — skip reconcile`);
            return { hadActiveEvent: true };
        }

    } catch (error) {
        console.error("Reconciliation Error:", error);
        return { hadActiveEvent: false, error: error.message };
    }
};

module.exports = { reconcileMissedCommands };
