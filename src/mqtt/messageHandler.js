const Device = require("../models/deviceModel");
const { processMonitoringDeviceData } = require("../services/monitoringProcessor");
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
                            deviceName: updatedDevice.deviceName || "Unknown"
                        });

                        console.log(`📤 Emitted to Frontend → deviceStatusUpdate for ${deviceId}`);
                    }

                    // ==================== RECONCILIATION LOGIC ====================
                    if (newStatus === "online") {
                        await reconcileMissedCommands(deviceId);
                    }

                } else {
                    console.warn(`⚠️ Device ${deviceId} not found in database for status update`);
                }

                return;
            }

            // Original code continues (only for /data topics)
            const payload = JSON.parse(message.toString());
            console.log(`\n📨 MQTT Message Received → Topic: ${topic}`);

            if (parts[1] === "devices" && parts[3] === "data") {
                const deviceId = parts[2];

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