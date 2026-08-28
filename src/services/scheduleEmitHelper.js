const { getCurrentOrNextScheduleData } = require("./scheduleLookupService");
const { getScheduleDeliveryFlags } = require("./acScheduleStartDelivery");

async function buildScheduleSocketPayload(deviceId, extra = {}) {
    const eventData = await getCurrentOrNextScheduleData(deviceId);
    const delivery = await getScheduleDeliveryFlags(deviceId, eventData);
    return {
        ...eventData,
        ...delivery,
        ...extra,
    };
}

async function emitDeviceScheduleUpdate(deviceId, reason = "schedule_mutation") {
    if (!deviceId || !global.io) return null;
    try {
        const payload = await buildScheduleSocketPayload(deviceId);
        global.io.emit(`device/${deviceId}/schedule`, payload);
        console.log(
            `[SCHEDULE-DEBUG][EMIT] device=${deviceId} reason=${reason} ` +
                `type=${payload?.type || "?"} eventId=${payload?.event?._id || "none"} ` +
                `startDelivered=${payload?.scheduleStartDelivered === true}`
        );
        return payload;
    } catch (err) {
        console.error(`[SCHEDULE-DEBUG][EMIT] failed device=${deviceId}:`, err.message);
        return null;
    }
}

module.exports = {
    buildScheduleSocketPayload,
    emitDeviceScheduleUpdate,
};
