// src/queues/scheduleQueue.js
const { Queue } = require("bullmq");
const redisConnection = require("../config/redis");

const scheduleQueue = new Queue("device-schedules", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false
    }
});

console.log("✅ Schedule Queue Initialized");

module.exports = scheduleQueue;