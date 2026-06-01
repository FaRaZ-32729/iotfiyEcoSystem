// src/queues/scheduleWorker.js

const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");
const Schedule = require("./src/models/eventModel");
const { connectMQTT } = require("./src/mqtt/mqttClient");

console.log("✅ Schedule Worker Starting...");

// Initialize MQTT for Worker
connectMQTT();

const scheduleWorker = new Worker("device-schedules", async (job) => {
    console.log(`⚡ [SCHEDULE TRIGGERED] ${new Date().toUTCString()} (UTC) → Job ${job.id}`);

    const { scheduleId, deviceId, command } = job.data;

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
        console.error(`❌ Failed to send command to ${deviceId}`);
        throw new Error("MQTT Publish Failed");
    }

}, {
    connection: redisConnection,
    concurrency: 5,
    timezone: "UTC"           // ← UTC
});

// Logging
scheduleWorker.on("completed", (job) => {
    console.log(`✅ Schedule Completed → ${job.data.scheduleId}`);
});

scheduleWorker.on("failed", (job, err) => {
    console.error(`❌ Schedule Failed → ${job.data?.scheduleId} | ${err.message}`);
});

console.log("✅ Schedule Worker Ready (UTC)");

module.exports = scheduleWorker;

