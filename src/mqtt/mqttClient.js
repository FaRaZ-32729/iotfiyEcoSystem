// src/mqtt/mqttClient.js
const mqtt = require("mqtt");

let client = null;

const connectMQTT = () => {
    if (client) return client;

    const options = {
        host: process.env.MQTT_HOST || "localhost",
        port: parseInt(process.env.MQTT_PORT) || 1883,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASS,
        clientId: `iotify-server-${process.pid}-${Date.now()}`,
        reconnectPeriod: 5000,
        keepalive: 60,
        clean: true,
        connectTimeout: 30000,
    };

    client = mqtt.connect(`mqtt://${options.host}:${options.port}`, options);

    client.on("connect", () => {
        console.log(`MQTT Broker Connected | ClientID: ${options.clientId}`);
    });

    client.on("error", (err) => {
        console.error("MQTT Error:", err.message);
    });

    client.on("reconnect", () => {
        console.log("MQTT Reconnecting...");
    });

    return client;
};

const getClient = () => client;

module.exports = { connectMQTT, getClient };