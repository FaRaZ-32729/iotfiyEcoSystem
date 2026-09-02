// src/queues/scheduleWorker.js
const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");
const { connectMQTT } = require("./src/mqtt/mqttClient");
const Event = require("./src/models/eventModel");
const dbConnection = require("./src/config/dbConnection");
const Device = require("./src/models/deviceModel");
const TriggerSchedule = require("./src/models/triggerEventModel");
const { runAcScheduledCommand, runAcOffEventEnd, runAcConditionalUnlockAtEventEnd, eventUsesLock, emitAcDeviceLive } = require("./src/services/acScheduleHelper");
const { cleanupOneTimeEventAfterEnd } = require("./src/controllers/eventController");
const { isOneTimeSchedulingEvent } = require("./src/services/oneTimeScheduleUtils");
const { clearScheduleStartDelivery } = require("./src/services/acScheduleStartDelivery");
const { emitDeviceScheduleUpdate } = require("./src/services/scheduleEmitHelper");
const env = require("dotenv").config();

console.log("✅ Schedule Worker Starting...");

async function finishOneTimeEndIfNeeded(schedule, jobType, success) {
    if (!success || jobType !== "end" || !isOneTimeSchedulingEvent(schedule)) return;
    try {
        await cleanupOneTimeEventAfterEnd(schedule);
    } catch (err) {
        // Do not fail/retry the end job — AC command already succeeded.
        console.error(
            `Failed to cleanup one-time event ${schedule._id}:`,
            err.message
        );
    }
}

let mqttConnected = false;
dbConnection();
// Connect MQTT with better error handling
const initializeMQTTForWorker = async () => {
    try {
        await connectMQTT();
        console.log("✅ MQTT Connected in Worker");
        mqttConnected = true;
    } catch (err) {
        console.error("❌ MQTT Connection Failed in Worker:", err.message);
    }
};

