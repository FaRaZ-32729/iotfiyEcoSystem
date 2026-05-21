// const mqtt = require("mqtt");

// const client = mqtt.connect("mqtt://localhost:1883");

// module.exports = client;


// // const client = mqtt.connect("mqtt://testmqtt.iotfiysolutions.com", {
// //     port: 1883,
// //     username: "mqttuser",
// //     password: "Growmore12345@"
// // });



// src/config/mqttClient.js
const mqtt = require("mqtt");
const Device = require("../models/deviceModel");
const { processDeviceData } = require("../services/deviceDataProcessor");

let client;

const connectMQTT = () => {
    const options = {
        host: process.env.MQTT_HOST || "localhost",
        port: process.env.MQTT_PORT || 1883,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASS,
        clientId: `iotify_server_${Math.random().toString(16).slice(2)}`,
        reconnectPeriod: 5000,
    };

    client = mqtt.connect(`mqtt://${options.host}:${options.port}`, options);

    client.on("connect", () => {
        console.log("✅ Connected to MQTT Broker");

        // Subscribe to all device data
        client.subscribe("iotify/devices/+/data", (err) => {
            if (!err) console.log("Subscribed to device data topics");
        });

        client.subscribe("iotify/devices/+/status", (err) => {
            if (!err) console.log("Subscribed to device status topics");
        });
    });

    client.on("message", async (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            const topicParts = topic.split("/");

            if (topicParts[2] === "data") {
                const deviceId = topicParts[3];
                await processDeviceData(deviceId, payload);
            }

        } catch (error) {
            console.error("MQTT Message Processing Error:", error);
        }
    });

    client.on("error", (err) => {
        console.error("MQTT Error:", err.message);
    });

    return client;
};

// Publish command to device
const publishCommand = (deviceId, command) => {
    const topic = `iotify/commands/${deviceId}/control`;
    client.publish(topic, JSON.stringify(command), { qos: 1, retain: false });
};

module.exports = { connectMQTT, publishCommand };