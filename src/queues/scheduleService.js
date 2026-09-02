// src/services/scheduler/scheduleService.js
const { publishCommand } = require("../mqtt/commandPublisher");
const scheduleQueue = require("./scheduleQueue");
const Device = require("../models/deviceModel");
const { runAcScheduledCommand } = require("../services/acScheduleHelper");
const {
    isOvernight,
    isUtcTimeInsideEventWindow,
    isMillisInsideWindow,
} = require("./cronHelper");

/** BullMQ 5 cron instances use ids like repeat:<hash>:<ts> — not removable via job.remove() */
const isSchedulerInstanceJob = (job) => String(job?.id || "").startsWith("repeat:");

const removeQueuedJobSafe = async (job) => {
    if (isSchedulerInstanceJob(job)) return false;
    try {
        await job.remove();
        return true;
    } catch (err) {
        const msg = String(err?.message || "");
        if (err?.code === -8 || /job scheduler/i.test(msg)) {
            return false;
        }
        throw err;
    }
};

/**
 * Remove a recurring cron by our custom scheduler id (schedule-start-… / schedule-end-…).
 * BullMQ 5+: Job Schedulers (remove via key — see bullmq docs / issue #3244).
 * Legacy: getRepeatableJobs + removeRepeatableByKey.
 */
const removeSchedulerById = async (schedulerId) => {
    const wanted = String(schedulerId || "").trim();
    if (!wanted) return 0;

    let removed = 0;

    if (typeof scheduleQueue.getJobSchedulers === "function") {
        const schedulers = await scheduleQueue.getJobSchedulers(0, -1, false);
        for (const s of schedulers) {
            const sid = String(s.id || "");
            const skey = String(s.key || "");
            const matches = sid === wanted || skey === wanted || skey.includes(wanted);
            if (!matches) continue;

            const removeId = skey || sid || wanted;
            try {
                const ok = await scheduleQueue.removeJobScheduler(removeId);
                if (ok) {
                    removed += 1;
                    console.log(`🗑️ Removed job scheduler key=${removeId}`);
                }
            } catch (err) {
                console.warn(`removeJobScheduler(${removeId}):`, err.message);
            }
        }
    }

    if (typeof scheduleQueue.removeJobScheduler === "function") {
        try {
            const ok = await scheduleQueue.removeJobScheduler(wanted);
            if (ok) {
                removed += 1;
                console.log(`🗑️ Removed job scheduler id=${wanted}`);
            }
        } catch (err) {
            console.warn(`removeJobScheduler(${wanted}):`, err.message);
        }
    }

    const repeatables = await scheduleQueue.getRepeatableJobs();
    for (const r of repeatables) {
        const rid = String(r.id || "");
        const rkey = String(r.key || "");
        if (rid === wanted || rkey.includes(wanted)) {
            await scheduleQueue.removeRepeatableByKey(rkey);
            removed += 1;
            console.log(`🗑️ Removed repeatable id=${rid} key=${rkey}`);
        }
    }

    return removed;
};

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
            const overnight = isOvernight(startTime, endTime);

            const dayOrder = [
                "sunday",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
            ];
            const prevUtcDay =
                dayOrder[(dayOrder.indexOf(utcDayName) + 6) % 7];

            // Overnight morning segment (e.g. Tue 02:00) belongs to Monday's start day
            const isForToday = data.days?.length
                ? overnight && currentTime < endTime
                    ? data.days.some((day) => day.toLowerCase() === prevUtcDay)
                    : data.days.some((day) => day.toLowerCase() === utcDayName)
                : true;

            if (!isForToday) {
                console.log(`⏭️ Schedule is for future day(s). No immediate trigger.`);
                return job;
            }

            console.log(
                `Checking if current time (${currentTime}) is inside window: ${startTime} - ${endTime}` +
                    (overnight ? " (overnight)" : "")
            );

            const isCurrentlyActive = isUtcTimeInsideEventWindow({
                currentTimeHm: currentTime,
                startTime,
                endTime,
                isOvernight: overnight,
            });

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
                        isScheduleStart: true,
                        scheduleEventId: data.eventId,
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
 * Remove start/end cron for one event by our custom jobId
 * (`schedule-start-<deviceId>-<eventId>` / `schedule-end-…`).
 */
const removeScheduleJob = async (jobId) => {
    if (!jobId) return;
    const wanted = String(jobId);

    try {
        let removed = await removeSchedulerById(wanted);

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
                if (await removeQueuedJobSafe(job)) {
                    removed += 1;
                    console.log(`🗑️ Removed queued job id=${jid}`);
                }
            }
        }

        if (!removed) {
            console.warn(`⚠️ No BullMQ job found to remove for ${wanted}`);
        }
    } catch (error) {
        console.error(`Failed to remove job ${jobId}:`, error);
        throw error;
    }
};

