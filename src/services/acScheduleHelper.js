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
        acHealthMonitoringIncluded: device.acHealthMonitoringIncluded,
        energyMonitoringIncluded: device.energyMonitoringIncluded,
        espTemperature: device.espTemperature,
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
    const cmd = String(command || "").toUpperCase();
    const currentState = String(device.state || "").toUpperCase();
    const currentTemp = Number(device.setTemperature);
    const targetTemp =
        setTemperature != null && Number.isFinite(Number(setTemperature))
            ? Number(setTemperature)
            : null;

    console.log(
        `[AC-IR-DEBUG] runAcScheduledCommand device=${device.deviceId} ` +
            `cmd=${cmd} temp=${targetTemp ?? "-"} reason=${reason} ` +
            `deviceState=${currentState} deviceTemp=${
                Number.isFinite(currentTemp) ? currentTemp : "-"
            } at=${new Date().toISOString()}`
    );

    // Already matches desired schedule state → do NOT re-TX power.on.
    // Re-sending power.on causes physical AC to briefly jump to the blob's
    // baked-in capture temp (often 24) before temp.N corrects it.
    if (
        cmd === "ON" &&
        currentState === "ON" &&
        targetTemp != null &&
        Number.isFinite(currentTemp) &&
        currentTemp === targetTemp
    ) {
        console.log(
            `[AC-IR-DEBUG] skip IR device=${device.deviceId} ` +
                `reason=already_on_matching_temp_${targetTemp} (no power.on)`
        );
        await applyAcScheduleState(device, cmd, targetTemp);
        emitAcDeviceLive(device);
        return true;
    }

    if (cmd === "OFF" && currentState === "OFF") {
        console.log(
            `[AC-IR-DEBUG] skip power IR device=${device.deviceId} reason=already_off`
        );
        // OFF schedule start: still apply lock if user left it unlocked
        const lockOk = publishAcRemote(device.deviceId, {
            remote: lockToRemote(true),
            state: "off",
            temperature: Number.isFinite(currentTemp) ? currentTemp : null,
        });
        if (lockOk && !device.acLocked) {
            device.acLocked = true;
        }
        await applyAcScheduleState(device, cmd, null);
        emitAcDeviceLive(device);
        return lockOk;
    }

    // Already ON but wrong temp → only temp.* (avoid power.on baked-temp flash)
    if (cmd === "ON" && currentState === "ON" && targetTemp != null) {
        console.log(
            `[AC-IR-DEBUG] temp-only IR device=${device.deviceId} ` +
                `from=${currentTemp} to=${targetTemp} (skip power.on)`
        );
        const key = temperatureToApplyKey(targetTemp);
        if (!key) {
            console.warn(
                `AC schedule invalid temp for ${device.deviceId}:`,
                targetTemp
            );
            return false;
        }
        const result = await publishAcApplyFromBrand(device, key, {
            state: "on",
            temperature: targetTemp,
        });
        if (result?.ok) {
            await applyAcScheduleState(device, cmd, targetTemp);
            emitAcDeviceLive(device);
            console.log(
                `[AC-IR-DEBUG] IR publish OK device=${device.deviceId} reason=${reason} mode=temp_only`
            );
            return true;
        }
        console.warn(
            `AC schedule MQTT failed for ${device.deviceId}:`,
            result?.message || "unknown",
            `reason=${reason}`
        );
        return false;
    }

    const result = await publishAcMqttCommand(device, cmd, targetTemp);

    if (result?.ok) {
        await applyAcScheduleState(device, cmd, targetTemp);

        // OFF schedule start: power off + auto lock (user may change lock during window)
        if (cmd === "OFF" && !device.acLocked) {
            const lockOk = publishAcRemote(device.deviceId, {
                remote: lockToRemote(true),
                state: "off",
                temperature:
                    Number.isFinite(Number(device.setTemperature)) ?
                        Number(device.setTemperature) :
                        null,
            });
            if (lockOk) {
                device.acLocked = true;
                device.lastUpdateTime = new Date();
                await device.save();
            } else {
                console.warn(
                    `AC OFF schedule lock MQTT failed for ${device.deviceId} reason=${reason}`
                );
            }
        }

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

/**
 * OFF schedule END: keep AC off. Unlock only if still locked
 * (event lock or user re-locked after unlocking during the window).
 * Skip unlock if user left it unlocked during the event.
 */
const runAcOffEventEnd = async (device, schedule, options = {}) => {
    const reason = options.reason || "off_event_end";
    console.log(
        `[AC-OFF-EVENT] end device=${device.deviceId} acLocked=${device.acLocked} ` +
            `reason=${reason} schedule=${schedule?._id || "-"}`
    );

    device.state = "OFF";
    device.lastUpdateTime = new Date();

    if (device.acLocked) {
        const unlockOk = publishAcRemote(device.deviceId, {
            remote: lockToRemote(false),
            state: "off",
            temperature:
                Number.isFinite(Number(device.setTemperature)) ?
                    Number(device.setTemperature) :
                    null,
        });
        if (!unlockOk) {
            console.warn(
                `AC OFF schedule unlock MQTT failed for ${device.deviceId} reason=${reason}`
            );
            return false;
        }
        device.acLocked = false;
    }

    await device.save();
    emitAcDeviceLive(device);
    return true;
};

module.exports = {
    buildAcCommandPayload,
    applyAcScheduleState,
    emitAcDeviceLive,
    runAcScheduledCommand,
    runAcOffEventEnd,
    publishAcMqttCommand,
    publishAcLockReassert,
};
