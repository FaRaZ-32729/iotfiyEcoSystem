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

        clientId: `iotify-server-${process.env.NODE_ENV || 'development'}-${process.pid}`,

        reconnectPeriod: 5000,
        keepalive: 60,
        clean: true,
        connectTimeout: 30000,

        will: {
            topic: "iotify/server/status",
            payload: Buffer.from("offline"),
            qos: 1,
            retain: true
        }
    };

    console.log(`🔌 Connecting to MQTT Broker at ${options.host}:${options.port}`);

    client = mqtt.connect(`mqtt://${options.host}:${options.port}`, options);

    client.on("connect", () => {
        console.log(`✅ MQTT Connected Successfully!`);
        console.log(`   Client ID: ${options.clientId}`);

        // Announce server online
        client.publish("iotify/server/status", "online", { qos: 1, retain: true });

        // Subscribe to device topics
        client.subscribe("iotify/devices/+/data", { qos: 1 });
        client.subscribe("iotify/devices/+/status", { qos: 1 });
        client.subscribe("iotify/devices/+/ota", { qos: 1 });

        console.log("✅ Subscribed to all device topics");
    });

    // ==================== MESSAGE HANDLER ====================
    client.on("message", (topic, message) => {
        const payload = message.toString();

        // console.log(`📥 Received on ${topic}: ${payload}`);

        // Handle Device Status (Online / Offline)
        if (topic.endsWith("/status")) {
            const deviceId = topic.split("/")[2];   // Extract deviceId from iotify/devices/{deviceId}/status

            if (payload === "online") {
                console.log(`🟢 Device ${deviceId} is ONLINE`);
                // You can trigger DB update here later
            }
            else if (payload === "offline") {
                console.log(`🔴 Device ${deviceId} is OFFLINE`);
                // You can trigger DB update here later
            }
            else {
                console.log(`⚠️ Device ${deviceId} status: ${payload}`);
            }
        }

        // Handle Device Data
        if (topic.endsWith("/data")) {
            const deviceId = topic.split("/")[2];
            // console.log(`📊 Data from Device ${deviceId}: ${payload}`);
            // Parse JSON if your devices send JSON
        }
    });

    client.on("error", (err) => {
        console.error("❌ MQTT Error:", err.message);
    });

    client.on("reconnect", () => {
        console.log("🔄 MQTT Reconnecting...");
    });

    client.on("offline", () => {
        console.warn("⚠️ MQTT Client is offline");
    });

    return client;
};

const getClient = () => client;


module.exports = {
    connectMQTT,
    getClient,
};