const { getCurrentOrNextScheduleData } = require("../controllers/eventController");
const { activeOTASessions } = require("../controllers/otaController");
const { getCurrentOrNextTriggerEventData } = require("../controllers/triggerEventController");
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

            // if (parts[3] === "status") {
            //     const payloadStr = message.toString().trim();
            //     const deviceId = parts[2];

            //     console.log(`📡 Status update from device ${deviceId}: ${payloadStr}`);

            //     // ==================== UPDATE DATABASE STATUS ====================
            //     const newStatus = payloadStr === "online" ? "online" : "offline";

            //     const updatedDevice = await Device.findOneAndUpdate(
            //         { deviceId: deviceId },
            //         {
            //             status: newStatus,
            //             lastSeen: new Date()
            //         },
            //         { new: true }
            //     );

            //     if (updatedDevice) {
            //         console.log(`✅ Database updated → Device ${deviceId} is now ${newStatus.toUpperCase()}`);

            //         if (global.io) {
            //             global.io.emit("deviceStatusUpdate", {
            //                 deviceId: deviceId,
            //                 status: newStatus,
            //                 lastSeen: new Date(),
            //                 // deviceName: updatedDevice.deviceName || "Unknown"
            //             });

            //             console.log(`📤 Emitted to Frontend → deviceStatusUpdate for ${deviceId}`);
            //         }

            //         if (newStatus === "online") {
            //             // Device online hai → Current/Next schedule bhejo
            //             const scheduleData = await getCurrentOrNextScheduleData(deviceId);
            //             if (global.io) {
            //                 global.io.emit(`device/${deviceId}/schedule`, scheduleData);
            //                 console.log(`📡 Sent current/next schedule for ONLINE device ${deviceId}`);
            //             }
            //         }
            //         else {
            //             // Device offline ho gaya → Last known schedule bhejo with offline flag
            //             const lastScheduleData = await getCurrentOrNextScheduleData(deviceId);

            //             const offlineScheduleData = {
            //                 ...lastScheduleData,
            //                 deviceStatus: "offline",
            //                 message: "Device is currently offline. Showing last known schedule."
            //             };

            //             if (global.io) {
            //                 global.io.emit(`device/${deviceId}/schedule`, offlineScheduleData);
            //                 console.log(`📡 Sent last known schedule for OFFLINE device ${deviceId}`);
            //             }
            //         }

            //         // ==================== RECONCILIATION ONLY FOR SCHEDULING DEVICES ====================
            //         // if (newStatus === "online" && updatedDevice.category === "scheduling") {
            //         //     console.log(`🔄 Triggering reconciliation for Scheduling device: ${deviceId}`);
            //         //     await reconcileMissedCommands(deviceId);
            //         // }
            //         // ==================== ONLY FOR SCHEDULING DEVICES ====================
            //         if (updatedDevice.category === "scheduling") {

            //             // Send Current/Next Schedule
            //             const scheduleData = await getCurrentOrNextScheduleData(deviceId);

            //             if (global.io) {
            //                 global.io.emit(`device/${deviceId}/schedule`, {
            //                     ...scheduleData,
            //                     deviceStatus: newStatus
            //                 });
            //                 console.log(`📡 Sent current/next schedule for Scheduling device ${deviceId} | Status: ${newStatus}`);
            //             }

            //             // Reconciliation only when device comes ONLINE
            //             if (newStatus === "online") {
            //                 console.log(`🔄 Triggering reconciliation for Scheduling device: ${deviceId}`);
            //                 await reconcileMissedCommands(deviceId);
            //             }
            //         } else if (newStatus === "online") {
            //             console.log(`⏭️ No reconciliation needed for ${updatedDevice.category} device`);
            //         }

            //     } else {
            //         console.warn(`⚠️ Device ${deviceId} not found in database for status update`);
            //     }

            //     return;
            // }

            if (parts[3] === "status") {
                const payloadStr = message.toString().trim();
                const deviceId = parts[2];

                console.log(`📡 Status update from device ${deviceId}: ${payloadStr}`);

                let newStatus = null;
                if (payloadStr === "online" || payloadStr === "offline") {
                    newStatus = payloadStr;
                } else {
                    try {
                        const parsed = JSON.parse(payloadStr);
                        const s = String(parsed?.status || parsed?.state || "")
                            .toLowerCase()
                            .trim();
                        if (s === "online" || s === "connected") newStatus = "online";
                        else if (s === "offline" || s === "disconnected") newStatus = "offline";
                    } catch {
                        // ignore non-JSON
                    }
                }

                if (!newStatus) {
                    console.warn(`⚠️ Unrecognized status payload from ${deviceId}: ${payloadStr}`);
                    return;
                }

                // Capture previous status BEFORE update — needed to know if this is a
                // real offline→online transition vs ESP re-publishing "online".
                const previousDevice = await Device.findOne({ deviceId }).select(
                    "status category"
                );
                const previousStatus = previousDevice?.status || null;

                const updatedDevice = await Device.findOneAndUpdate(
                    { deviceId: deviceId },
                    { status: newStatus, lastSeen: new Date() },
                    { new: true }
                );

                if (updatedDevice) {
                    console.log(`✅ Database updated → Device ${deviceId} is now ${newStatus.toUpperCase()}`);
                    console.log(
                        `[AC-IR-DEBUG] status msg device=${deviceId} ` +
                            `prev=${previousStatus || "null"} → next=${newStatus} ` +
                            `category=${updatedDevice.category}`
                    );

                    // Emit device status to frontend
                    if (global.io) {
                        global.io.emit("deviceStatusUpdate", {
                            deviceId,
                            status: newStatus,
                            lastSeen: new Date()
                        });
                    }

                    // ==================== EVENT HANDLING FOR SCHEDULING & TRIGGER ====================
                    let eventData = null;

                    if (updatedDevice.category === "scheduling") {
                        const { emitDeviceSchedule } = require("../services/emitDeviceSchedule");
                        eventData = await emitDeviceSchedule(deviceId, {
                            deviceStatus: newStatus,
                            message: newStatus === "offline"
                                ? "Device is currently offline. Showing last known event."
                                : undefined,
                        });
                    }
                    else if (updatedDevice.category === "trigger") {
                        eventData = await getCurrentOrNextTriggerEventData(deviceId);
                        if (eventData && global.io) {
                            global.io.emit(`device/${deviceId}/schedule`, {
                                ...eventData,
                                deviceStatus: newStatus,
                                message: newStatus === "offline"
                                    ? "Device is currently offline. Showing last known event."
                                    : undefined
                            });
                        }
                    }

                    if (eventData) {
                        console.log(`📡 Sent ${updatedDevice.category} event for device ${deviceId} | Status: ${newStatus}`);
                    }

                    // ==================== RECONCILIATION (Only Scheduling) ====================
                    // Only on real offline→online. Re-publishing "online" while already
                    // online was re-firing power.on+temp during active events (AC beep loop).
                    if (newStatus === "online" && updatedDevice.category === "scheduling") {
                        const wasAlreadyOnline = previousStatus === "online";
                        if (wasAlreadyOnline) {
                            console.log(
                                `[AC-IR-DEBUG] skip reconcile device=${deviceId} ` +
                                    `reason=already_online (no IR)`
                            );
                        } else {
                            console.log(
                                `[AC-IR-DEBUG] reconcile device=${deviceId} ` +
                                    `reason=status_offline_to_online`
                            );
                            console.log(
                                `🔄 Triggering reconciliation for Scheduling device: ${deviceId}`
                            );
                            await reconcileMissedCommands(deviceId, {
                                reason: "status_offline_to_online",
                            });
                        }
                    }

                } else {
                    console.warn(`⚠️ Device ${deviceId} not found`);
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