initializeMQTTForWorker();
console.log("REDIS_HOST =", process.env.REDIS_HOST);
console.log("REDIS_PORT =", process.env.REDIS_PORT);
console.log("REDIS_PASSWORD exists =", !!process.env.REDIS_PASSWORD);
const scheduleWorker = new Worker("device-schedules", async (job) => {

    const { deviceId, command, eventId } = job.data;
    console.log(" job data ", job.data);


    // ==================== FETCH DEVICE ====================
    const device = await Device.findOne({ deviceId });

    if (!device) {
        console.warn(`⚠️ Device ${deviceId} not found`);
        return;
    }

    // ==================== MANUAL BUTTON CHECK FOR TRIGGER DEVICES ====================
    if (device.category === "trigger" && device.manualButton === true) {
        console.log(`🔧 Manual Button is ENABLED for Trigger Device ${deviceId} → Skipping command`);
        return { skipped: true, reason: "manual_button_enabled" };
    }

    let durationSeconds = null;

    // ==================== TRIGGER SCHEDULE CHECK ====================
    if (device.category === "trigger") {
        const triggerEvent = await TriggerSchedule.findOne({
            _id: eventId,
            deviceId: deviceId
        });

        if (!triggerEvent) {
            console.log(`⛔ Skipping command for ${deviceId} — trigger event ${eventId} was deleted`);
            return { skipped: true, reason: "event_deleted" };
        }

        if (triggerEvent.status === "INACTIVE") {
            console.log(`⛔ Skipping command for Trigger Device ${deviceId} - Event INACTIVE`);
            return { skipped: true, reason: "inactive_trigger_event" };
        }

        // Calculate duration from intervalSeconds
        if (triggerEvent && triggerEvent.intervalSeconds) {
            durationSeconds = triggerEvent.intervalSeconds;
            console.log(`⏱️ Trigger Device ${deviceId} → Duration: ${durationSeconds} seconds`);
        }
    }

    // ==================== SCHEDULING DEVICE LOGIC ====================

    const schedule = await Event.findOne({
        _id: eventId,
        deviceId: deviceId,
    });

    if (device.category === "scheduling" && !schedule) {
        console.log(`⛔ Skipping command for ${deviceId} — schedule ${eventId} was deleted`);
        return { skipped: true, reason: "event_deleted" };
    }

    if (schedule && schedule.isRecurring && schedule.status === "INACTIVE") {
        console.log(`⛔ Skipping command ${command} for ${deviceId} - Recurring event is INACTIVE`);
        return { skipped: true, reason: "inactive_recurring" };
    }

    const today = new Date().toISOString().split('T')[0];
    if (schedule && schedule.manualOverride && schedule.overrideDate === today) {
        console.log(`⛔ Skipping command ${command} for ${deviceId} due to manual override today`);
        return { skipped: true, reason: "manual_override" };
    }

    const isAc = device.deviceType === "AC";
    const jobType = job.data.type;

    if (device.category === "scheduling" && jobType === "end") {
        await clearScheduleStartDelivery(deviceId, "cron_worker_end");
        await emitDeviceScheduleUpdate(deviceId, "event_end");
    }

    // AC OFF event end: keep off — conditional unlock
    if (isAc && jobType === "end" && schedule?.command === "OFF") {
        console.log(`🔓 AC OFF event ended for ${deviceId} — conditional unlock`);
        const success = await runAcOffEventEnd(device, schedule, {
            scheduleId: schedule?._id,
            reason: `cron_worker_${jobType || "end"}`,
        });
        if (success) {
            await finishOneTimeEndIfNeeded(schedule, jobType, true);
            return { success: true };
        }
        throw new Error(`Device ${deviceId} OFF event end unlock failed`);
    }

    // AC start uses event command (ON or OFF); end uses OFF when event was ON
    const effectiveCommand = isAc && jobType === "start"
        ? (schedule?.command || command)
        : command;

    console.log(`⚡ [SCHEDULE EXECUTING] ${new Date().toUTCString()}`);
    console.log(`   Device: ${deviceId} | Command: ${effectiveCommand}`);

    // ==================== CALCULATE REMAINING SECONDS ====================

    if (effectiveCommand === "ON" && schedule && schedule.endTime) {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentMinute = now.getUTCMinutes();

        const [endHour, endMinute] = schedule.endTime.split(':').map(Number);

        let endDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            endHour,
            endMinute,
            0
        ));

        // If end time is in the past (overnight case), add 24 hours
        if (endDate <= now) {
            endDate.setUTCDate(endDate.getUTCDate() + 1);
        }

        durationSeconds = Math.floor((endDate - now) / 1000);

        console.log(`⏱️ Remaining duration until end: ${durationSeconds} seconds`);
    }

    if (!mqttConnected) {
        console.warn("⚠️ MQTT not connected, trying to reconnect...");
        await initializeMQTTForWorker();
    }

    if (isAc) {
        const success = await runAcScheduledCommand(device, schedule, effectiveCommand, {
            durationSeconds,
            scheduleId: schedule?._id,
            reason: `cron_worker_${jobType || "unknown"}`,
            isScheduleStart: jobType === "start",
            scheduleEventId: eventId,
        });

        if (success) {
            if (
                jobType === "end" &&
                schedule?.command === "ON" &&
                eventUsesLock(schedule)
            ) {
                const unlockOk = await runAcConditionalUnlockAtEventEnd(
                    device,
                    schedule,
                    { reason: `cron_worker_${jobType || "end"}` }
                );
                if (unlockOk) {
                    await device.save();
                    emitAcDeviceLive(device);
                } else {
                    throw new Error(`Device ${deviceId} ON event end unlock failed`);
                }
            }
            console.log(`✅ AC command "${effectiveCommand}" sent to ${deviceId}`);
            await finishOneTimeEndIfNeeded(schedule, jobType, true);
            return { success: true };
        }
        console.error(`❌ Failed to publish AC command to ${deviceId}`);
        throw new Error(`Device ${deviceId} unreachable`);
    }

    const success = publishCommand(deviceId, {
        type: "COMMAND",
        command: effectiveCommand,
        durationSeconds: durationSeconds,
        timestamp: new Date().toISOString()
    });

    if (success) {
        console.log(`✅ Command "${effectiveCommand}" sent to ${deviceId}`);
        await finishOneTimeEndIfNeeded(schedule, jobType, true);
        return { success: true };
    } else {
        console.error(`❌ Failed to publish command to ${deviceId}`);
        throw new Error(`Device ${deviceId} unreachable`);
    }

}, {
    connection: redisConnection,
    concurrency: 5,
    timezone: "UTC"
});

// ==================== IMPROVED LOGGING ====================
scheduleWorker.on("completed", (job) => {
    console.log(`✅ Job Completed Successfully`);
    console.log(`   Job ID     : ${job.id}`);
    console.log(`   Device     : ${job.data.deviceId}`);
    console.log(`   Command    : ${job.data.command}`);
    console.log("────────────────────────────────────");
});

scheduleWorker.on("failed", (job, err) => {
    console.error(`❌ Job Failed`);
    console.error(`   Job ID     : ${job?.id}`);
    console.error(`   Device     : ${job?.data?.deviceId}`);
    console.error(`   Error      : ${err.message}`);
    console.error("────────────────────────────────────");
});

scheduleWorker.on("error", (err) => {
    console.error("Worker Error:", err.message);
});

console.log("✅ Schedule Worker Ready");
module.exports = scheduleWorker;