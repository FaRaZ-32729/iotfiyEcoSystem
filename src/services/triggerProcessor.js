// // src/services/processors/triggerProcessor.js
// const checkConditions = require("./conditionChecker");
// const scheduleQueue = require("../queues/scheduleQueue");
// const { publishCommand } = require("../mqtt/commandPublisher");
// const sensorModel = require("../models/sensorModel");

// const processTriggerDeviceData = async (device, payload) => {
//     console.log(`\n🚨 Processing TRIGGER Data for Device: ${device.deviceName} (${device.deviceId})`);

//     console.log("data i received form esp", payload)


//     const updatedFields = [];

//     if (payload.state !== undefined) {
//         const newState = String(payload.state).toUpperCase().trim();
//         if (["ON", "OFF"].includes(newState)) {
//             device.state = newState;
//             updatedFields.push(`state: ${newState}`);
//             console.log(`🔄 Device state updated to ${newState}`);
//         }
//     }

//     // Update common sensor values
//     if (payload.temperature !== undefined) {
//         device.espTemperature = payload.temperature;
//         updatedFields.push(`temperature: ${payload.temperature}`);
//     }
//     if (payload.humidity !== undefined) {
//         device.espHumidity = payload.humidity;
//         updatedFields.push(`humidity: ${payload.humidity}`);
//     }
//     if (payload.odour !== undefined) {
//         device.espOdour = payload.odour;
//         updatedFields.push(`odour: ${payload.odour}`);
//     }
//     if (payload.AQI !== undefined) {
//         device.espAQI = payload.AQI;
//         updatedFields.push(`AQI: ${payload.AQI}`);
//     }
//     if (payload.gass !== undefined) {
//         device.espGL = payload.gass;
//         updatedFields.push(`gass: ${payload.gass}`);
//     }
//     if (payload.voltage !== undefined) {
//         device.espVoltage = payload.voltage;
//         updatedFields.push(`voltage: ${payload.voltage}`);
//     }
//     if (payload.current !== undefined) {
//         device.espCurrent = payload.current;
//         updatedFields.push(`current: ${payload.current}`);
//     }

//     device.lastUpdateTime = new Date();

//     // Check conditions and get alerts
//     const alerts = checkConditions(device, payload);

//     let shouldTrigger = false;

//     // Trigger only if there is any alert EXCEPT temperature and humidity
//     if (alerts.length > 0) {
//         const criticalAlerts = alerts.filter(alert =>
//             !["temperature", "humidity"].includes(alert.type)
//         );

//         if (criticalAlerts.length > 0) {
//             shouldTrigger = true;
//             console.log(`🚨 Critical Alert(s) Detected: ${criticalAlerts.length}`);
//             criticalAlerts.forEach(a => console.log(`   → ${a.message}`));
//         }
//     }

//     if (device.manualButton === true) {
//         console.log(`🔧 Manual Button is ENABLED → Skipping auto trigger`);
//     }
//     else if (shouldTrigger) {
//         const intervalSeconds = device.interval || 5;

//         const endTime = new Date(Date.now() + intervalSeconds * 1000);
//         const endTimeISO = endTime.toISOString();

//         // console.log(`⚡ Trigger Activated! Sending ON for ${intervalSeconds} seconds`);

//         // Send ON command with duration
//         const success = publishCommand(device.deviceId, {
//             type: "COMMAND",
//             command: "ON",
//             durationSeconds: intervalSeconds,
//             endTime: endTimeISO
//         });

//         if (success) {
//             console.log(`✅ ON Command sent to ${device.deviceId} | Duration: ${intervalSeconds}s`);

//             // Schedule OFF command after interval
//             const offJobId = `trigger-off-${device.deviceId}-${Date.now()}`;

//             await scheduleQueue.add("trigger-off", {
//                 deviceId: device.deviceId,
//                 command: "OFF",
//                 reason: "auto_interval"
//             }, {
//                 delay: intervalSeconds * 1000,
//                 jobId: offJobId,
//                 attempts: 2,
//                 removeOnComplete: true,
//                 removeOnFail: true,
//                 backoff: { type: 'exponential', delay: 1000 }
//             });

//             console.log(`📅 Auto OFF scheduled after ${intervalSeconds} seconds`);
//         }
//     } else {
//         console.log(`✅ No critical alerts for trigger device`);
//     }

