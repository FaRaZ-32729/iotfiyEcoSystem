// Shared CURRENT/NEXT schedule lookup (dashboard + agent).
const Event = require("../models/eventModel");

const DAY_ORDER = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];

const toMinutes = (hhmm = "00:00") => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

const prevDayName = (day) => {
    const i = DAY_ORDER.indexOf(day);
    return DAY_ORDER[(i + 6) % 7];
};

/** Recurring → use saved weekdays; one-time / empty days → today only. */
const resolveDays = (sch, currentDay) => {
    const days = (sch.days || [])
        .map((d) => String(d).toLowerCase().trim())
        .filter(Boolean);
    if (sch.isRecurring && days.length > 0) return days;
    return [currentDay];
};

const isScheduleActiveNow = (sch, currentDay, currentMin) => {
    const days = resolveDays(sch, currentDay);
    const start = toMinutes(sch.startTime);
    const end = toMinutes(sch.endTime);

    if (!sch.isOvernight) {
        return days.includes(currentDay) && currentMin >= start && currentMin < end;
    }

    // Overnight: started today after startTime, OR started yesterday and still before endTime
    if (days.includes(currentDay) && currentMin >= start) return true;
    if (days.includes(prevDayName(currentDay)) && currentMin < end) return true;
    return false;
};

/**
 * Next start Date (UTC ms) for this schedule after `now`.
 * Among multiple selected weekdays, picks the soonest upcoming start.
 */
const nextStartMs = (sch, now, currentDay) => {
    const days = resolveDays(sch, currentDay);
    const startMin = toMinutes(sch.startTime);
    const nowDayIdx = now.getUTCDay();
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const isOneTime = !sch.isRecurring || !(sch.days || []).length;

    let best = null;

    for (const dayName of days) {
        const targetIdx = DAY_ORDER.indexOf(dayName);
        if (targetIdx < 0) continue;

        let deltaDays = (targetIdx - nowDayIdx + 7) % 7;

        // Same weekday: if start already passed (or is now / running), jump to next week
        if (deltaDays === 0 && startMin <= nowMin) {
            deltaDays = 7;
        }

        // One-time events only apply once — no next-week rollover
        if (isOneTime && deltaDays === 7) continue;

        const [h, m] = String(sch.startTime)
            .split(":")
            .map(Number);
        const occ = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + deltaDays,
            Number.isFinite(h) ? h : 0,
            Number.isFinite(m) ? m : 0,
            0,
            0
        );

        if (best === null || occ < best) best = occ;
    }

    return best;
};

/**
 * Find currently running or next upcoming ACTIVE schedule for a device.
 * Times are compared in UTC (HH:mm), matching the Events/scheduling UI logic.
 *
 * NEXT: across all selected weekdays, choose the nearest upcoming day+time
 * (not limited to "today only").
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
        const currentMin = toMinutes(currentTime);

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
        let nextEventAt = null;

        for (const sch of schedules) {
            if (isScheduleActiveNow(sch, currentDay, currentMin)) {
                currentEvent = sch;
                console.log(
                    `[SCHEDULE-DEBUG][LOOKUP]  active-now ${sch._id}`
                );
                break;
            }

            const at = nextStartMs(sch, now, currentDay);
            if (at == null) {
                console.log(
                    `[SCHEDULE-DEBUG][LOOKUP]  no-next-start ${sch._id}`
                );
                continue;
            }

            console.log(
                `[SCHEDULE-DEBUG][LOOKUP]  candidate-next ${sch._id} at=${new Date(at).toISOString()}`
            );

            if (nextEventAt === null || at < nextEventAt) {
                nextEvent = sch;
                nextEventAt = at;
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

            console.log(
                `[SCHEDULE-DEBUG][LOOKUP] → NEXT event=${nextEvent._id} ` +
                    `at=${nextEventAt != null ? new Date(nextEventAt).toISOString() : "?"}`
            );
            return {
                type: "NEXT",
                event: nextEvent,
                totalDurationMinutes: totalDuration,
                totalDurationText: `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m`,
                nextStartsAt: nextEventAt != null ? new Date(nextEventAt).toISOString() : null,
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

module.exports = {
    getCurrentOrNextScheduleData,
    isScheduleActiveNow,
};
