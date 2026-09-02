/**
 * ONE-TIME scheduling events only (days empty at create → isRecurring === false).
 * Recurring events (isRecurring === true) must never use these helpers.
 */

function isOneTimeSchedulingEvent(schedule) {
    return schedule != null && schedule.isRecurring === false;
}

function hasOneTimeWindow(schedule) {
    return (
        isOneTimeSchedulingEvent(schedule) &&
        schedule.windowStartAt != null &&
        schedule.windowEndAt != null
    );
}

module.exports = {
    isOneTimeSchedulingEvent,
    hasOneTimeWindow,
};
