// src/services/scheduler/cronHelper.js
const dayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
};

const generateCron = (time, days) => {
    const [hour, minute] = time.split(":").map(Number);

    const cronDays = days.map(d => {
        const key = d.toLowerCase().trim();
        if (!(key in dayMap)) throw new Error(`Invalid day: ${d}`);
        return dayMap[key];
    }).join(",");

    return `${minute} ${hour} * * ${cronDays}`;
};

const isOvernight = (startTime, endTime) => {
    return startTime > endTime;
};

const parseHmToMinutes = (time) => {
    const [hour, minute] = String(time || "")
        .split(":")
        .map(Number);
    if (
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        throw new Error(`Invalid time: ${time}`);
    }
    return hour * 60 + minute;
};

/**
 * Next UTC instant at HH:mm on or after `afterMs` (same pattern as acKit
 * nextOneTimeOccurrenceUtcMs, but times are already stored as UTC HH:mm).
 */
function nextUtcHmOccurrenceUtcMs(utcHm, afterMs = Date.now()) {
    const total = parseHmToMinutes(utcHm);
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    const now = new Date(afterMs);

    let candidate = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        hour,
        minute,
        0,
        0
    );

    // If that clock time already passed today, use tomorrow (acKit +1500ms grace)
    if (candidate <= afterMs + 1500) {
        candidate += 24 * 60 * 60 * 1000;
    }

    return candidate;
}

/**
 * Absolute UTC start/end for a one-time event.
 *
 * Inputs are UTC HH:mm (frontend/agent already converted local → UTC).
 * `isOvernight` is computed on those UTC strings (same as recurring events).
 *
 * Examples (PKT = UTC+5):
 * - Fri 02:30–06:00 local → Thu 21:30 – Fri 01:30 UTC, isOvernight=true
 *   → end is on the UTC calendar day AFTER start (Fri 01:30).
 * - Fri 23:00–Sat 06:00 local → Fri 18:00 – Sat 01:00 UTC, isOvernight=true.
 *
 * End is always anchored to startAt's UTC date (+1 day when overnight).
 */
function oneTimeFireTimesUtcMs({
    startTime,
    endTime,
    isOvernight: overnightFlag = false,
    afterMs = Date.now(),
}) {
    const startAt = nextUtcHmOccurrenceUtcMs(startTime, afterMs);

    const endParts = parseHmToMinutes(endTime);
    const eh = Math.floor(endParts / 60);
    const em = endParts % 60;

    const startDate = new Date(startAt);
    const sy = startDate.getUTCFullYear();
    const sm = startDate.getUTCMonth();
    const sd = startDate.getUTCDate();

    const overnight =
        overnightFlag || String(endTime) <= String(startTime);

    let endAt;
    if (overnight) {
        const nextDay = new Date(Date.UTC(sy, sm, sd + 1));
        endAt = Date.UTC(
            nextDay.getUTCFullYear(),
            nextDay.getUTCMonth(),
            nextDay.getUTCDate(),
            eh,
            em,
            0,
            0
        );
    } else {
        endAt = Date.UTC(sy, sm, sd, eh, em, 0, 0);
    }

    if (endAt <= startAt) {
        endAt += 24 * 60 * 60 * 1000;
    }

    return { startAt, endAt };
}

module.exports = {
    generateCron,
    isOvernight,
    oneTimeFireTimesUtcMs,
    nextUtcHmOccurrenceUtcMs,
};
