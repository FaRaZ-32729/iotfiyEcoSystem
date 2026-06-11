// src/services/otaProgressService.js

let activeOTASessions; // Will be set from controller

const setActiveSessions = (sessionsMap) => {
    activeOTASessions = sessionsMap;
};

const broadcastOTAProgress = (sessionId, deviceId, progress, status = "downloading") => {
    if (!global.io) {
        console.warn("⚠️ Socket.io not available");
        return;
    }

    const progressData = {
        sessionId,
        deviceId,
        progress: Number(progress),
        status: status,
        timestamp: new Date().toISOString()
    };

    global.io.emit(`ota-progress/${sessionId}`, progressData);
    global.io.emit("ota-progress", progressData);

    console.log(`📡 OTA Progress → ${deviceId} | ${progress}% | ${status}`);
};

module.exports = { 
    broadcastOTAProgress,
    setActiveSessions 
};