// src/mqtt/index.js
const { connectMQTT } = require("./mqttClient");
const { setupMessageHandler } = require("./messageHandler");

const initializeMQTT = () => {
    const client = connectMQTT();
    setupMessageHandler(client);
    console.log("MQTT System Initialized");
};

module.exports = { initializeMQTT };