//     await device.save();

//     // ==================== SAVE SENSOR DATA ====================
//     try {
//         const SensorModel = sensorModel(device.deviceType);

//         if (SensorModel) {
//             const sensorData = {
//                 deviceId: device.deviceId,
//                 deviceType: device.deviceType,
//                 timestamp: new Date(),
//             };

//             // save fields a/c deviceType
//             if (device.deviceType === "OD") {
//                 sensorData.temperature = payload.temperature;
//                 sensorData.humidity = payload.humidity;
//                 sensorData.odour = payload.odour;
//             }
//             else if (device.deviceType === "THD") {
//                 sensorData.temperature = payload.temperature;
//                 sensorData.humidity = payload.humidity;
//             }
//             else if (device.deviceType === "AQID") {
//                 sensorData.temperature = payload.temperature;
//                 sensorData.humidity = payload.humidity;
//                 sensorData.AQI = payload.AQI;
//             }
//             else if (device.deviceType === "ED") {
//                 sensorData.temperature = payload.temperature;
//                 sensorData.humidity = payload.humidity;
//                 sensorData.voltage = payload.voltage;
//                 sensorData.current = payload.current;
//             }

//             await SensorModel.create(sensorData);
//             console.log(`💾 Sensor data saved in ${device.deviceType} Cluster`);
//         }
//     } catch (err) {
//         console.error(`❌ Failed to save sensor data for ${device.deviceType}:`, err.message);
//     }

//     // Send live data to frontend
//     const liveData = {
//         deviceId: device.deviceId,
//         deviceName: device.deviceName,
//         deviceType: device.deviceType,
//         category: "trigger",
//         state: device.state,
//         data: payload,
//         alerts: alerts,
//         interval: device.interval,
//         timestamp: new Date()
//     };

//     if (global.io) {
//         global.io.emit(`device/${device.deviceId}`, liveData);
//         console.log(`📤 Live data sent to frontend for trigger device: ${device.deviceId}`);
//     }

//     console.log(`✅ Trigger processing completed for ${device.deviceId}\n`);
// };

// module.exports = { processTriggerDeviceData };


// src/services/processors/triggerProcessor.js
const checkConditions = require("./conditionChecker");
const scheduleQueue = require("../queues/scheduleQueue");
const { publishCommand } = require("../mqtt/commandPublisher");
const sensorModel = require("../models/sensorModel");

