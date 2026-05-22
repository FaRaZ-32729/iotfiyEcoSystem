const Device = require("../models/deviceModel");
const { processMonitoringDeviceData } = require("../services/monitoringProcessor");

// const setupMessageHandler = (client) => {
//     if (!client) return;

//     client.on("message", async (topic, message) => {
//         console.log(topic)
//         try {
//             const payload = JSON.parse(message.toString());
//             const parts = topic.split("/");

//             // Example topic: iotify/devices/ABC123/data
//             if (parts[1] === "devices" && parts[3] === "data") {
//                 const deviceId = parts[2];

//                 // Find device to know its category
//                 const device = await Device.findOne({ deviceId });

//                 if (!device) {
//                     console.warn(`Device ${deviceId} not found`);
//                     return;
//                 }

//                 // ==================== ROUTE BY CATEGORY ====================
//                 switch (device.category) {
//                     case "monitoring":
//                         await processMonitoringDeviceData(device, payload);
//                         break;

//                     // case "scheduling":
//                     //     await processSchedulingDeviceData(device, payload);
//                     //     break;

//                     // case "trigger":
//                     //     await processTriggerDeviceData(device, payload);
//                     //     break;

//                     default:
//                         console.warn(`Unknown category "${device.category}" for device ${deviceId}`);
//                 }
//             }

//             // Handle status messages if needed
//             if (parts[3] === "status") {
//                 console.log(`📡 Status update from device ${parts[2]}:`, payload);
//             }

//         } catch (error) {
//             console.error("MQTT Message Handler Error:", error);
//         }
//     });
// };


const setupMessageHandler = (client) => {
    if (!client) return;

    client.on("message", async (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            const parts = topic.split("/");

            console.log(`\n📨 MQTT Message Received → Topic: ${topic}`);

            if (parts[1] === "devices" && parts[3] === "data") {
                const deviceId = parts[2];

                // Fetch device with full details
                const device = await Device.findOne({ deviceId })
                    .select("deviceId deviceName deviceType category");

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
                        // await processSchedulingDeviceData(device, payload);
                        break;

                    case "trigger":
                        console.log(`🔄 Processing as TRIGGER device...`);
                        // await processTriggerDeviceData(device, payload);
                        break;

                    default:
                        console.warn(`⚠️ Unknown category "${device.category}" for device ${device.deviceId}`);
                }
            }

            // Handle status messages
            if (parts[3] === "status") {
                console.log(`📡 Status update from device ${parts[2]}:`, payload);
            }

        } catch (error) {
            console.error("❌ MQTT Message Handler Error:", error);
        }
    });
};


module.exports = { setupMessageHandler };