/**

 * Tracks recent AC apply/set_remote publishes so ESP IR self-echo

 * (source:"remote" with baked-in temp like 24) is not written to Mongo.

 */

const lastAcCommandAt = new Map();



/** Cover IR TX self-echo window (firmware mute ~3s; allow margin). */
const DEFAULT_COOLDOWN_MS = 8000;



function markAcCommandSent(deviceId) {

    const id = String(deviceId || "").trim().toUpperCase();

    if (!id) return;

    lastAcCommandAt.set(id, Date.now());

}



function isWithinAcCommandCooldown(deviceId, cooldownMs = DEFAULT_COOLDOWN_MS) {

    const id = String(deviceId || "").trim().toUpperCase();

    if (!id) return false;

    const t = lastAcCommandAt.get(id);

    if (t == null) return false;

    return Date.now() - t < cooldownMs;

}



module.exports = {

    markAcCommandSent,

    isWithinAcCommandCooldown,

    DEFAULT_COOLDOWN_MS,

};

