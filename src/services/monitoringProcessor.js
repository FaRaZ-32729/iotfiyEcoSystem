// src/services/monitoringProcessor.js
const sensorModel = require("../models/sensorModel");
const checkConditions = require("./conditionChecker");
const {
    applySmdSmokeFromPayload,
    syncSmdSmokeDetectedFromAlert,
} = require("./smdSmokeHelper");
const {
    applyWldWaterLeakFromPayload,
    syncWldWaterLeakFromAlert,
} = require("./wldWaterLeakHelper");

const processMonitoringDeviceData = async (device, payload) => {
    console.log(`\n📡 Processing Monitoring Data for Device: ${device.deviceName} (${device.deviceId})`);

    // Update sensor values
    const updatedFields = [];
    const isSmd = device.deviceType === "SMD";
    const isWld = device.deviceType === "WLD";
    const smdSmokeApplied = applySmdSmokeFromPayload(device, payload, updatedFields);
    const wldApplied = applyWldWaterLeakFromPayload(device, payload, updatedFields);

    if (payload.temperature !== undefined && !isSmd && !isWld) {
        device.espTemperature = payload.temperature;
        updatedFields.push(`temperature: ${payload.temperature}`);
    }
    if (payload.humidity !== undefined && !isSmd && !isWld) {
        device.espHumidity = payload.humidity;
        updatedFields.push(`humidity: ${payload.humidity}`);
    }
    if (payload.odour !== undefined) {
        device.espOdour = payload.odour;
        updatedFields.push(`odour: ${payload.odour}`);
    }
    if (payload.AQI !== undefined && !isSmd && !smdSmokeApplied) {
        device.espAQI = payload.AQI;
        updatedFields.push(`AQI: ${payload.AQI}`);
    }
    if (payload.smoke !== undefined && !smdSmokeApplied) {
        const smokeDetected =
            payload.smoke === true ||
            String(payload.smoke).toLowerCase() === "detected" ||
            String(payload.smoke).toLowerCase() === "true" ||
            Number(payload.smoke) >= 1;
        device.espSmoke = smokeDetected;
        payload.smoke = smokeDetected;
        updatedFields.push(`smoke: ${smokeDetected}`);
    }
    // Gas leakage (GLD) — do not map onto WLD/SMD
    if (payload.gass !== undefined && !isSmd && !isWld) {
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

    console.log(`✅ Updated Fields: ${updatedFields.length > 0 ? updatedFields.join(" | ") : "None"}`);

    // Check conditions and update alert flags
    const alerts = checkConditions(device, payload);
    syncSmdSmokeDetectedFromAlert(device, alerts);
    syncWldWaterLeakFromAlert(device, alerts);

    if (isSmd) {
        payload.smokePct = device.espSmokePct;
        payload.smokeDetected = device.espSmoke === true;
    }
    if (isWld || wldApplied) {
        payload.waterLeak = device.espWaterLeak === true;
    }

    if (alerts.length > 0) {
        console.log(`🚨 Alerts Triggered: ${alerts.length} alert(s)`);
        alerts.forEach(alert => {
            console.log(`   → ${alert.message}`);
        });
    } else {
        console.log(`✅ No alerts triggered`);
    }

    // Save to database
    await device.save();

    // ==================== SAVE SENSOR DATA ====================
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
            }
            else if (device.deviceType === "THD") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
            }
            else if (device.deviceType === "AQID") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.AQI = payload.AQI;
            }
            else if (device.deviceType === "SMD") {
                sensorData.smoke = device.espSmokePct ?? payload.smokePct ?? payload.smoke;
            }
            else if (device.deviceType === "WLD") {
                sensorData.waterLeak = device.espWaterLeak === true;
            }
            else if (device.deviceType === "GLD") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.gass = payload.gass ?? device.espGL;
            }
            else if (device.deviceType === "ED") {
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

    const liveData = {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        data: payload,
        alerts: alerts,
        timestamp: new Date()
    };

    if (global.io) {
        global.io.emit(`device/${device.deviceId}`, liveData);
        console.log(`📤 Live data sent to frontend for device: ${device.deviceId}`);
    } else {
        console.warn(`⚠️ Socket.io not initialized - cannot send live data`);
    }

    console.log(`✅ Monitoring data processing completed for ${device.deviceId}\n`);
};

module.exports = { processMonitoringDeviceData };
