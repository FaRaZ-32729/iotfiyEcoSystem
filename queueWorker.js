// src/queues/scheduleWorker.js
const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");
const { connectMQTT } = require("./src/mqtt/mqttClient");
const Event = require("./src/models/eventModel");
const dbConnection = require("./src/config/dbConnection");

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

const scheduleWorker = new Worker("device-schedules", async (job) => {

    const { deviceId, command, eventId } = job.data;
    console.log(" job data ", job.data)


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

    if (!mqttConnected) {
        console.warn("⚠️ MQTT not connected, trying to reconnect...");
        await initializeMQTTForWorker();
    }

    const success = publishCommand(deviceId, {
        type: "COMMAND",
        command: command,
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

// Better logging
// scheduleWorker.on("completed", (job) => {
//     console.log(`✅ Job Completed: ${job}`);
// });

// scheduleWorker.on("failed", (job, err) => {
//     console.error(`❌ Job Failed: ${job?.data} | ${err.message}`);
// });

// ==================== IMPROVED LOGGING ====================
scheduleWorker.on("completed", (job) => {
    console.log(`✅ Job Completed Successfully`);
    console.log(`   Job ID     : ${job.id}`);
    console.log(`   Device     : ${job.data.deviceId}`);
    console.log(`   Command    : ${job.data.command}`);
    console.log(`   Event ID   : ${job.data.eventId}`);
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