/** Remove every start/end cron whose scheduler id or payload points at this event. */
const removeJobsForEventId = async (eventId) => {
    const id = String(eventId || "").trim();
    if (!id) return;

    try {
        let removed = 0;
        const suffix = `-${id}`;

        if (typeof scheduleQueue.getJobSchedulers === "function") {
            const schedulers = await scheduleQueue.getJobSchedulers(0, -1, false);
            for (const s of schedulers) {
                const sid = String(s.id || "");
                const skey = String(s.key || "");
                const payloadEventId = String(s.template?.data?.eventId || "");
                const matches =
                    sid.endsWith(suffix) ||
                    skey.includes(id) ||
                    payloadEventId === id;
                if (!matches) continue;

                const removeId = skey || sid;
                try {
                    const ok = await scheduleQueue.removeJobScheduler(removeId);
                    if (ok) {
                        removed += 1;
                        console.log(`🗑️ Removed job scheduler for event ${id} key=${removeId}`);
                    }
                } catch (err) {
                    console.warn(`removeJobScheduler event(${id}):`, err.message);
                }
            }
        }

        const repeatables = await scheduleQueue.getRepeatableJobs();
        for (const r of repeatables) {
            if (String(r.id || "").includes(id)) {
                await scheduleQueue.removeRepeatableByKey(r.key);
                removed += 1;
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
            if (matches && (await removeQueuedJobSafe(job))) {
                removed += 1;
                console.log(`🗑️ Removed orphan queued job ${job.id} for event ${id}`);
            }
        }

        if (!removed) {
            console.warn(`⚠️ No BullMQ jobs found for event ${id}`);
        }
    } catch (error) {
        console.error(`Failed to remove jobs for event ${id}:`, error);
        throw error;
    }
};

/**
 * ONE-TIME only: fire start command immediately when create lands inside window.
 * Uses absolute windowStartAt/windowEndAt (ms), not HH:mm re-parse.
 */
async function runImmediateStartIfInsideWindow(data, { startAt, endAt }) {
    const now = Date.now();
    if (!isMillisInsideWindow(now, startAt, endAt)) {
        console.log(
            `⏭️ One-time outside window now=${new Date(now).toISOString()} ` +
                `window=${new Date(startAt).toISOString()}→${new Date(endAt).toISOString()}`
        );
        return;
    }

    const command = data.command || "ON";
    const { deviceId } = data;

    console.log(
        `⚡ One-time inside window → immediate ${command} for ${deviceId} ` +
            `(${new Date(startAt).toISOString()}→${new Date(endAt).toISOString()})`
    );

    const device = await Device.findOne({ deviceId });
    if (device?.deviceType === "AC") {
        const fakeSchedule = {
            setTemperature: data.setTemperature,
            command,
            applyLock: data.applyLock,
        };
        await runAcScheduledCommand(device, fakeSchedule, command, {
            scheduleId: data.eventId,
            isImmediate: true,
            reason: "immediate_on_create_inside_window",
            isScheduleStart: true,
            scheduleEventId: data.eventId,
        });
        return;
    }

    publishCommand(deviceId, {
        type: "COMMAND",
        command: "ON",
        scheduleId: data.eventId,
        isImmediate: true,
    });
}

/**
 * ONE-TIME only: delayed start + end jobs (recurring uses weekly cron instead).
 * Start job → event.command (ON/OFF). End job → OFF for ON events; worker handles OFF-event unlock.
 */
const addOneTimeScheduleJobs = async ({
    startJobId,
    endJobId,
    data,
    startAt,
    endAt,
}) => {
    const now = Date.now();
    const startDelay = Math.max(0, startAt - now);
    const endDelay = Math.max(0, endAt - now);
    const startCommand = data.command || "ON";

    await scheduleQueue.add(
        "device-schedule",
        { ...data, type: "start", command: startCommand, oneTime: true },
        {
            jobId: startJobId,
            delay: startDelay,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false,
        }
    );

    await scheduleQueue.add(
        "device-schedule",
        { ...data, type: "end", command: "OFF", oneTime: true },
        {
            jobId: endJobId,
            delay: endDelay,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false,
        }
    );

    console.log(
        `📅 One-time ${data.eventId} start in ${Math.round(startDelay / 1000)}s ` +
            `end in ${Math.round(endDelay / 1000)}s cmd=${startCommand} ` +
            `(${new Date(startAt).toISOString()} → ${new Date(endAt).toISOString()})`
    );

    await runImmediateStartIfInsideWindow(data, { startAt, endAt });
};

module.exports = {
    addScheduleJob,
    addOneTimeScheduleJobs,
    removeScheduleJob,
    removeJobsForEventId,
};
