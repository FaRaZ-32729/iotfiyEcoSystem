// src/mqtt/messageHandler.js
const { processDeviceData } = require("../services/deviceDataProcessor");

const setupMessageHandler = (client) => {
    if (!client) return;

    client.on("message", async (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            const parts = topic.split("/");

            // Example: iotify/devices/ABC123/data
            if (parts[1] === "devices" && parts[3] === "data") {
                const deviceId = parts[2];
                await processDeviceData(deviceId, payload);
            }

            // Future: Handle status, alerts, etc.
            if (parts[3] === "status") {
                console.log(`📡 Device ${parts[2]} status:`, payload);
            }

        } catch (error) {
            console.error("MQTT Message Handler Error:", error);
        }
    });
};

module.exports = { setupMessageHandler };