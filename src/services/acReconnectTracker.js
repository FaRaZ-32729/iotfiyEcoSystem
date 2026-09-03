/**
 * Tracks scheduling AC devices after offline→online until ESP publishes
 * source:"sync" on .../data (Step 2 runs reconcile then).
 *
 * Fallback timer preserves today's behaviour if sync never arrives.
 */

const RECONNECT_FALLBACK_MS = 15000;

/** @type {Map<string, { markedAt: number, fallbackTimer: ReturnType<typeof setTimeout> | null }>} */
const pending = new Map();

function markPendingReconnectReconcile(deviceId, onFallback) {
    if (!deviceId) return;

    clearPendingReconnectReconcile(deviceId);

    const entry = {
        markedAt: Date.now(),
        fallbackTimer: null,
    };

    if (typeof onFallback === "function") {
        entry.fallbackTimer = setTimeout(() => {
            if (!pending.has(deviceId)) return;
            console.log(
                `[AC-RECONNECT] fallback reconcile device=${deviceId} ` +
                    `(no sync within ${RECONNECT_FALLBACK_MS}ms)`
            );
            clearPendingReconnectReconcile(deviceId);
            Promise.resolve(onFallback()).catch((err) => {
                console.error(
                    `[AC-RECONNECT] fallback reconcile failed device=${deviceId}:`,
                    err.message
                );
            });
        }, RECONNECT_FALLBACK_MS);
    }

    pending.set(deviceId, entry);
    console.log(
        `[AC-RECONNECT] pending sync reconcile device=${deviceId} ` +
            `(wait for ESP source:sync)`
    );
}

function isPendingReconnectReconcile(deviceId) {
    return pending.has(deviceId);
}

function clearPendingReconnectReconcile(deviceId) {
    const entry = pending.get(deviceId);
    if (!entry) return false;
    if (entry.fallbackTimer) {
        clearTimeout(entry.fallbackTimer);
    }
    pending.delete(deviceId);
    return true;
}

function getPendingReconnectAgeMs(deviceId) {
    const entry = pending.get(deviceId);
    if (!entry) return null;
    return Date.now() - entry.markedAt;
}

module.exports = {
    markPendingReconnectReconcile,
    isPendingReconnectReconcile,
    clearPendingReconnectReconcile,
    getPendingReconnectAgeMs,
    RECONNECT_FALLBACK_MS,
};
