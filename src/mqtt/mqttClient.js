// // src/mqtt/mqttClient.js
// const mqtt = require("mqtt");

// let client = null;

// const connectMQTT = () => {
//     if (client) return client;

//     const options = {
//         host: process.env.MQTT_HOST || "localhost",
//         port: parseInt(process.env.MQTT_PORT) || 1883,
//         username: process.env.MQTT_USER,
//         password: process.env.MQTT_PASS,

//         // Best clientId
//         clientId: `iotify-server-${process.env.NODE_ENV || 'development'}-${process.pid}`,

//         reconnectPeriod: 5000,
//         keepalive: 60,
//         clean: true,
//         connectTimeout: 30000,
//     };

//     client = mqtt.connect(`mqtt://${options.host}:${options.port}`, options);

//     client.on("connect", () => {
//         console.log(`✅ MQTT Broker Connected | ClientID: ${options.clientId}`);

//         // ==================== SUBSCRIBE HERE ====================
//         client.subscribe("iotify/devices/+/data", { qos: 1 }, (err) => {
//             if (!err) {
//                 console.log("✅ Subscribed to: iotify/devices/+/data");
//             } else {
//                 console.error("❌ Subscription failed:", err);
//             }
//         });

//         client.subscribe("iotify/devices/+/status", { qos: 1 });
//     });

//     client.on("error", (err) => {
//         console.error("MQTT Error:", err.message);
//     });

//     client.on("reconnect", () => {
//         console.log("MQTT Reconnecting...");
//     });

//     return client;
// };

// const getClient = () => client;

// module.exports = { connectMQTT, getClient };



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

        // ==================== LAST WILL & TESTAMENT (LWT) ====================
        will: {
            topic: "iotify/devices/+/status",           // Will publish to all devices
            payload: JSON.stringify({ status: "offline", timestamp: new Date() }),
            qos: 1,
            retain: true                                // Important: retain last status
        }
    };

    client = mqtt.connect(`mqtt://${options.host}:${options.port}`, options);

    client.on("connect", () => {
        console.log(`✅ MQTT Broker Connected | ClientID: ${options.clientId}`);

        // Subscribe to data and status
        client.subscribe("iotify/devices/+/data", { qos: 1 });
        client.subscribe("iotify/devices/+/status", { qos: 1 });

        console.log("✅ Subscribed to device data & status topics");
    });

    client.on("error", (err) => {
        console.error("❌ MQTT Error:", err.message);
    });

    client.on("reconnect", () => {
        console.log("🔄 MQTT Reconnecting...");
    });

    return client;
};

const getClient = () => client;

module.exports = { connectMQTT, getClient };