// Shared CURRENT/NEXT schedule lookup (dashboard + agent).
const Event = require("../models/eventModel");

/**
 * Find currently running or next upcoming ACTIVE schedule for a device.
 * Times are compared in UTC (HH:mm), matching the Events/scheduling UI logic.
 */
const getCurrentOrNextScheduleData = async (deviceId) => {
    try {
        const now = new Date();

        const currentTime = `${String(now.getUTCHours()).padStart(2, "0")}:${String(
            now.getUTCMinutes()
        ).padStart(2, "0")}`;
        const currentDay = now
            .toLocaleString("en-US", {
                weekday: "long",
                timeZone: "UTC",
            })
            .toLowerCase();

        const schedules = await Event.find({
            deviceId: deviceId,
            status: "ACTIVE",
        }).sort({ startTime: 1 });

        console.log(
            `[SCHEDULE-DEBUG][LOOKUP] device=${deviceId} utcNow=${currentDay} ${currentTime} ` +
                `activeEvents=${schedules.length}`
        );
        for (const sch of schedules) {
            console.log(
                `[SCHEDULE-DEBUG][LOOKUP]  event=${sch._id} ` +
                    `${sch.startTime}-${sch.endTime} days=${JSON.stringify(sch.days)} ` +
                    `recurring=${sch.isRecurring} overnight=${sch.isOvernight} status=${sch.status}`
            );
        }

        let currentEvent = null;
        let nextEvent = null;

        for (const sch of schedules) {
            const { startTime, endTime, days, isOvernight, isRecurring } = sch;

            if (isRecurring && !days.includes(currentDay)) {
                console.log(
                    `[SCHEDULE-DEBUG][LOOKUP]  skip ${sch._id} — day mismatch (need ${currentDay})`
                );
                continue;
            }

            let isActiveNow = false;

            if (!isOvernight) {
                if (currentTime >= startTime && currentTime < endTime) {
                    isActiveNow = true;
                }
            } else if (currentTime >= startTime || currentTime < endTime) {
                isActiveNow = true;
            }

            if (isActiveNow) {
                currentEvent = sch;
                break;
            } else if (!currentEvent && currentTime < startTime) {
                if (!nextEvent || startTime < nextEvent.startTime) {
                    nextEvent = sch;
                }
            }
        }

        const calculateTotalDuration = (startTime, endTime) => {
            const [startH, startM] = startTime.split(":").map(Number);
            const [endH, endM] = endTime.split(":").map(Number);

            let duration = endH * 60 + endM - (startH * 60 + startM);
            if (duration < 0) duration += 24 * 60;
            return duration;
        };

        if (currentEvent) {
            const totalDuration = calculateTotalDuration(
                currentEvent.startTime,
                currentEvent.endTime
            );

            const [endHour, endMinute] = currentEvent.endTime.split(":").map(Number);
            let endDate = new Date(
                Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    endHour,
                    endMinute,
                    0
                )
            );
            if (endDate <= now) endDate.setUTCDate(endDate.getUTCDate() + 1);

            const remainingMinutes = Math.floor((endDate - now) / (1000 * 60));

            console.log(`[SCHEDULE-DEBUG][LOOKUP] → CURRENT event=${currentEvent._id}`);
            return {
                type: "CURRENT",
                event: currentEvent,
                totalDurationMinutes: totalDuration,
                totalDurationText: `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`,
                remainingMinutes: remainingMinutes,
                remainingText: `${remainingMinutes} min remaining`,
            };
        }

        if (nextEvent) {
            const totalDuration = calculateTotalDuration(
                nextEvent.startTime,
                nextEvent.endTime
            );

            console.log(`[SCHEDULE-DEBUG][LOOKUP] → NEXT event=${nextEvent._id}`);
            return {
                type: "NEXT",
                event: nextEvent,
                totalDurationMinutes: totalDuration,
                totalDurationText: `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`,
            };
        }

        console.log(`[SCHEDULE-DEBUG][LOOKUP] → NO_EVENT for ${deviceId}`);
        return {
            type: "NO_EVENT",
            event: null,
            message: "No active or upcoming schedule found",
        };
    } catch (err) {
        console.error("Get Current/Next Schedule Error:", err);
        return {
            type: "NO_EVENT",
            event: null,
            message: "Error fetching schedule",
        };
    }
};

module.exports = { getCurrentOrNextScheduleData };
