/**
 * Tracks whether a schedule START command was confirmed by ESP (source:"apply").
 * Persisted on Device so worker + API server proces5ses share state.
 * Manual toggles must NOT call markScheduleStartPending.
 */
const Device = require("../models/deviceModel");
const { getCurrentOrNextScheduleData } = require("./scheduleLookupService");
const { isWithinAcCommandCooldown } = require("../mqtt/acCommandCooldown");

function normalizeDeviceId(deviceId) {
    return String(deviceId || "").trim().toUpperCase();
}

function normalizeEventId(eventId) {
    return eventId != null ? String(eventId) : "";
}

async function markScheduleStartPending(deviceId, eventId) {
    const id = normalizeDeviceId(deviceId);
    const eid = normalizeEventId(eventId);
    if (!id || !eid) return;

    await Device.findOneAndUpdate(
        { deviceId: id },
        {
            scheduleStartPendingEventId: eid,
            scheduleStartDeliveredEventId: null,
        }
    );
    console.log(`[SCHEDULE-DELIVERY] pending device=${id} event=${eid}`);
}

async function markScheduleStartDelivered(deviceId, eventId, reason = "unknown") {
    const id = normalizeDeviceId(deviceId);
    const eid = normalizeEventId(eventId);
    if (!id || !eid) return;

    await Device.findOneAndUpdate(
        { deviceId: id },
        {
            scheduleStartDeliveredEventId: eid,
            scheduleStartPendingEventId: null,
        }
    );
    console.log(
        `[SCHEDULE-DELIVERY] delivered device=${id} event=${eid} reason=${reason}`
    );
}

async function clearScheduleStartDelivery(deviceId, reason = "unknown") {
    const id = normalizeDeviceId(deviceId);
    if (!id) return;

    await Device.findOneAndUpdate(
        { deviceId: id },
        {
            scheduleStartPendingEventId: null,
            scheduleStartDeliveredEventId: null,
        }
    );
    console.log(`[SCHEDULE-DELIVERY] cleared device=${id} reason=${reason}`);
}

async function tryConfirmScheduleStartFromEsp(deviceId) {
    const id = normalizeDeviceId(deviceId);
    const device = await Device.findOne({ deviceId: id })
        .select("scheduleStartPendingEventId scheduleStartDeliveredEventId")
        .lean();

    if (device?.scheduleStartPendingEventId) {
        const eventId = String(device.scheduleStartPendingEventId);
        await markScheduleStartDelivered(id, eventId, "esp_apply");
        return { eventId };
    }

    const live = await getCurrentOrNextScheduleData(id);
    if (live?.type !== "CURRENT" || !live?.event?._id) return null;

    const currentEventId = String(live.event._id);
    if (
        device?.scheduleStartDeliveredEventId != null &&
        String(device.scheduleStartDeliveredEventId) === currentEventId
    ) {
        return { eventId: currentEventId };
    }

    // ESP apply can arrive before worker finishes writing pending (cross-process race)
    if (
        device?.scheduleStartPendingEventId == null &&
        isWithinAcCommandCooldown(id)
    ) {
        await markScheduleStartDelivered(id, currentEventId, "esp_apply_race_recover");
        return { eventId: currentEventId };
    }

    return null;
}

async function getScheduleDeliveryFlags(deviceId, eventData) {
    const id = normalizeDeviceId(deviceId);
    const eventId =
        eventData?.event?._id != null ? String(eventData.event._id) : null;

    if (!eventId || eventData?.type !== "CURRENT") {
        return {
            scheduleStartDelivered: false,
            scheduleStartPending: false,
        };
    }

    const device = await Device.findOne({ deviceId: id })
        .select("scheduleStartPendingEventId scheduleStartDeliveredEventId")
        .lean();

    const delivered =
        device?.scheduleStartDeliveredEventId != null &&
        String(device.scheduleStartDeliveredEventId) === eventId;
    const pending =
        !delivered &&
        device?.scheduleStartPendingEventId != null &&
        String(device.scheduleStartPendingEventId) === eventId;

    return { scheduleStartDelivered: delivered, scheduleStartPending: pending };
}

module.exports = {
    markScheduleStartPending,
    markScheduleStartDelivered,
    clearScheduleStartDelivery,
    tryConfirmScheduleStartFromEsp,
    getScheduleDeliveryFlags,
};
