// src/queues/scheduleWorker.js
const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");
const { connectMQTT } = require("./src/mqtt/mqttClient");
const Event = require("./src/models/eventModel");
const dbConnection = require("./src/config/dbConnection");
const Device = require("./src/models/deviceModel");
const TriggerSchedule = require("./src/models/triggerEventModel");
const env = require("dotenv").config();

console.log("✅ Schedule Worker Starting...");

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

    // ==================== TRIGGER SCHEDULE CHECK ====================
    if (device.category === "trigger") {
        const triggerEvent = await TriggerSchedule.findOne({
            _id: eventId,
            deviceId: deviceId
        });

        if (triggerEvent && triggerEvent.status === "INACTIVE") {
            console.log(`⛔ Skipping command ${command} for Trigger Device ${deviceId} - Event is INACTIVE`);
            return { skipped: true, reason: "inactive_trigger_event" };
        }

        console.log(`✅ Trigger Event is ACTIVE → Proceeding with command`);
    }


    const schedule = await Event.findOne({
        _id: eventId,
        deviceId: deviceId,
    })
    console.log("event", schedule)
    if (schedule && schedule.isRecurring && schedule.status === "INACTIVE") {
        console.log(`⛔ Skipping command ${command} for ${deviceId} - Recurring event is INACTIVE`);
        return { skipped: true, reason: "inactive_recurring" };
    }

    const today = new Date().toISOString().split('T')[0];
    if (schedule && schedule.manualOverride && schedule.overrideDate === today) {
        console.log(`⛔ Skipping command ${command} for ${deviceId} due to manual override today`);
        return { skipped: true, reason: "manual_override" };
    }


    console.log(`⚡ [SCHEDULE EXECUTING] ${new Date().toUTCString()}`);
    console.log(`   Device: ${deviceId} | Command: ${command}`);

    // ==================== CALCULATE REMAINING SECONDS ====================
    let durationSeconds = null;

    if (command === "ON" && schedule.endTime) {
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

    const success = publishCommand(deviceId, {
        type: "COMMAND",
        command: command,
        durationSeconds: durationSeconds,
        timestamp: new Date().toISOString()
    });

    if (success) {
        console.log(`✅ Command "${command}" sent to ${deviceId}`);
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