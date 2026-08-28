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
const {
    markScheduleStartPending,
    markScheduleStartDelivered,
} = require("./acScheduleStartDelivery");
const { emitDeviceScheduleUpdate } = require("./scheduleEmitHelper");

async function finishScheduleStartDelivery(deviceId, options, espTransmitted) {
    if (!options.isScheduleStart || !options.scheduleEventId) return;

    const eventId = String(options.scheduleEventId);
    if (espTransmitted) {
        await markScheduleStartPending(deviceId, eventId);
    } else {
        await markScheduleStartDelivered(deviceId, eventId, "no_ir_tx");
    }
    await emitDeviceScheduleUpdate(deviceId, "schedule_start_command");
}

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

/**
 * OFF schedule START: apply remote lock + persist acLocked.
 * Skips MQTT if already locked; logs clearly for worker debugging.
 */
async function applyOffEventStartLock(device, reason = "unknown") {
    if (device.acLocked) {
        console.log(
            `[AC-OFF-EVENT] start device=${device.deviceId} ` +
                `skip lock MQTT — already acLocked=true reason=${reason}`
        );
        return true;
    }

    const temp = Number(device.setTemperature);
    const lockOk = publishAcRemote(device.deviceId, {
        remote: lockToRemote(true),
        state: "off",
        temperature: Number.isFinite(temp) ? temp : null,
    });

    if (!lockOk) {
        console.warn(
            `[AC-OFF-EVENT] start device=${device.deviceId} lock MQTT FAILED reason=${reason}`
        );
        return false;
    }

    device.acLocked = true;
    device.lastUpdateTime = new Date();
    await device.save();
    console.log(
        `[AC-OFF-EVENT] start device=${device.deviceId} lock applied acLocked=true reason=${reason}`
    );
    return true;
}

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
        await finishScheduleStartDelivery(device.deviceId, options, false);
        return true;
    }

    if (cmd === "OFF" && currentState === "OFF") {
        console.log(
            `[AC-IR-DEBUG] skip power IR device=${device.deviceId} reason=already_off`
        );
        await applyOffEventStartLock(device, reason);
        await applyAcScheduleState(device, cmd, null);
        emitAcDeviceLive(device);
        await finishScheduleStartDelivery(device.deviceId, options, false);
        return true;
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
            await finishScheduleStartDelivery(device.deviceId, options, true);
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

        if (cmd === "OFF") {
            await applyOffEventStartLock(device, reason);
        }

        emitAcDeviceLive(device);
        console.log(
            `[AC-IR-DEBUG] IR publish OK device=${device.deviceId} reason=${reason}` +
                (cmd === "OFF" ? ` acLocked=${device.acLocked}` : "")
        );
        await finishScheduleStartDelivery(device.deviceId, options, true);
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
                `[AC-OFF-EVENT] end device=${device.deviceId} unlock MQTT FAILED reason=${reason}`
            );
            return false;
        }
        device.acLocked = false;
        console.log(
            `[AC-OFF-EVENT] end device=${device.deviceId} unlock applied acLocked=false reason=${reason}`
        );
    } else {
        console.log(
            `[AC-OFF-EVENT] end device=${device.deviceId} skip unlock — user left acLocked=false reason=${reason}`
        );
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
