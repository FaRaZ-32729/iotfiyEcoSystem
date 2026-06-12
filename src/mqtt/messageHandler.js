const { getCurrentOrNextScheduleData } = require("../controllers/eventController");
const { activeOTASessions } = require("../controllers/otaController");
const Device = require("../models/deviceModel");
const { processMonitoringDeviceData } = require("../services/monitoringProcessor");
const { broadcastOTAProgress } = require("../services/otaProgressService");
const { reconcileMissedCommands } = require("../services/reconciliationService");
const { processSchedulingDeviceData } = require("../services/schedulingProcessor");
const { processTriggerDeviceData } = require("../services/triggerProcessor");

const setupMessageHandler = (client) => {
    if (!client) return;

    client.on("message", async (topic, message) => {
        try {
            const parts = topic.split("/");

            if (parts[3] === "status") {
                const payloadStr = message.toString().trim();
                const deviceId = parts[2];

                console.log(`📡 Status update from device ${deviceId}: ${payloadStr}`);

                // ==================== UPDATE DATABASE STATUS ====================
                const newStatus = payloadStr === "online" ? "online" : "offline";

                const updatedDevice = await Device.findOneAndUpdate(
                    { deviceId: deviceId },
                    {
                        status: newStatus,
                        lastSeen: new Date()
                    },
                    { new: true }
                );

                if (updatedDevice) {
                    console.log(`✅ Database updated → Device ${deviceId} is now ${newStatus.toUpperCase()}`);

                    if (global.io) {
                        global.io.emit("deviceStatusUpdate", {
                            deviceId: deviceId,
                            status: newStatus,
                            lastSeen: new Date(),
                            // deviceName: updatedDevice.deviceName || "Unknown"
                        });

                        console.log(`📤 Emitted to Frontend → deviceStatusUpdate for ${deviceId}`);
                    }

                    if (newStatus === "online") {
                        // Device online hai → Current/Next schedule bhejo
                        const scheduleData = await getCurrentOrNextScheduleData(deviceId);
                        if (global.io) {
                            global.io.emit(`device/${deviceId}/schedule`, scheduleData);
                            console.log(`📡 Sent current/next schedule for ONLINE device ${deviceId}`);
                        }
                    }
                    else {
                        // Device offline ho gaya → Last known schedule bhejo with offline flag
                        const lastScheduleData = await getCurrentOrNextScheduleData(deviceId);

                        const offlineScheduleData = {
                            ...lastScheduleData,
                            deviceStatus: "offline",
                            message: "Device is currently offline. Showing last known schedule."
                        };

                        if (global.io) {
                            global.io.emit(`device/${deviceId}/schedule`, offlineScheduleData);
                            console.log(`📡 Sent last known schedule for OFFLINE device ${deviceId}`);
                        }
                    }

                    // ==================== RECONCILIATION ONLY FOR SCHEDULING DEVICES ====================
                    // if (newStatus === "online" && updatedDevice.category === "scheduling") {
                    //     console.log(`🔄 Triggering reconciliation for Scheduling device: ${deviceId}`);
                    //     await reconcileMissedCommands(deviceId);
                    // }
                    // ==================== ONLY FOR SCHEDULING DEVICES ====================
                    if (updatedDevice.category === "scheduling") {

                        // Send Current/Next Schedule
                        const scheduleData = await getCurrentOrNextScheduleData(deviceId);

                        if (global.io) {
                            global.io.emit(`device/${deviceId}/schedule`, {
                                ...scheduleData,
                                deviceStatus: newStatus
                            });
                            console.log(`📡 Sent current/next schedule for Scheduling device ${deviceId} | Status: ${newStatus}`);
                        }

                        // Reconciliation only when device comes ONLINE
                        if (newStatus === "online") {
                            console.log(`🔄 Triggering reconciliation for Scheduling device: ${deviceId}`);
                            await reconcileMissedCommands(deviceId);
                        }
                    } else if (newStatus === "online") {
                        console.log(`⏭️ No reconciliation needed for ${updatedDevice.category} device`);
                    }

                } else {
                    console.warn(`⚠️ Device ${deviceId} not found in database for status update`);
                }

                return;
            }


            // ==================== OTA PROGRESS & COMPLETION ====================
            if (parts[3] === "ota") {
                try {
                    const payload = JSON.parse(message.toString());
                    const deviceId = parts[2];

                    console.log(`📡 OTA Message from ${deviceId}: ${payload.type || 'PROGRESS'} | ${payload.progress || ''}%`);

                    if (payload.type === "OTA_PROGRESS" && payload.sessionId) {
                        const progress = parseInt(payload.progress) || 0;
                        broadcastOTAProgress(payload.sessionId, deviceId, progress, "downloading");
                    }
                    else if (payload.type === "OTA_COMPLETED" && payload.sessionId) {
                        console.log(`🎉 OTA COMPLETED for device ${deviceId} | Session: ${payload.sessionId}`);

                        // ==================== UPDATE DEVICE FIRMWARE VERSION ====================
                        const updatedDevice = await Device.findOneAndUpdate(
                            { deviceId: deviceId },
                            {
                                version: payload.version || "unknown",
                                lastUpdateTime: new Date()
                            },
                            { new: true }
                        );

                        if (updatedDevice) {
                            console.log(`✅ Firmware Version Updated → Device ${deviceId} = ${payload.version || 'unknown'}`);
                        }

                        broadcastOTAProgress(payload.sessionId, deviceId, 100, "completed");

                        // Optional: Session cleanup
                        if (activeOTASessions.has(payload.sessionId)) {
                            activeOTASessions.delete(payload.sessionId);
                            console.log(`🗑️ OTA Session closed: ${payload.sessionId}`);
                        }
                    }
                } catch (parseErr) {
                    console.error("❌ OTA Message Parse Error:", parseErr);
                }
                return;
            }

            // ==================== REGULAR DATA MESSAGES ====================
            // Original code continues (only for /data topics)
            // const payload = JSON.parse(message.toString());
            // console.log(`\n📨 MQTT Message Received → Topic: ${topic}`);

            if (parts[1] === "devices" && parts[3] === "data") {
                const payload = JSON.parse(message.toString());
                const deviceId = parts[2];

                console.log(`\n📨 MQTT Message Received → Topic: ${topic}`);

                // Fetch device with full details
                const device = await Device.findOne({ deviceId });

                if (!device) {
                    console.warn(`⚠️ Device ${deviceId} not found in database`);
                    return;
                }

                // ==================== DETAILED DEVICE INFO ====================
                console.log(`✅ Device Found:`);
                console.log(`   • Device ID     : ${device.deviceId}`);
                console.log(`   • Device Name   : ${device.deviceName}`);
                console.log(`   • Device Type   : ${device.deviceType}`);
                console.log(`   • Category      : ${device.category}`);

                // ==================== ROUTE BY CATEGORY ====================
                switch (device.category) {
                    case "monitoring":
                        console.log(`🔄 Processing as MONITORING device...`);
                        await processMonitoringDeviceData(device, payload);
                        break;

                    case "scheduling":
                        console.log(`🔄 Processing as SCHEDULING device...`);
                        await processSchedulingDeviceData(device, payload);
                        break;

                    case "trigger":
                        console.log(`🔄 Processing as TRIGGER device...`);
                        await processTriggerDeviceData(device, payload);
                        break;

                    default:
                        console.warn(`⚠️ Unknown category "${device.category}" for device ${device.deviceId}`);
                }
            }

        } catch (error) {
            console.error("❌ MQTT Message Handler Error:", error);
        }
    });
};


module.exports = { setupMessageHandler };