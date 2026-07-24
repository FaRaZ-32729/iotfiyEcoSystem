// src/services/deviceDataProcessor.js
const Device = require("../models/deviceModel");

const processDeviceData = async (deviceId, payload) => {
    try {
        // Find device
        const device = await Device.findOne({ deviceId });
        if (!device) {
            console.warn(`⚠️ Device ${deviceId} not found in database`);
            return;
        }

        // ==================== UPDATE SENSOR VALUES ====================
        device.espTemperature = payload.temperature !== undefined ? payload.temperature : device.espTemperature;
        device.espHumidity = payload.humidity !== undefined ? payload.humidity : device.espHumidity;
        device.espOdour = payload.odour !== undefined ? payload.odour : device.espOdour;
        device.espAQI = payload.AQI !== undefined ? payload.AQI : device.espAQI;
        if (payload.smoke !== undefined) {
            const smokeDetected =
                payload.smoke === true ||
                String(payload.smoke).toLowerCase() === "detected" ||
                String(payload.smoke).toLowerCase() === "true" ||
                Number(payload.smoke) >= 1;
            device.espSmoke = smokeDetected;
            device.smokeAlert = smokeDetected;
        }
        device.espGL = payload.gass !== undefined ? payload.gass : device.espGL;
        device.espVoltage = payload.voltage !== undefined ? payload.voltage : device.espVoltage;
        device.espCurrent = payload.current !== undefined ? payload.current : device.espCurrent;

        device.lastUpdateTime = new Date();

        // ==================== CHECK CONDITIONS & TRIGGER ALERTS ====================
        const alertsTriggered = checkConditions(device, payload);

        // Save alerts status in device
        if (alertsTriggered.length > 0) {
            alertsTriggered.forEach(alert => {
                const field = `${alert.type}Alert`;
                if (device[field] !== undefined) {
                    device[field] = true;
                }
            });
        }

        // Save updated device data
        await device.save();

        // ==================== SEND LIVE DATA TO FRONTEND ====================
        global.io.emit(`device/${deviceId}`, {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: device.category,
            data: payload,
            alerts: alertsTriggered,
            timestamp: new Date()
        });

        console.log(`📡 Data processed for device ${deviceId} | Alerts: ${alertsTriggered.length}`);

    } catch (error) {
        console.error(`Error processing data for device ${deviceId}:`, error);
    }
};

// ==================== CONDITION CHECKER ====================
const checkConditions = (device, payload) => {
    const triggered = [];

    device.conditions.forEach(cond => {
        const currentValue = payload[cond.type];
        if (currentValue === undefined || currentValue === null) return;

        let isTriggered = false;

        if (cond.operator === ">" && currentValue > cond.value) isTriggered = true;
        if (cond.operator === "<" && currentValue < cond.value) isTriggered = true;
        if (cond.operator === "=" && currentValue === cond.value) isTriggered = true;

        if (isTriggered) {
            triggered.push({
                type: cond.type,
                value: currentValue,
                threshold: cond.value,
                operator: cond.operator,
                message: `${cond.type} is ${cond.operator} ${cond.value}`
            });
        }
    });

    return triggered;
};

module.exports = { processDeviceData };