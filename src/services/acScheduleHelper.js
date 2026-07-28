// AC schedule command + DB/socket sync (shared by worker, immediate trigger, reconciliation)
const {
    publishAcPowerAndOptionalTemp,
    publishAcRemote,
    publishAcApplyFromBrand,
} = require("../mqtt/acKitCommandPublisher");
const {
    temperatureToApplyKey,
    stateToAckit,
    lockToRemote,
} = require("../mqtt/acKitCommandMap");

/**
 * Legacy Haier-shaped payload builder — kept for any non-MQTT callers/logging.
 */
const buildAcCommandPayload = (device, command, options = {}) => {
    const { setTemperature, durationSeconds, scheduleId, isImmediate, isManual } = options;

    const payload = {
        type: "COMMAND",
        command,
        timestamp: new Date().toISOString(),
    };

    if (durationSeconds != null) payload.durationSeconds = durationSeconds;
    if (scheduleId) payload.scheduleId = scheduleId;
    if (isImmediate) payload.isImmediate = true;
    if (isManual) payload.isManual = true;

    if (command === "ON" && setTemperature != null) {
        payload.setTemperature = setTemperature;
    }
    if (device.acMode) payload.mode = device.acMode;
    if (device.fanSpeed) payload.fanSpeed = device.fanSpeed;
    if (device.acLocked) payload.lock = true;

    return payload;
};

const applyAcScheduleState = async (device, command, setTemperature) => {
    device.state = command;
    if (command === "ON" && setTemperature != null) {
        device.setTemperature = setTemperature;
    }
    device.lastUpdateTime = new Date();
    await device.save();
};

const emitAcDeviceLive = (device) => {
    if (!global.io) return;

    global.io.emit(`device/${device.deviceId}`, {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        state: device.state,
        setTemperature: device.setTemperature,
        acMode: device.acMode,
        fanSpeed: device.fanSpeed,
        acLocked: device.acLocked,
        acHealthAlert: device.acHealthAlert,
        energyMonitoringIncluded: device.energyMonitoringIncluded,
        espCurrent: device.espCurrent,
        espVoltage: device.espVoltage,
        espPower: device.espPower,
        espEnergy: device.espEnergy,
        timestamp: new Date(),
    });
};

/** Power (+ optional temp) — IR pulses from Ackit brand API */
const publishAcMqttCommand = async (device, command, setTemperature) => {
    return publishAcPowerAndOptionalTemp(device, command, setTemperature);
};

/**
 * When AC is locked and remote changes setpoint, re-assert app temp + lock over MQTT.
 */
const publishAcLockReassert = async (device) => {
    const state = stateToAckit(device.state) || "on";
    const temp = Number(device.setTemperature);
    const tempKey = temperatureToApplyKey(temp);

    const remoteOk = publishAcRemote(device.deviceId, {
        remote: lockToRemote(true),
        state,
        temperature: Number.isFinite(temp) ? temp : null,
    });
    if (!remoteOk) return false;

    if (!tempKey) return true;

    const result = await publishAcApplyFromBrand(device, tempKey, {
        state,
        temperature: temp,
    });
    return result.ok;
};

const runAcScheduledCommand = async (device, schedule, command, options = {}) => {
    const setTemperature =
        command === "ON" && schedule?.setTemperature != null
            ? schedule.setTemperature
            : null;
    const reason = options.reason || "unknown";

    // DEBUG: every IR schedule path must log a reason — if you see this many
    // times/min during an event, that caller is causing AC beeps / 24 flicker.
    console.log(
        `[AC-IR-DEBUG] runAcScheduledCommand device=${device.deviceId} ` +
            `cmd=${command} temp=${setTemperature ?? "-"} reason=${reason} ` +
            `at=${new Date().toISOString()}`
    );

    const result = await publishAcMqttCommand(device, command, setTemperature);

    if (result?.ok) {
        await applyAcScheduleState(device, command, setTemperature);
        emitAcDeviceLive(device);
        console.log(
            `[AC-IR-DEBUG] IR publish OK device=${device.deviceId} reason=${reason}`
        );
        return true;
    }

    console.warn(
        `AC schedule MQTT failed for ${device.deviceId}:`,
        result?.message || "unknown",
        `reason=${reason}`
    );
    return false;
};

module.exports = {
    buildAcCommandPayload,
    applyAcScheduleState,
    emitAcDeviceLive,
    runAcScheduledCommand,
    publishAcMqttCommand,
    publishAcLockReassert,
};
