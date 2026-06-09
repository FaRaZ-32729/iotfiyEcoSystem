// // src/services/otaProgressService.js

// const activeOTASessions = require("../controllers/otaController").activeOTASessions || new Map();

// // Broadcast OTA Progress to Frontend
// const broadcastOTAProgress = (sessionId, deviceId, percentage) => {
//     if (!global.io) {
//         console.warn("⚠️ Socket.io not initialized");
//         return;
//     }

//     const progressData = {
//         sessionId,
//         deviceId,
//         progress: percentage,
//         timestamp: new Date().toISOString()
//     };

//     // Broadcast to all clients listening to this session
//     global.io.emit(`ota-progress/${sessionId}`, progressData);

//     // Also broadcast to general OTA room
//     global.io.emit("ota-progress", progressData);

//     console.log(`📡 Broadcast OTA Progress → Session: ${sessionId} | Device: ${deviceId} | ${percentage}%`);
// };

// // Update progress in session (optional helper)
// const updateOTAProgress = (sessionId, deviceId, percentage) => {
//     const session = activeOTASessions.get(sessionId);
//     if (session) {
//         session.progressMap.set(deviceId, percentage);
//         broadcastOTAProgress(sessionId, deviceId, percentage);
//     }
// };

// module.exports = {
//     broadcastOTAProgress,
//     updateOTAProgress
// };


// src/services/otaProgressService.js

const broadcastOTAProgress = (sessionId, deviceId, percentage) => {
    if (!global.io) {
        console.warn("⚠️ Socket.io not initialized for OTA progress");
        return;
    }

    const progressData = {
        sessionId,
        deviceId,
        progress: percentage,
        timestamp: new Date().toISOString()
    };

    // Broadcast to specific session listeners
    global.io.emit(`ota-progress/${sessionId}`, progressData);

    // Broadcast to general OTA room
    global.io.emit("ota-progress", progressData);

    console.log(`📡 OTA Progress Broadcast → ${deviceId} | ${percentage}%`);
};

module.exports = {
    broadcastOTAProgress
};