// Emit CURRENT / NEXT / NO_EVENT over Socket.io for scheduling device cards.
// Call from MQTT path (main server only — has global.io). Queue worker has no io.

async function emitDeviceSchedule(deviceId, extra = {}) {
    if (!deviceId || !global.io) return null;

    try {
        // Lazy require avoids circular dep with eventController
        const { getCurrentOrNextScheduleData } = require("../controllers/eventController");
        const eventData = await getCurrentOrNextScheduleData(deviceId);
        const payload = {
            ...eventData,
            ...extra,
        };
        global.io.emit(`device/${deviceId}/schedule`, payload);
        console.log(
            `📅 Live schedule → ${deviceId} | type=${payload.type || "?"} | event=${payload.event?._id || "none"}`
        );
        return payload;
    } catch (err) {
        console.error(`❌ emitDeviceSchedule(${deviceId}):`, err.message);
        return null;
    }
}

module.exports = { emitDeviceSchedule };
