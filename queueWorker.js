// src/queues/scheduleWorker.js
const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");
const Schedule = require("../models/scheduleModel");

const scheduleWorker = new Worker("device-schedules", async (job) => {
    const { deviceId, command, scheduleId } = job.data;

    console.log(`⚡ Executing Schedule ${scheduleId} → Device ${deviceId} | Command: ${command}`);

    const success = publishCommand(deviceId, {
        type: "COMMAND",
        command: command,
        scheduleId
    });

    if (!success) {
        console.log(`❌ Device ${deviceId} is offline. Command will be retried.`);
        throw new Error("Device offline - retrying later");
    }

    return { status: true, deviceId, command };
}, {
    connection: redisConnection,
    concurrency: 15
});

scheduleWorker.on("completed", (job) => {
    console.log(`✅ Schedule ${job.data.scheduleId} executed successfully`);
});

scheduleWorker.on("failed", (job, err) => {
    console.error(`❌ Schedule ${job.data.scheduleId} failed:`, err.message);
});

console.log("✅ Schedule Worker Started");

module.exports = scheduleWorker;