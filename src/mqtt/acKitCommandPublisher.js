/**
 * AC control over IoTify MQTT — IR pulse comes from Ackit brand API (not ESP flash).
 * Topic: iotify/commands/{deviceId}/control
 *
 * Payload:
 *   { action:"apply", key:"power.on", value:"{0xA6,...}", state:"on", temperature:null }
 *   { action:"set_remote", remote:"lock"|"unlock", ... }
 */
const { getClient } = require("./mqttClient");
const {
    powerToApply,
    temperatureToApplyKey,
    modeToApplyKey,
    fanToApplyKey,
    lockToRemote,
    stateToAckit,
} = require("./acKitCommandMap");
const { assertDeviceBrandCommand } = require("../services/ackitBrandService");
const { markAcCommandSent } = require("./acCommandCooldown");

function normalizeDeviceId(deviceId) {
    return String(deviceId || "")
        .trim()
        .toUpperCase();
}

function getConnectedClient(deviceId) {
    const client = getClient();
    if (!client || !client.connected) {
        console.error(`❌ MQTT Client not connected for AC device ${deviceId}`);
        return null;
    }
    return client;
}

/**
 * Send IR pulse to ESP (value from Ackit brand DB/API).
 */
function publishAcApply(deviceId, { key, value, state = null, temperature = null }) {
    const client = getConnectedClient(deviceId);
    if (!client) return false;

    const id = normalizeDeviceId(deviceId);
    if (!id || !key || value == null || value === "") return false;

    const topic = `iotify/commands/${id}/control`;
    const payload = {
        action: "apply",
        key,
        value: String(value),
        state: state || null,
        temperature:
            temperature == null || Number.isNaN(Number(temperature))
                ? null
                : Number(temperature),
    };

    client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (err) => {
        if (err) {
            console.error(`Failed to publish AC apply to ${id}:`, err);
        } else {
            console.log(
                `✅ AC apply → ${topic} key=${key} valueLen=${String(value).length} state=${
                    state || "-"
                } temp=${temperature == null ? "-" : temperature}`
            );
            console.log(
                `[AC-IR-DEBUG] MQTT apply device=${id} key=${key} ` +
                    `temp=${temperature == null ? "-" : temperature} at=${new Date().toISOString()}`
            );
        }
    });

    markAcCommandSent(id);
    return true;
}

function publishAcRemote(deviceId, { remote, state = null, temperature = null }) {
    const client = getConnectedClient(deviceId);
    if (!client) return false;

    const id = normalizeDeviceId(deviceId);
    if (!id) return false;

    const mode = ["unlock", "lock", "superlock"].includes(remote)
        ? remote
        : "unlock";

    const topic = `iotify/commands/${id}/control`;
    const payload = {
        action: "set_remote",
        remote: mode,
        state: state === "on" || state === "off" ? state : null,
        temperature:
            temperature == null || Number.isNaN(Number(temperature))
                ? null
                : Number(temperature),
    };

    client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (err) => {
        if (err) {
            console.error(`Failed to publish AC set_remote to ${id}:`, err);
        } else {
            console.log(
                `✅ AC set_remote → ${topic} remote=${mode} state=${state || "-"} temp=${
                    temperature == null ? "-" : temperature
                }`
            );
        }
    });

    markAcCommandSent(id);
    return true;
}

/** Fetch IR from Ackit for device brand, then MQTT apply */
async function publishAcApplyFromBrand(device, key, { state = null, temperature = null } = {}) {
    const check = await assertDeviceBrandCommand(device, key);
    if (!check.ok) {
        return { ok: false, status: check.status, message: check.message };
    }

    const published = publishAcApply(device.deviceId, {
        key,
        value: check.value,
        state,
        temperature,
    });

    if (!published) {
        return {
            ok: false,
            status: 503,
            message: "MQTT broker unavailable. Could not reach the device.",
        };
    }

    return { ok: true };
}

