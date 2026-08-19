// src/services/scheduler/scheduleService.js
const { publishCommand } = require("../mqtt/commandPublisher");
const scheduleQueue = require("./scheduleQueue");
const Device = require("../models/deviceModel");
// const { runAcScheduledCommand } = require("../acScheduleHelper");
const { runAcScheduledCommand } = require("../services/acScheduleHelper");

const addScheduleJob = async (jobId, data, cronExpression) => {
    try {
        const now = new Date();
        const currentHour = String(now.getUTCHours()).padStart(2, '0');
        const currentMinute = String(now.getUTCMinutes()).padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;

        const utcDayName = now.toLocaleString('en-US', {
            weekday: 'long',
            timeZone: 'UTC'
        }).toLowerCase();

        console.log(`Current UTC Time: ${currentTime} | Day: ${utcDayName} | Job Type: ${data.type}`);

        // Add job to queue
        const job = await scheduleQueue.add("device-schedule", data, {
            jobId: jobId,
            repeat: {
                cron: cronExpression,
                tz: "UTC"
            },
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 }
        });

        console.log(`📅 Schedule Job Added → ${jobId} | Cron: ${cronExpression}`);

        // ==================== IMMEDIATE TRIGGER LOGIC (Only for TODAY) ====================
        if (data.type === "start") {
            const { startTime, endTime, command = "ON" } = data;

            const isForToday = data.days?.length
                ? data.days.some(day => day.toLowerCase() === utcDayName)
                : true;

            if (!isForToday) {
                console.log(`⏭️ Schedule is for future day(s). No immediate trigger.`);
                return job;
            }

            console.log(`Checking if current time (${currentTime}) is inside window: ${startTime} - ${endTime}`);

            const isCurrentlyActive = currentTime >= startTime && currentTime < endTime;

            if (isCurrentlyActive) {
                console.log(`⚡ Current time is INSIDE active window → Sending immediate ${command} command...`);

                const device = await Device.findOne({ deviceId: data.deviceId });

                if (device?.deviceType === "AC") {
                    const fakeSchedule = {
                        setTemperature: data.setTemperature,
                        command,
                    };
                    const success = await runAcScheduledCommand(device, fakeSchedule, command, {
                        scheduleId: jobId,
                        isImmediate: true,
                        reason: "immediate_on_create_inside_window",
                    });
                    if (success) {
                        console.log(`✅ Immediate AC ${command} sent to ${data.deviceId}`);
                    } else {
                        console.warn(`⚠️ Failed immediate AC command for ${data.deviceId}`);
                    }
                } else {
                    const success = publishCommand(data.deviceId, {
                        type: "COMMAND",
                        command: "ON",
                        scheduleId: jobId,
                        isImmediate: true
                    });

                    if (success) {
                        console.log(`✅ Immediate ON command successfully sent to ${data.deviceId}`);
                    } else {
                        console.warn(`⚠️ Failed to send immediate command`);
                    }
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

/**
 * BullMQ stores repeatable jobs under a generated key
 * (`repeat:<hash>:<ts>`), NOT our custom jobId
 * (`schedule-end-JO4Y3U-<eventId>`). Calling removeRepeatableByKey(jobId)
 * is a no-op — deleted events keep firing start/OFF crons.
 */
const removeScheduleJob = async (jobId) => {
    if (!jobId) return;
    const wanted = String(jobId);
    let removed = 0;

    try {
        const repeatables = await scheduleQueue.getRepeatableJobs();
        for (const r of repeatables) {
            const rid = String(r.id || "");
            if (rid === wanted) {
                await scheduleQueue.removeRepeatableByKey(r.key);
                removed += 1;
                console.log(`🗑️ Removed repeatable id=${rid} key=${r.key}`);
            }
        }

        const queued = await scheduleQueue.getJobs([
            "delayed",
            "waiting",
            "paused",
            "active",
        ]);
        for (const job of queued) {
            const jid = String(job.id || "");
            const repeatId = String(job.opts?.repeat?.jobId || "");
            if (jid === wanted || repeatId === wanted) {
                await job.remove();
                removed += 1;
                console.log(`🗑️ Removed queued job id=${jid}`);
            }
        }

        if (!removed) {
            console.warn(`⚠️ No BullMQ job found to remove for ${wanted}`);
        }
    } catch (error) {
        console.error(`Failed to remove job ${jobId}:`, error);
    }
};

/** Remove every start/end cron whose jobId or payload still points at this event. */
const removeJobsForEventId = async (eventId) => {
    const id = String(eventId || "").trim();
    if (!id) return;

    try {
        const repeatables = await scheduleQueue.getRepeatableJobs();
        for (const r of repeatables) {
            if (String(r.id || "").includes(id)) {
                await scheduleQueue.removeRepeatableByKey(r.key);
                console.log(`🗑️ Removed orphan repeatable for event ${id} key=${r.key}`);
            }
        }

        const queued = await scheduleQueue.getJobs([
            "delayed",
            "waiting",
            "paused",
            "active",
        ]);
        for (const job of queued) {
            const matches =
                String(job.data?.eventId || "") === id ||
                String(job.id || "").includes(id) ||
                String(job.opts?.repeat?.jobId || "").includes(id);
            if (matches) {
                await job.remove();
                console.log(`🗑️ Removed orphan queued job ${job.id} for event ${id}`);
            }
        }
    } catch (error) {
        console.error(`Failed to remove jobs for event ${id}:`, error);
    }
};

module.exports = {
    addScheduleJob,
    removeScheduleJob,
    removeJobsForEventId,
};
