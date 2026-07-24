// src/services/schedulingProcessor.js
const checkConditions = require("./conditionChecker");
const sensorModel = require("../models/sensorModel");

const VALID_AC_MODES = ["Cool", "Heat", "Dry", "FanOnly", "Auto"];
const VALID_FAN_SPEEDS = ["Low", "Medium", "Ultra", "Turbo"];
/** Assumed mains voltage for AC power calc (P = I × V). ESP sends current only. */
const AC_ASSUMED_VOLTAGE = 225;

const processSchedulingDeviceData = async (device, payload) => {
    console.log(`\n📡 Processing SCHEDULING Data for Device: ${device.deviceName} (${device.deviceId})`);

    const updatedFields = [];
    const isAc = device.deviceType === "AC";
    // Capture before overwrite — needed for AC kWh integration
    const previousLastUpdate = device.lastUpdateTime;
    const previousPowerW = device.espPower;

    // Non-AC devices: live sensor temperature → espTemperature
    // AC: sensor room temp NOT used — only setpoint (setTemperature) below
    if (!isAc && payload.temperature !== undefined) {
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
    if (payload.smoke !== undefined) {
        const smokeDetected =
            payload.smoke === true ||
            String(payload.smoke).toLowerCase() === "detected" ||
            String(payload.smoke).toLowerCase() === "true" ||
            Number(payload.smoke) >= 1;
        device.espSmoke = smokeDetected;
        payload.smoke = smokeDetected;
        updatedFields.push(`smoke: ${smokeDetected}`);
    }
    if (payload.gass !== undefined) {
        device.espGL = payload.gass;
        updatedFields.push(`gass: ${payload.gass}`);
    }
    if (payload.voltage !== undefined && !isAc) {
        device.espVoltage = payload.voltage;
        updatedFields.push(`voltage: ${payload.voltage}`);
    }
    if (payload.current !== undefined && !isAc) {
        device.espCurrent = payload.current;
        updatedFields.push(`current: ${payload.current}`);
    }

    device.lastUpdateTime = new Date();

    // Always update state when received from ESP32
    if (payload.state !== undefined) {
        const newState = String(payload.state).toUpperCase().trim();
        if (["ON", "OFF"].includes(newState)) {
            device.state = newState;
            updatedFields.push(`state: ${newState}`);
            console.log(`🔄 Device state updated to ${newState}`);
        }
    }

    // ==================== AC-SPECIFIC FIELDS ====================
    // AC UI shows only setTemperature (current setpoint), NOT room sensor temp
    let lockReassertCommand = null;

    if (isAc) {
        // Health: ESP sends acHealth true/false OR acHealthAlert
        if (payload.acHealth !== undefined) {
            const healthy =
                payload.acHealth === true ||
                payload.acHealth === "true" ||
                payload.acHealth === 1 ||
                payload.acHealth === "1";
            device.acHealthAlert = !healthy;
            updatedFields.push(`acHealthAlert: ${device.acHealthAlert}`);
        } else if (payload.acHealthAlert !== undefined) {
            device.acHealthAlert = !!payload.acHealthAlert;
            updatedFields.push(`acHealthAlert: ${device.acHealthAlert}`);
        }

        // Energy module: ESP sends current only. V=220 assumed. P=I×V. Units (kWh) integrated over time.
        if (device.energyMonitoringIncluded && payload.current !== undefined) {
            const amps = Number(payload.current);
            if (Number.isFinite(amps)) {
                const powerW = amps * AC_ASSUMED_VOLTAGE;
                device.espCurrent = amps;
                device.espVoltage = AC_ASSUMED_VOLTAGE;
                device.espPower = powerW;
                updatedFields.push(`current: ${amps}A | power: ${powerW}W (V=${AC_ASSUMED_VOLTAGE})`);

                // Units: accumulate kWh between MQTT samples (trapezoid / avg power × hours)
                if (previousLastUpdate != null && previousPowerW != null && Number.isFinite(Number(previousPowerW))) {
                    const hours =
                        (device.lastUpdateTime.getTime() - new Date(previousLastUpdate).getTime()) / 3600000;
                    // Ignore absurd gaps (reboot / long offline) — don't inflate units
                    if (hours > 0 && hours <= 6) {
                        const avgPowerW = (Number(previousPowerW) + powerW) / 2;
                        const kWhIncrement = (avgPowerW / 1000) * hours;
                        device.espEnergy = Number(((device.espEnergy || 0) + kWhIncrement).toFixed(6));
                        updatedFields.push(`units +${kWhIncrement.toFixed(6)} kWh → ${device.espEnergy} kWh`);
                    }
                } else if (device.espEnergy == null) {
                    device.espEnergy = 0;
                }
            }
        }

        // Mode / fan from device (only accept when unlocked)
        if (payload.mode !== undefined || payload.acMode !== undefined) {
            const mode = String(payload.mode || payload.acMode).trim();
            if (VALID_AC_MODES.includes(mode)) {
                if (!device.acLocked) {
                    device.acMode = mode;
                    updatedFields.push(`acMode: ${mode}`);
                }
            }
        }

        if (payload.fanSpeed !== undefined) {
            const speed = String(payload.fanSpeed).trim();
            if (VALID_FAN_SPEEDS.includes(speed)) {
                if (!device.acLocked) {
                    device.fanSpeed = speed;
                    updatedFields.push(`fanSpeed: ${speed}`);
                }
            }
        }

        // Setpoint only: prefer setTemperature; if ESP sends "temperature", treat as setpoint alias
        const remoteSetpointRaw =
            payload.setTemperature !== undefined
                ? payload.setTemperature
                : payload.temperature;
        if (remoteSetpointRaw !== undefined) {
            const remoteSetTemp = Number(remoteSetpointRaw);
            if (Number.isFinite(remoteSetTemp)) {
                if (device.acLocked) {
                    const appSetTemp = Number(device.setTemperature);
                    if (Number.isFinite(appSetTemp) && remoteSetTemp !== appSetTemp) {
                        console.log(
                            `🔒 AC locked — remote setTemp ${remoteSetTemp} ignored, re-asserting ${appSetTemp}`
                        );
                        lockReassertCommand = {
                            isLockReassert: true,
                            setTemperature: appSetTemp,
                        };
                        updatedFields.push(`setTemperature(locked keep): ${appSetTemp}`);
                    }
                } else {
                    device.setTemperature = remoteSetTemp;
                    updatedFields.push(`setTemperature: ${remoteSetTemp}`);
                }
            }
        }
    }

    console.log(`✅ Updated Fields: ${updatedFields.length > 0 ? updatedFields.join(" | ") : "None"}`);

    // Threshold conditions (AC has none — health alert added separately)
    const alerts = checkConditions(device, payload);

    if (isAc && device.acHealthAlert) {
        alerts.push({
            type: "acHealth",
            value: false,
            message: "AC health check failed",
        });
    }

    // Smoke is ESP boolean (not a threshold condition)
    if (payload.smoke !== undefined || device.deviceType === "SMD") {
        const smokeDetected = device.espSmoke === true;
        device.smokeAlert = smokeDetected;
        if (smokeDetected && !alerts.some((a) => a.type === "smoke")) {
            alerts.push({
                type: "smoke",
                value: "Detected",
                message: "Smoke Detected",
            });
        }
    }

    if (alerts.length > 0) {
        console.log(`🚨 Alerts Triggered: ${alerts.length} alert(s)`);
        alerts.forEach((alert) => console.log(`   → ${alert.message}`));
    } else {
        console.log(`✅ No alerts triggered`);
    }

    await device.save();

    // Lock re-assert AFTER save so DB stays on app setpoint (Ackit MQTT)
    if (lockReassertCommand) {
        const { publishAcLockReassert } = require("./acScheduleHelper");
        const ok = await publishAcLockReassert(device);
        if (ok) {
            console.log(`🔒 Lock re-assert command published for ${device.deviceId}`);
        }
    }

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
            } else if (device.deviceType === "THD") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
            } else if (device.deviceType === "AQID") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.AQI = payload.AQI;
            } else if (device.deviceType === "SMD") {
                sensorData.AQI = payload.AQI;
                sensorData.smoke = payload.smoke;
            } else if (device.deviceType === "ED") {
                sensorData.temperature = payload.temperature;
                sensorData.humidity = payload.humidity;
                sensorData.voltage = payload.voltage;
                sensorData.current = payload.current;
            } else if (device.deviceType === "AC") {
                // Setpoint + optional energy snapshot (power/current derived)
                sensorData.temperature = device.setTemperature;
                if (device.espCurrent != null) sensorData.current = device.espCurrent;
                if (device.espPower != null) sensorData.voltage = device.espPower; // reuse field for W if needed
            }

            await SensorModel.create(sensorData);
            console.log(`💾 Sensor data saved in ${device.deviceType} Cluster`);
        }
    } catch (err) {
        console.error(`❌ Failed to save sensor data for ${device.deviceType}:`, err.message);
    }

    // Prepare data to send to frontend (AC: setTemperature is the display temp)
    const liveData = {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        state: device.state,
        data: payload,
        alerts: alerts,
        timestamp: new Date(),
        ...(isAc
            ? {
                setTemperature: device.setTemperature,
                acMode: device.acMode,
                fanSpeed: device.fanSpeed,
                acLocked: device.acLocked,
                acHealthAlert: device.acHealthAlert,
                energyMonitoringIncluded: device.energyMonitoringIncluded,
                espCurrent: device.espCurrent,
                espVoltage: device.espVoltage,
                espPower: device.espPower,
                espEnergy: device.espEnergy,
            }
            : {
                espTemperature: device.espTemperature,
            }),
    };

    if (global.io) {
        global.io.emit(`device/${device.deviceId}`, liveData);
        console.log(`📤 Live data sent to frontend for device: ${device.deviceId}`);
    } else {
        console.warn(`⚠️ Socket.io not initialized - cannot send live data`);
    }

    console.log(`✅ Scheduling data processing completed for ${device.deviceId}\n`);
};

module.exports = { processSchedulingDeviceData };
