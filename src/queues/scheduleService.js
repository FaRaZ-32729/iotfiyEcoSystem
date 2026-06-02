// src/services/scheduler/scheduleService.js
const { publishCommand } = require("../mqtt/commandPublisher");
const scheduleQueue = require("./scheduleQueue");

const addScheduleJob = async (jobId, data, cronExpression) => {
    try {
        const now = new Date();
        const currentHour = String(now.getUTCHours()).padStart(2, '0');
        const currentMinute = String(now.getUTCMinutes()).padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;

        console.log(`Current UTC Time: ${currentTime} | Job Type: ${data.type}`);

        // Add recurring job
        const job = await scheduleQueue.add("device-schedule", data, {
            jobId: jobId,
            repeat: {
                cron: cronExpression,
                tz: "UTC"
            },
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 }
        });

        console.log(`📅 Recurring Schedule Added → ${jobId} | Cron: ${cronExpression}`);

        // ==================== IMMEDIATE TRIGGER LOGIC ====================
        if (data.type === "start") {
            const startTime = data.startTime;
            const endTime = data.endTime;

            console.log(`Checking if current time (${currentTime}) is between ${startTime} and ${endTime}`);

            const isCurrentlyActive = currentTime >= startTime && currentTime < endTime;

            if (isCurrentlyActive) {
                console.log(`⚡ Current time is INSIDE the event window. Sending immediate ON command...`);

                const success = publishCommand(data.deviceId, {
                    type: "COMMAND",
                    command: "ON",
                    scheduleId: jobId
                });

                if (success) {
                    console.log(`✅ Immediate ON command successfully sent to ${data.deviceId}`);
                } else {
                    console.warn(`⚠️ Failed to send immediate command to ${data.deviceId}`);
                }
            } else {
                console.log(`⏭️ Current time is OUTSIDE the event window.`);
            }
        }

        return job;

    } catch (error) {
        console.error(`❌ Failed to add schedule job ${jobId}:`, error);
        throw error;
    }
};

// const removeScheduleJob = async (jobId) => {
//     try {
//         await scheduleQueue.removeRepeatableByKey(jobId);
//         console.log(`🗑️ Removed schedule job: ${jobId}`);
//     } catch (error) {
//         console.error(`Failed to remove job ${jobId}:`, error);
//     }
// };

module.exports = {
    addScheduleJob
};
