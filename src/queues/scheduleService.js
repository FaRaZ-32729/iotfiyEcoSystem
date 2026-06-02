// src/services/scheduler/scheduleService.js
const { publishCommand } = require("../mqtt/commandPublisher");
const scheduleQueue = require("./scheduleQueue");


// const addScheduleJob = async (jobId, data, cronExpression) => {
//     try {
//         const now = new Date();
//         const currentHour = String(now.getUTCHours()).padStart(2, '0');
//         const currentMinute = String(now.getUTCMinutes()).padStart(2, '0');
//         const currentTime = `${currentHour}:${currentMinute}`;

//         const isStartTimePassed = data.type === "start" && currentTime >= data.startTime;

//         const jobOptions = {
//             jobId: jobId,
//             repeat: {
//                 cron: cronExpression,
//                 tz: "UTC"
//             },
//             attempts: 3,
//             backoff: { type: "exponential", delay: 2000 }
//         };

//         // Force immediate run if start time has already passed
//         if (isStartTimePassed) {
//             console.log(`⚡ Start time already passed (${currentTime}). Running immediately.`);
//             jobOptions.delay = 1000;   // Run after 1 second
//         }

//         const job = await scheduleQueue.add("device-schedule", data, jobOptions);

//         console.log(`📅 Schedule Job Added → ${jobId} | Cron: ${cronExpression}`);
//         return job;

//     } catch (error) {
//         console.error(`❌ Failed to add schedule job ${jobId}:`, error);
//         throw error;
//     }
// };

// Helper to remove a schedule

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
            const startTime = data.startTime;   // e.g., "12:15"
            const endTime = data.endTime;       // e.g., "12:30"

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

const removeScheduleJob = async (jobId) => {
    try {
        await scheduleQueue.removeRepeatableByKey(jobId);
        console.log(`🗑️ Removed schedule job: ${jobId}`);
    } catch (error) {
        console.error(`Failed to remove job ${jobId}:`, error);
    }
};

module.exports = {
    addScheduleJob,
    removeScheduleJob
};


// const addScheduleJob = async (jobId, data, cronExpression) => {
//     return await scheduleQueue.add(
//         "schedule-job",
//         data,
//         {
//             jobId: jobId,
//             repeat: {
//                 cron: cronExpression,
//                 tz: "UTC",
//                 immediately: false
//             }
//         }
//     );
// };

// module.exports = { addScheduleJob };