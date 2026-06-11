// src/mqtt/commandPublisher.js
const { getClient } = require("./mqttClient");

const publishCommand = (deviceId, commandPayload) => {
    const client = getClient();

    if (!client || !client.connected) {
        console.error(`❌ MQTT Client not connected in worker for device ${deviceId}`);
        return false;
    }

    const topic = `iotify/commands/${deviceId}/control`;

    const commandName = commandPayload.command || commandPayload.type || "UNKNOWN";
    
    client.publish(topic, JSON.stringify(commandPayload), { qos: 1, retain: false }, (err) => {
        if (err) {
            console.error(`Failed to publish command to ${deviceId}:`, err);
            return false;
        } else {
            console.log(`✅ Command sent to device ${deviceId} → ${commandName}`);
        }
    });

    return true;
};

module.exports = { publishCommand };