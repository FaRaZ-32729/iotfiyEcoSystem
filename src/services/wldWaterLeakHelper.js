/**
 * WLD (water leakage) — ESP publishes:
 *   { "waterLeak": true | false }  or  1 | 0
 *
 * No threshold conditions — Detected = ESP value directly.
 */

function parseWaterLeak(value) {
    if (value === true || value === 1 || value === "1") return true;
    if (value === false || value === 0 || value === "0") return false;
    const s = String(value).toLowerCase().trim();
    if (s === "true" || s === "detected" || s === "leak") return true;
    if (s === "false" || s === "not detected" || s === "clear" || s === "dry") return false;
    return null;
}

/**
 * Apply ESP waterLeak → espWaterLeak + waterLeakAlert (no conditions).
 * @returns {boolean} true if waterLeak was applied
 */
function applyWldWaterLeakFromPayload(device, payload, updatedFields = []) {
    if (!device || device.deviceType !== "WLD" || !payload) return false;
    if (payload.waterLeak === undefined || payload.waterLeak === null || payload.waterLeak === "") {
        return false;
    }

    const leaked = parseWaterLeak(payload.waterLeak);
    if (leaked === null) return false;

    device.espWaterLeak = leaked;
    device.waterLeakAlert = leaked;
    payload.waterLeak = leaked;

    updatedFields.push(`waterLeak: ${leaked}`);
    return true;
}

/**
 * Push waterLeak alert into alerts[] when leak is detected.
 */
function syncWldWaterLeakFromAlert(device, alerts = []) {
    if (!device || device.deviceType !== "WLD") return alerts;

    if (device.espWaterLeak === true || device.waterLeakAlert === true) {
        device.waterLeakAlert = true;
        if (!alerts.some((a) => a.type === "waterLeak")) {
            alerts.push({
                type: "waterLeak",
                value: "Detected",
                message: "Water Leak Detected",
            });
        }
    } else {
        device.waterLeakAlert = false;
    }
    return alerts;
}

module.exports = {
    applyWldWaterLeakFromPayload,
    syncWldWaterLeakFromAlert,
    parseWaterLeak,
};
