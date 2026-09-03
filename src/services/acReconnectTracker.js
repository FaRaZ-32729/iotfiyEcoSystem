/**
 * Tracks scheduling AC devices after offline→online until ESP publishes
 * source:"sync" on .../data (Steps 2–4 run then).
 *
 * Race: ESP often publishes /data sync BEFORE status=online is processed.
 * We always process source:sync for AC, and record lastSyncAt so offline→online
 * does not wait another 15s for a sync that already ran.
 */

const RECONNECT_FALLBACK_MS = 15000;
/** Sync that arrived just before status=online still counts as "already handled". */
const RECENT_SYNC_MAX_AGE_MS = 10000;

/** @type {Map<string, { markedAt: number, fallbackTimer: ReturnType<typeof setTimeout> | null }>} */
const pending = new Map();

/** @type {Map<string, number>} deviceId → Date.now() when source:sync was processed */
const lastSyncAt = new Map();

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

/** Call when AC source:sync post-reconnect logic has run (or is about to). */
function noteEspSyncProcessed(deviceId) {
    if (!deviceId) return;
    lastSyncAt.set(deviceId, Date.now());
}

/**
 * True if source:sync was already processed recently (sync-before-status race).
 * Consumes the marker so we do not skip forever.
 */
function consumeRecentEspSync(deviceId, maxAgeMs = RECENT_SYNC_MAX_AGE_MS) {
    const t = lastSyncAt.get(deviceId);
    if (t == null) return false;
    lastSyncAt.delete(deviceId);
    if (Date.now() - t > maxAgeMs) return false;
    return true;
}

function clearEspSyncMarker(deviceId) {
    lastSyncAt.delete(deviceId);
}

module.exports = {
    markPendingReconnectReconcile,
    isPendingReconnectReconcile,
    clearPendingReconnectReconcile,
    getPendingReconnectAgeMs,
    noteEspSyncProcessed,
    consumeRecentEspSync,
    clearEspSyncMarker,
    RECONNECT_FALLBACK_MS,
    RECENT_SYNC_MAX_AGE_MS,
};
