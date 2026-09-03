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
    clearScheduleStartDelivery,
} = require("./acScheduleStartDelivery");
const { emitDeviceScheduleUpdate } = require("./scheduleEmitHelper");

async function finishScheduleStartDelivery(deviceId, options, { immediate = false } = {}) {
    if (!options.isScheduleStart || !options.scheduleEventId) return;

    const eventId = String(options.scheduleEventId);
    if (immediate) {
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
 * OFF events always lock; ON events lock only when applyLock is true.
 */
function eventUsesLock(schedule) {
    if (!schedule) return false;
    const cmd = String(schedule.command || "ON").toUpperCase();
    if (cmd === "OFF") return true;
    return cmd === "ON" && schedule.applyLock === true;
}

/**
 * Schedule START: apply remote lock + persist acLocked when eventUsesLock.
 */
async function applyAcEventStartLock(device, schedule, reason = "unknown") {
    if (!eventUsesLock(schedule)) return true;

    if (device.acLocked) {
        console.log(
            `[AC-EVENT-LOCK] start device=${device.deviceId} ` +
                `skip lock MQTT — already acLocked=true reason=${reason}`
        );
        return true;
    }

    const cmd = String(schedule?.command || "OFF").toUpperCase();
    const lockState = cmd === "ON" ? "on" : "off";
    const temp = Number(device.setTemperature);
    const lockOk = publishAcRemote(device.deviceId, {
        remote: lockToRemote(true),
        state: lockState,
        temperature: Number.isFinite(temp) ? temp : null,
    });

    if (!lockOk) {
        console.warn(
            `[AC-EVENT-LOCK] start device=${device.deviceId} lock MQTT FAILED reason=${reason}`
        );
        return false;
    }

    device.acLocked = true;
    device.lastUpdateTime = new Date();
    await device.save();
    console.log(
        `[AC-EVENT-LOCK] start device=${device.deviceId} lock applied acLocked=true ` +
            `state=${lockState} reason=${reason}`
    );
    return true;
}

async function maybeApplyEventStartLock(device, schedule, command, reason) {
    const cmd = String(command || "").toUpperCase();
    if ((cmd === "OFF" || cmd === "ON") && eventUsesLock(schedule)) {
        await applyAcEventStartLock(device, schedule, reason);
    }
}

const runAcScheduledCommand = async (device, schedule, command, options = {}) => {
    const trackingStart =
        options.isScheduleStart === true && !!options.scheduleEventId;

    if (trackingStart) {
        await markScheduleStartPending(
            device.deviceId,
            options.scheduleEventId
        );
    }

    const setTemperature =
        command === "ON" && schedule?.setTemperature != null
            ? schedule.setTemperature
            : null;
    const reason = options.reason || "unknown";
    const cmd = String(command || "").toUpperCase();
    const usingEspSnapshot =
        options.actualEspState != null || options.actualEspSetTemp != null;
    const currentState =
        options.actualEspState != null
            ? String(options.actualEspState).toUpperCase()
            : String(device.state || "").toUpperCase();
    const currentTemp =
        options.actualEspSetTemp != null &&
        Number.isFinite(Number(options.actualEspSetTemp))
            ? Number(options.actualEspSetTemp)
            : Number(device.setTemperature);
    const targetTemp =
        setTemperature != null && Number.isFinite(Number(setTemperature))
            ? Number(setTemperature)
            : null;

    console.log(
        `[AC-IR-DEBUG] runAcScheduledCommand device=${device.deviceId} ` +
            `cmd=${cmd} temp=${targetTemp ?? "-"} reason=${reason} ` +
            `${usingEspSnapshot ? "espSnapshot" : "mongo"}State=${currentState} ` +
            `${usingEspSnapshot ? "espSnapshot" : "mongo"}Temp=${
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
        await maybeApplyEventStartLock(device, schedule, cmd, reason);
        emitAcDeviceLive(device);
        await finishScheduleStartDelivery(device.deviceId, options, {
            immediate: true,
        });
        return true;
    }

    if (cmd === "OFF" && currentState === "OFF") {
        console.log(
            `[AC-IR-DEBUG] skip power IR device=${device.deviceId} reason=already_off`
        );
        await maybeApplyEventStartLock(device, schedule, cmd, reason);
        await applyAcScheduleState(device, cmd, null);
        emitAcDeviceLive(device);
        await finishScheduleStartDelivery(device.deviceId, options, {
            immediate: true,
        });
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
            if (trackingStart) {
                await clearScheduleStartDelivery(
                    device.deviceId,
                    "schedule_start_failed"
                );
            }
            return false;
        }
        const result = await publishAcApplyFromBrand(device, key, {
            state: "on",
            temperature: targetTemp,
        });
        if (result?.ok) {
            await applyAcScheduleState(device, cmd, targetTemp);
            await maybeApplyEventStartLock(device, schedule, cmd, reason);
            emitAcDeviceLive(device);
            console.log(
                `[AC-IR-DEBUG] IR publish OK device=${device.deviceId} reason=${reason} mode=temp_only`
            );
            await finishScheduleStartDelivery(device.deviceId, options);
            return true;
        }
        console.warn(
            `AC schedule MQTT failed for ${device.deviceId}:`,
            result?.message || "unknown",
            `reason=${reason}`
        );
        if (trackingStart) {
            await clearScheduleStartDelivery(
                device.deviceId,
                "schedule_start_failed"
            );
        }
        return false;
    }

    const result = await publishAcMqttCommand(device, cmd, targetTemp);

    if (result?.ok) {
        await applyAcScheduleState(device, cmd, targetTemp);
        await maybeApplyEventStartLock(device, schedule, cmd, reason);

        emitAcDeviceLive(device);
        console.log(
            `[AC-IR-DEBUG] IR publish OK device=${device.deviceId} reason=${reason}` +
                (eventUsesLock(schedule) ? ` acLocked=${device.acLocked}` : "")
        );
        await finishScheduleStartDelivery(device.deviceId, options);
        return true;
    }

    console.warn(
        `AC schedule MQTT failed for ${device.deviceId}:`,
        result?.message || "unknown",
        `reason=${reason}`
    );
    if (trackingStart) {
        await clearScheduleStartDelivery(device.deviceId, "schedule_start_failed");
    }
    return false;
};

/**
 * Event END: conditional unlock when event used lock.
 * Skip if user already unlocked during the window.
 */
async function runAcConditionalUnlockAtEventEnd(device, schedule, options = {}) {
    const reason = options.reason || "event_lock_end";

    if (!eventUsesLock(schedule)) {
        return true;
    }

    console.log(
        `[AC-EVENT-LOCK] end device=${device.deviceId} acLocked=${device.acLocked} ` +
            `reason=${reason} schedule=${schedule?._id || "-"}`
    );

    if (!device.acLocked) {
        console.log(
            `[AC-EVENT-LOCK] end device=${device.deviceId} skip unlock — ` +
                `user left acLocked=false reason=${reason}`
        );
        return true;
    }

    const unlockOk = publishAcRemote(device.deviceId, {
        remote: lockToRemote(false),
        state: stateToAckit(device.state) || "off",
        temperature:
            Number.isFinite(Number(device.setTemperature)) ?
                Number(device.setTemperature) :
                null,
    });
    if (!unlockOk) {
        console.warn(
            `[AC-EVENT-LOCK] end device=${device.deviceId} unlock MQTT FAILED reason=${reason}`
        );
        return false;
    }

    device.acLocked = false;
    device.lastUpdateTime = new Date();
    console.log(
        `[AC-EVENT-LOCK] end device=${device.deviceId} unlock applied acLocked=false reason=${reason}`
    );
    return true;
}

/**
 * OFF schedule END: keep AC off + conditional unlock when event used lock.
 */
const runAcOffEventEnd = async (device, schedule, options = {}) => {
    const reason = options.reason || "off_event_end";
    console.log(
        `[AC-OFF-EVENT] end device=${device.deviceId} reason=${reason} schedule=${schedule?._id || "-"}`
    );

    device.state = "OFF";
    device.lastUpdateTime = new Date();

    const unlocked = await runAcConditionalUnlockAtEventEnd(device, schedule, {
        reason,
    });
    if (!unlocked) return false;

    await device.save();
    emitAcDeviceLive(device);
    return true;
};

/**
 * Push lock MQTT to ESP after reconnect (ESP reboot clears gLockMode in RAM).
 * Always sends — does not skip when Mongo already acLocked.
 */
async function resyncAcLockToEsp(device, reason = "reconnect") {
    if (!device?.acLocked) return false;

    const state = stateToAckit(device.state) || "off";
    const temp = Number(device.setTemperature);
    const lockOk = publishAcRemote(device.deviceId, {
        remote: lockToRemote(true),
        state,
        temperature: Number.isFinite(temp) ? temp : null,
    });

    console.log(
        `[AC-RECONNECT] lock resync device=${device.deviceId} reason=${reason} ` +
            `state=${state} temp=${Number.isFinite(temp) ? temp : "-"} ok=${lockOk}`
    );
    return lockOk;
}

/**
 * Locked + no active event: dashboard state/temp wins over ESP ROM.
 */
async function applyLockedDashboardVsEsp(device, espSnapshot, reason = "reconnect") {
    const dashboardState = String(device.state || "OFF").toUpperCase();
    const dashboardTemp = Number(device.setTemperature);

    const espState =
        espSnapshot?.state != null
            ? String(espSnapshot.state).toUpperCase()
            : dashboardState;
    const espTemp =
        espSnapshot?.setTemperature != null &&
        Number.isFinite(Number(espSnapshot.setTemperature))
            ? Number(espSnapshot.setTemperature)
            : null;

    const stateMismatch = espState !== dashboardState;
    const tempMismatch =
        dashboardState === "ON" &&
        Number.isFinite(dashboardTemp) &&
        espTemp != null &&
        espTemp !== dashboardTemp;

    if (!stateMismatch && !tempMismatch) {
        console.log(
            `[AC-RECONNECT] locked device=${device.deviceId} ESP matches dashboard ` +
                `(${dashboardState}@${Number.isFinite(dashboardTemp) ? dashboardTemp : "-"}) — IR skip`
        );
        return { applied: false };
    }

    console.log(
        `[AC-RECONNECT] locked mismatch device=${device.deviceId} reason=${reason} ` +
            `esp=${espState}@${espTemp ?? "-"} dashboard=${dashboardState}@${
                Number.isFinite(dashboardTemp) ? dashboardTemp : "-"
            }`
    );

    if (stateMismatch) {
        const tempForCmd =
            dashboardState === "ON" && Number.isFinite(dashboardTemp)
                ? dashboardTemp
                : null;
        await publishAcMqttCommand(device, dashboardState, tempForCmd);
        return { applied: true };
    }

    const tempKey = temperatureToApplyKey(dashboardTemp);
    if (tempKey) {
        await publishAcApplyFromBrand(device, tempKey, {
            state: "on",
            temperature: dashboardTemp,
        });
        return { applied: true };
    }

    return { applied: false };
}

/**
 * Step 3: after post-sync reconnect — lock resync; dashboard baseline when no event.
 */
async function reconcileLockedAcAfterReconnect(device, espSnapshot, options = {}) {
    if (!device || device.deviceType !== "AC" || !device.acLocked) {
        return { skipped: true, reason: "not_locked_ac" };
    }

    const reason = options.reason || "post_sync_reconnect_lock";
    const lockOk = await resyncAcLockToEsp(device, reason);

    if (options.eventReconciled) {
        console.log(
            `[AC-RECONNECT] locked device=${device.deviceId} event already reconciled — lock resync only`
        );
        return { lockResync: lockOk, stateApply: false, reason: "event_reconciled" };
    }

    const { applied } = await applyLockedDashboardVsEsp(device, espSnapshot, reason);
    return { lockResync: lockOk, stateApply: applied };
}

/**
 * Step 4: unlocked + no active event — ESP ROM state/temp → Mongo + UI.
 */
async function applyUnlockedEspRomToDashboard(device, espSnapshot, reason = "post_sync_reconnect") {
    if (!device || device.deviceType !== "AC" || device.acLocked) {
        return { skipped: true, reason: "locked_or_not_ac" };
    }

    const updates = [];
    const espState =
        espSnapshot?.state != null
            ? String(espSnapshot.state).toUpperCase()
            : null;
    const espTemp =
        espSnapshot?.setTemperature != null &&
        Number.isFinite(Number(espSnapshot.setTemperature))
            ? Number(espSnapshot.setTemperature)
            : null;

    if (espState && ["ON", "OFF"].includes(espState) && device.state !== espState) {
        device.state = espState;
        updates.push(`state→${espState}`);
    }

    const mongoTemp = Number(device.setTemperature);
    if (
        espTemp != null &&
        (!Number.isFinite(mongoTemp) || mongoTemp !== espTemp)
    ) {
        device.setTemperature = espTemp;
        updates.push(`setTemperature→${espTemp}`);
    }

    if (!updates.length) {
        console.log(
            `[AC-RECONNECT] unlocked device=${device.deviceId} ESP ROM matches dashboard — no DB change`
        );
        return { updated: false };
    }

    device.lastUpdateTime = new Date();
    await device.save();
    emitAcDeviceLive(device);

    console.log(
        `[AC-RECONNECT] unlocked ESP ROM → dashboard device=${device.deviceId} ` +
            `reason=${reason} ${updates.join(" ")}`
    );
    return { updated: true, updates };
}

module.exports = {
    buildAcCommandPayload,
    applyAcScheduleState,
    emitAcDeviceLive,
    runAcScheduledCommand,
    runAcOffEventEnd,
    runAcConditionalUnlockAtEventEnd,
    eventUsesLock,
    publishAcMqttCommand,
    publishAcLockReassert,
    resyncAcLockToEsp,
    reconcileLockedAcAfterReconnect,
    applyUnlockedEspRomToDashboard,
};