async function publishAcPower(device, command, options = {}) {
    const mapped = powerToApply(command);
    if (!mapped) {
        return { ok: false, status: 400, message: "Invalid power command" };
    }

    const temperature =
        options.temperature != null ? Number(options.temperature) : null;

    return publishAcApplyFromBrand(device, mapped.key, {
        state: mapped.state,
        temperature:
            mapped.state === "on" && Number.isFinite(temperature)
                ? temperature
                : null,
    });
}

/**
 * Publish only changed settings — each IR pulse fetched from Ackit brand.
 */
async function publishAcSettingsChanges(deviceId, changes, device) {
    const state = stateToAckit(device?.state) || "on";
    const currentTemp =
        device?.setTemperature != null ? Number(device.setTemperature) : null;
    let attempted = false;

    if (changes.setTemperature !== undefined) {
        attempted = true;
        const key = temperatureToApplyKey(changes.setTemperature);
        if (!key) return { ok: false, status: 400, message: "Invalid temperature" };
        const result = await publishAcApplyFromBrand(device, key, {
            state,
            temperature: Number(changes.setTemperature),
        });
        if (!result.ok) return result;
    }

    let needsTempReassert = false;

    if (changes.acMode !== undefined) {
        attempted = true;
        const key = modeToApplyKey(changes.acMode);
        if (!key) return { ok: false, status: 400, message: "Invalid mode" };
        const result = await publishAcApplyFromBrand(device, key, {
            state,
            temperature: currentTemp,
        });
        if (!result.ok) return result;
        // Haier-style full-state IR blobs bake in capture-time temp — reassert desired
        needsTempReassert = true;
    }

    if (changes.fanSpeed !== undefined) {
        attempted = true;
        const key = fanToApplyKey(changes.fanSpeed);
        if (!key) return { ok: false, status: 400, message: "Invalid fan speed" };
        const result = await publishAcApplyFromBrand(device, key, {
            state,
            temperature: currentTemp,
        });
        if (!result.ok) return result;
        needsTempReassert = true;
    }

    if (typeof changes.acLocked === "boolean") {
        attempted = true;
        const ok = publishAcRemote(deviceId, {
            remote: lockToRemote(changes.acLocked),
            state,
            temperature: currentTemp,
        });
        if (!ok) {
            return {
                ok: false,
                status: 503,
                message: "MQTT broker unavailable. Could not reach the device.",
            };
        }
    }

    // After mode/fan IR, always send temp.* again so AC does not keep blob's baked-in °C
    if (
        needsTempReassert &&
        changes.setTemperature === undefined &&
        Number.isFinite(currentTemp)
    ) {
        const key = temperatureToApplyKey(currentTemp);
        if (key) {
            const result = await publishAcApplyFromBrand(device, key, {
                state,
                temperature: currentTemp,
            });
            if (!result.ok) return result;
        }
    }

    if (!attempted) {
        return { ok: false, status: 400, message: "No AC settings to publish" };
    }

    return { ok: true };
}

/**
 * Power + optional temp — IR from Ackit brand API.
 */
async function publishAcPowerAndOptionalTemp(device, command, setTemperature) {
    const powerResult = await publishAcPower(device, command, {
        temperature: command === "ON" || command === "on" ? setTemperature : null,
    });
    if (!powerResult.ok) return powerResult;

    if (
        (command === "ON" || command === "on") &&
        setTemperature != null &&
        Number.isFinite(Number(setTemperature))
    ) {
        const key = temperatureToApplyKey(setTemperature);
        if (!key) {
            return { ok: false, status: 400, message: "Invalid temperature" };
        }
        return publishAcApplyFromBrand(device, key, {
            state: "on",
            temperature: Number(setTemperature),
        });
    }

    return { ok: true };
}

module.exports = {
    publishAcApply,
    publishAcRemote,
    publishAcApplyFromBrand,
    publishAcPower,
    publishAcSettingsChanges,
    publishAcPowerAndOptionalTemp,
};
