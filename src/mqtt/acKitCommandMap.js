/**
 * Map ecoSystem AC UI/DB values → Ackit ESP flash command keys.
 * Keys must already exist on the device (friend OTA / brand sync).
 */

const MODE_TO_KEY = {
    Cool: "mode.cool",
    Heat: "mode.heat",
    Dry: "mode.dry",
    FanOnly: "mode.fan",
    Auto: "mode.auto",
};

const FAN_TO_KEY = {
    Low: "fan.low",
    Medium: "fan.medium",
    High: "fan.high",
    Ultra: "fan.ultra",
    Turbo: "fan.turbo",
};

/** "ON" | "OFF" → { key, state } */
function powerToApply(command) {
    const upper = String(command || "").toUpperCase();
    if (upper === "ON") return { key: "power.on", state: "on" };
    if (upper === "OFF") return { key: "power.off", state: "off" };
    return null;
}

/** 16–30 → temp.{n} */
function temperatureToApplyKey(temp) {
    const n = Number(temp);
    if (!Number.isFinite(n) || n < 16 || n > 30) return null;
    return `temp.${Math.round(n)}`;
}

/** Cool|Heat|… → mode.* */
function modeToApplyKey(acMode) {
    const mode = String(acMode || "").trim();
    return MODE_TO_KEY[mode] || null;
}

/** Low|Medium|… → fan.* */
function fanToApplyKey(fanSpeed) {
    const speed = String(fanSpeed || "").trim();
    return FAN_TO_KEY[speed] || null;
}

/** acLocked boolean → unlock | lock */
function lockToRemote(acLocked) {
    return acLocked ? "lock" : "unlock";
}

/** Device state ON/OFF → lowercase for Ackit payloads */
function stateToAckit(state) {
    const upper = String(state || "").toUpperCase();
    if (upper === "ON") return "on";
    if (upper === "OFF") return "off";
    return null;
}

module.exports = {
    MODE_TO_KEY,
    FAN_TO_KEY,
    powerToApply,
    temperatureToApplyKey,
    modeToApplyKey,
    fanToApplyKey,
    lockToRemote,
    stateToAckit,
};