const processTriggerDeviceData = async (device, payload) => {
    console.log(`\n🚨 Processing TRIGGER Data for Device: ${device.deviceName} (${device.deviceId})`);

    console.log("data i received form esp", payload);

    const updatedFields = [];

    if (payload.state !== undefined) {
        const newState = String(payload.state).toUpperCase().trim();
        if (["ON", "OFF"].includes(newState)) {
            device.state = newState;
            updatedFields.push(`state: ${newState}`);
            console.log(`🔄 Device state updated to ${newState}`);
        }
    }

    // Update common sensor values (untouched)
    if (payload.temperature !== undefined) {
        device.espTemperature = payload.temperature;
        updatedFields.push(`temperature: ${payload.temperature}`);
    }
    if (payload.humidity !== undefined) {
        device.espHumidity = payload.humidity;
        updatedFields.push(`humidity: ${payload.humidity}`);
    }
    if (payload.odour !== undefined) {
        device.espOdour = payload.odour;
        updatedFields.push(`odour: ${payload.odour}`);
    }
    if (payload.AQI !== undefined) {
        device.espAQI = payload.AQI;
        updatedFields.push(`AQI: ${payload.AQI}`);
    }
    if (payload.gass !== undefined) {
        device.espGL = payload.gass;
        updatedFields.push(`gass: ${payload.gass}`);
    }
    if (payload.voltage !== undefined) {
        device.espVoltage = payload.voltage;
        updatedFields.push(`voltage: ${payload.voltage}`);
    }
    if (payload.current !== undefined) {
        device.espCurrent = payload.current;
        updatedFields.push(`current: ${payload.current}`);
    }

    device.lastUpdateTime = new Date();

    // Check conditions and get alerts
    const alerts = checkConditions(device, payload);

    // ==================== NEW ACCESS BASED TRIGGER LOGIC ====================
    let shouldTrigger = false;
    const triggeredAlerts = [];   // e.g. ["tempAlert", "odourAlert"]

    if (alerts.length > 0) {
        alerts.forEach(alert => {
            let hasAccess = false;

            switch (alert.type) {
                case "temperature":
                    hasAccess = device.tempAlertAccess === true;
                    break;
                case "humidity":
                    hasAccess = device.humiAlertAccess === true;
                    break;
                case "odour":
                    hasAccess = device.odourAlertAccess === true;
                    break;
                case "AQI":
                case "aqi":
                    hasAccess = device.aqiAlertAccess === true;
                    break;
                case "gass":
                case "gl":
                    hasAccess = device.glAlertAccess === true;
                    break;
                case "voltage":
                    hasAccess = device.voltageAlertAccess === true;
                    break;
                case "current":
                    hasAccess = device.currentAlertAccess === true;
                    break;
            }

            if (hasAccess) {
                shouldTrigger = true;
                triggeredAlerts.push(`${alert.type}Alert`);
                console.log(`✅ Access Granted & Alert Triggered: ${alert.type}`);
            } else {
                console.log(`⛔ Access Denied for ${alert.type} alert`);
            }
        });
    }

    if (device.manualButton === true) {
        console.log(`🔧 Manual Button is ENABLED → Skipping auto trigger`);
        shouldTrigger = false;
    }

    // ==================== TRIGGER COMMAND ====================
    if (shouldTrigger && triggeredAlerts.length > 0) {
        const intervalSeconds = device.interval || 5;
        const endTime = new Date(Date.now() + intervalSeconds * 1000);
        const endTimeISO = endTime.toISOString();

        console.log(`🚨 Trigger Activated! Alerts: [${triggeredAlerts.join(", ")}]`);

        const success = publishCommand(device.deviceId, {
            type: "COMMAND",
            command: "ON",
            durationSeconds: intervalSeconds,
            triggeredAlerts: triggeredAlerts,
            endTime: endTimeISO
        });

        if (success) {
            console.log(`✅ ON Command sent to ${device.deviceId} | Duration: ${intervalSeconds}s | Alerts: [${triggeredAlerts.join(", ")}]`);

            // Schedule OFF command
            const offJobId = `trigger-off-${device.deviceId}-${Date.now()}`;

            await scheduleQueue.add("trigger-off", {
                deviceId: device.deviceId,
                command: "OFF",
                reason: "auto_interval"
            }, {
                delay: intervalSeconds * 1000,
                jobId: offJobId,
                attempts: 2,
                removeOnComplete: true,
                removeOnFail: true,
                backoff: { type: 'exponential', delay: 1000 }
            });

            console.log(`📅 Auto OFF scheduled after ${intervalSeconds} seconds`);
        }
    } else {
        console.log(`✅ No alerts with access permission - No trigger`);
    }

    await device.save();

    // ==================== SAVE SENSOR DATA (Untouched) ====================
    try {
        const SensorModel = sensorModel(device.deviceType);
        if (SensorModel) {
            const sensorData = {
                deviceId: device.deviceId,
                deviceType: device.deviceType,
                timestamp: new Date(),
            };

            if (device.deviceType === "OD") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.odour = payload.odour;
            } else if (device.deviceType === "THD") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
            } else if (device.deviceType === "AQID") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.AQI = payload.AQI;
            } else if (device.deviceType === "ED") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.voltage = payload.voltage;
                sensorData.current = payload.current;
            }

            await SensorModel.create(sensorData);
            console.log(`💾 Sensor data saved in ${device.deviceType} Cluster`);
        }
    } catch (err) {
        console.error(`❌ Failed to save sensor data for ${device.deviceType}:`, err.message);
    }

    // ==================== LIVE DATA TO FRONTEND ====================
    const liveData = {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: "trigger",
        state: device.state,
        data: payload,
        alerts: alerts,
        triggeredAlerts: triggeredAlerts,  
        interval: device.interval,
        timestamp: new Date()
    };

    if (global.io) {
        global.io.emit(`device/${device.deviceId}`, liveData);
        console.log(`📤 Live data sent to frontend | Triggered Alerts: [${triggeredAlerts.join(", ")}]`);
    }

    console.log(`✅ Trigger processing completed for ${device.deviceId}\n`);
};

module.exports = { processTriggerDeviceData };