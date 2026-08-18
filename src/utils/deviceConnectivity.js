/**
 * Match Dashboard device-card LED (useDeviceWebSocket):
 * - Online when live MQTT status/data arrives over WebSocket.
 * - Backup: if no data for 90s → offline (60s interval + 30s grace).
 * Agent has no live WS, so approximate with lastUpdateTime / lastSeen freshness (same 90s).
 */
const ONLINE_STALE_MS = 90 * 1000;

function computeConnectivity(d) {
    const dbStatus = String(d?.status || "offline").toLowerCase();
    const now = Date.now();
    const lastSeenMs = d?.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    const lastUpdateMs = d?.lastUpdateTime
        ? new Date(d.lastUpdateTime).getTime()
        : 0;
    const freshest = Math.max(lastUpdateMs || 0, lastSeenMs || 0);
    const ageMs = freshest ? now - freshest : null;
    const recentlyActive =
        ageMs != null && ageMs >= 0 && ageMs <= ONLINE_STALE_MS;

    let isOnline = false;
    let reason = "no_recent_activity";

    if (dbStatus === "offline" && !recentlyActive) {
        isOnline = false;
        reason = "db_status_offline";
    } else if (recentlyActive) {
        isOnline = true;
        reason =
            lastUpdateMs && lastUpdateMs === freshest
                ? "recent_data_within_90s"
                : "recent_status_within_90s";
    } else if (dbStatus === "online") {
        isOnline = false;
        reason = "db_online_but_stale_over_90s_like_dashboard";
    } else {
        isOnline = false;
        reason = "offline";
    }

    return {
        dbStatus,
        isOnline,
        connectivity: isOnline ? "online" : "offline",
        lastActivityAt: freshest ? new Date(freshest).toISOString() : null,
        lastActivityAgeSeconds:
            ageMs != null && ageMs >= 0 ? Math.round(ageMs / 1000) : null,
        lastActivityAgeMinutes:
            ageMs != null && ageMs >= 0 ? Math.round(ageMs / 60000) : null,
        connectivityNote: reason,
        matchesDashboardCardLogic:
            "Same 90s presence idea as device-card LED (WS data/status). dbStatus alone can be sticky/wrong.",
    };
}

module.exports = { ONLINE_STALE_MS, computeConnectivity };
