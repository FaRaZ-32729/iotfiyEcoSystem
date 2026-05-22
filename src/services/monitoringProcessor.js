// src/services/processors/monitoringProcessor.js
const checkConditions = require("./conditionChecker");

const processMonitoringDeviceData = async (device, payload) => {
    console.log(`\n📡 Processing Monitoring Data for Device: ${device.deviceName} (${device.deviceId})`);

    // Update sensor values
    const updatedFields = [];

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

    console.log(`✅ Updated Fields: ${updatedFields.length > 0 ? updatedFields.join(" | ") : "None"}`);

    // Check conditions and update alert flags
    const alerts = checkConditions(device, payload);

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

    // Prepare data to send to frontend
    const liveData = {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        data: payload,
        alerts: alerts,
        timestamp: new Date()
    };

    // Send to frontend via Socket.io
    if (global.io) {
        global.io.emit(`device/${device.deviceId}`, liveData);
        console.log(`📤 Live data sent to frontend for device: ${device.deviceId}`);
    } else {
        console.warn(`⚠️ Socket.io not initialized - cannot send live data`);
    }

    console.log(`✅ Monitoring data processing completed for ${device.deviceId}\n`);
};

module.exports = { processMonitoringDeviceData };