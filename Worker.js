// src/queues/scheduleWorker.js
const { Worker } = require("bullmq");
const redisConnection = require("./src/config/redisConnection");
const { publishCommand } = require("./src/mqtt/commandPublisher");

const scheduleWorker = new Worker("device-schedules", async (job) => {
    const { deviceId, command, scheduleId } = job.data;

    console.log(`⚡ Executing Schedule ${scheduleId} → Device ${deviceId} | Command: ${command}`);

    const success = publishCommand(deviceId, { 
        type: "COMMAND", 
        command: command,
        scheduleId 
    });

    if (!success) {
        throw new Error("Failed to send command to device");
    }

    return { status: "success", deviceId, command };
}, {
    connection: redisConnection,
    concurrency: 10
});

scheduleWorker.on("completed", (job) => {
    console.log(`✅ Schedule Job Completed: ${job.id}`);
});

scheduleWorker.on("failed", (job, err) => {
    console.error(`❌ Schedule Job Failed ${job.id}:`, err.message);
});

console.log("✅ Schedule Worker Started");

module.exports = scheduleWorker;