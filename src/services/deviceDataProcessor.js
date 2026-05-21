// src/services/deviceDataProcessor.js
const Device = require("../models/deviceModel");

const processDeviceData = async (deviceId, payload) => {
    const device = await Device.findOne({ deviceId });

    if (!device) {
        console.warn(`Device ${deviceId} not found`);
        return;
    }

    // Update sensor values
    device.espTemperature = payload.temperature || device.espTemperature;
    device.espHumidity = payload.humidity || device.espHumidity;
    device.espOdour = payload.odour || device.espOdour;
    device.espAQI = payload.AQI || device.espAQI;
    device.espGL = payload.gass || device.espGL;
    device.espVoltage = payload.voltage || device.espVoltage;
    device.espCurrent = payload.current || device.espCurrent;
    device.lastUpdateTime = new Date();

    // Check conditions and trigger alerts
    const alertsTriggered = checkConditions(device, payload);

    // if (alertsTriggered.length > 0) {
    //     await sendAlert(device, alertsTriggered);
    // }

    await device.save();

    // Emit real-time update via Socket.io
    global.io.emit(`device/${deviceId}`, {
        deviceId,
        data: payload,
        alerts: alertsTriggered
    });
};

const checkConditions = (device, payload) => {
    const triggered = [];

    device.conditions.forEach(cond => {
        const currentValue = payload[cond.type];
        if (currentValue === undefined) return;

        let isTriggered = false;

        if (cond.operator === ">" && currentValue > cond.value) isTriggered = true;
        if (cond.operator === "<" && currentValue < cond.value) isTriggered = true;
        if (cond.operator === "=" && currentValue === cond.value) isTriggered = true;

        if (isTriggered) {
            triggered.push({
                type: cond.type,
                value: currentValue,
                threshold: cond.value,
                operator: cond.operator
            });
        }
    });

    return triggered;
};

module.exports = { processDeviceData };