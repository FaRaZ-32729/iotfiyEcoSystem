// src/services/scheduler/cronHelper.js
const dayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

const generateCron = (time, days) => {
    const [hour, minute] = time.split(":").map(Number);

    const cronDays = days
        .map((d) => {
            const key = d.toLowerCase().trim();
            if (!(key in dayMap)) throw new Error(`Invalid day: ${d}`);
            return dayMap[key];
        })
        .join(",");

    return `${minute} ${hour} * * ${cronDays}`;
};

/** UTC HH:mm strings — same rule used for recurring events at create + lookup. */
const isOvernight = (startTime, endTime) => {
    return String(startTime) > String(endTime);
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

function formatUtcHm(date) {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
        date.getUTCMinutes()
    ).padStart(2, "0")}`;
}

/**
 * Is `currentTimeHm` inside [startTime, endTime) in UTC?
 * Same logic as recurring `addScheduleJob` immediate trigger and
 * `scheduleLookupService.isScheduleActiveNow` (HH:mm path).
 */
function isUtcTimeInsideEventWindow({
    currentTimeHm,
    startTime,
    endTime,
    isOvernight: overnightFlag,
}) {
    const overnight =
        overnightFlag || String(endTime) <= String(startTime);

    if (!overnight) {
        return currentTimeHm >= startTime && currentTimeHm < endTime;
    }
    return currentTimeHm >= startTime || currentTimeHm < endTime;
}

/**
 * Build absolute UTC window for ONE-TIME events only (isRecurring === false).
 *
 * Recurring events do NOT use this — they use weekly cron on `startTime`/`endTime`
 * + `days` (+ `shiftDays` for overnight end cron).
 *
 * Rules (UTC, times already converted from UI local):
 * 1. Anchor to the UTC calendar day at create (`afterMs`).
 * 2. Overnight morning tail: if overnight AND now < endTime, the window started
 *    YESTERDAY (same as recurring `prevUtcDay` check in addScheduleJob).
 * 3. startAt = anchorDay @ startTime; endAt = anchorDay or +1 day @ endTime.
 * 4. Start may be in the past if user creates mid-window — that is OK.
 * 5. Caller rejects if endAt <= now (window already over).
 */
function oneTimeFireTimesUtcMs({
    startTime,
    endTime,
    isOvernight: overnightFlag = false,
    afterMs = Date.now(),
}) {
    const now = new Date(afterMs);
    const overnight =
        overnightFlag || String(endTime) <= String(startTime);

    let anchorY = now.getUTCFullYear();
    let anchorM = now.getUTCMonth();
    let anchorD = now.getUTCDate();

    const currentHm = formatUtcHm(now);

    // Overnight morning segment: e.g. window 18:00→01:00, now 00:30 → anchor yesterday
    if (overnight && currentHm < endTime) {
        const prev = new Date(Date.UTC(anchorY, anchorM, anchorD - 1));
        anchorY = prev.getUTCFullYear();
        anchorM = prev.getUTCMonth();
        anchorD = prev.getUTCDate();
    }

    const startParts = parseHmToMinutes(startTime);
    const endParts = parseHmToMinutes(endTime);
    const sh = Math.floor(startParts / 60);
    const sm = startParts % 60;
    const eh = Math.floor(endParts / 60);
    const em = endParts % 60;

    const startAt = Date.UTC(anchorY, anchorM, anchorD, sh, sm, 0, 0);

    let endAt;
    if (overnight) {
        const nextDay = new Date(Date.UTC(anchorY, anchorM, anchorD + 1));
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
        endAt = Date.UTC(anchorY, anchorM, anchorD, eh, em, 0, 0);
    }

    if (endAt <= startAt) {
        endAt += 24 * 60 * 60 * 1000;
    }

    return { startAt, endAt, isOvernight: overnight };
}

function isMillisInsideWindow(nowMs, startAt, endAt) {
    return nowMs >= startAt && nowMs < endAt;
}

module.exports = {
    generateCron,
    isOvernight,
    oneTimeFireTimesUtcMs,
    isUtcTimeInsideEventWindow,
    isMillisInsideWindow,
    formatUtcHm,
};
