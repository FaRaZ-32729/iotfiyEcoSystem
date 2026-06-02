// src/queues/scheduleWorker.js
const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");
const { connectMQTT } = require("./src/mqtt/mqttClient");
const Event = require("./src/models/eventModel");

console.log("✅ Schedule Worker Starting...");

let mqttConnected = false;

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

    const { deviceId, command, scheduleId } = job.data;


    const today = new Date().toISOString().split('T')[0];
    const schedule = await Event.findById(scheduleId);
    if (schedule && schedule.manualOverride && schedule.overrideDate === today) {
        console.log(`⛔ Skipping command ${command} for ${deviceId} due to manual override today`);
        return { skipped: true, reason: "manual_override" };
    }


    console.log(`⚡ [SCHEDULE EXECUTING] ${new Date().toUTCString()}`);
    console.log(`   Device: ${deviceId} | Command: ${command} | Job: ${scheduleId}`);

    if (!mqttConnected) {
        console.warn("⚠️ MQTT not connected, trying to reconnect...");
        await initializeMQTTForWorker();
    }

    const success = publishCommand(deviceId, {
        type: "COMMAND",
        command: command,
        scheduleId: scheduleId,
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
scheduleWorker.on("completed", (job) => {
    console.log(`✅ Job Completed: ${job.data.scheduleId}`);
});

scheduleWorker.on("failed", (job, err) => {
    console.error(`❌ Job Failed: ${job?.data?.scheduleId} | ${err.message}`);
});

scheduleWorker.on("error", (err) => {
    console.error("Worker Error:", err.message);
});

console.log("✅ Schedule Worker Ready");
module.exports = scheduleWorker;