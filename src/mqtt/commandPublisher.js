// src/mqtt/commandPublisher.js
const { getClient } = require("./mqttClient");

const publishCommand = (deviceId, command) => {
    const client = getClient();
    if (!client) {
        console.error("MQTT Client not connected");
        return false;
    }

    const topic = `iotify/commands/${deviceId}/control`;
    
    client.publish(topic, JSON.stringify(command), { qos: 1, retain: false }, (err) => {
        if (err) {
            console.error(`Failed to publish command to ${deviceId}:`, err);
        } else {
            console.log(`Command sent to device ${deviceId}`);
        }
    });

    return true;
};

module.exports = { publishCommand };