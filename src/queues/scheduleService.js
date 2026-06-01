// src/services/scheduler/scheduleService.js
const scheduleQueue = require("./scheduleQueue");

const addScheduleJob = async (jobId, data, cronExpression) => {
    return await scheduleQueue.add(
        "schedule-job",
        data,
        {
            jobId: jobId,
            repeat: {
                cron: cronExpression,
                tz: "UTC",
                immediately: false
            }
        }
    );
};

module.exports = { addScheduleJob };