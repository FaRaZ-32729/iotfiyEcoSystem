// // src/services/processors/conditionChecker.js
// const checkConditions = (device, payload) => {
//     const triggered = [];

//     // Reset all alert flags first
//     device.temperatureAlert = false;
//     device.humidityAlert = false;
//     device.odourAlert = false;
//     device.aqiAlert = false;
//     device.glAlert = false;
//     device.voltageAlert = false;
//     device.currentAlert = false;

//     // Check each condition saved in the device
//     device.conditions.forEach(cond => {
//         const currentValue = payload[cond.type];
//         if (currentValue === undefined || currentValue === null) return;

//         let isTriggered = false;

//         if (cond.operator === ">" && currentValue > cond.value) isTriggered = true;
//         if (cond.operator === "<" && currentValue < cond.value) isTriggered = true;
//         if (cond.operator === "=" && currentValue === cond.value) isTriggered = true;

//         if (isTriggered) {
//             triggered.push({
//                 type: cond.type,
//                 value: currentValue,
//                 threshold: cond.value,
//                 operator: cond.operator,
//                 message: `${cond.type} is ${cond.operator} ${cond.value}`
//             });

//             // Automatically set the corresponding alert flag
//             switch (cond.type) {
//                 case "temperature":
//                     device.temperatureAlert = true;
//                     break;
//                 case "humidity":
//                     device.humidityAlert = true;
//                     break;
//                 case "odour":
//                     device.odourAlert = true;
//                     break;
//                 case "AQI":
//                     device.aqiAlert = true;
//                     break;
//                 case "gass":
//                     device.glAlert = true;
//                     break;
//                 case "voltage":
//                     device.voltageAlert = true;
//                     break;
//                 case "current":
//                     device.currentAlert = true;
//                     break;
//             }
//         }
//     });

//     return triggered;
// };

// module.exports = checkConditions;


// src/services/processors/conditionChecker.js

const checkConditions = (device, payload) => {
    const triggered = [];

    // Reset all alert flags first
    device.temperatureAlert = false;
    device.humidityAlert = false;
    device.odourAlert = false;
    device.aqiAlert = false;
    device.glAlert = false;
    device.voltageAlert = false;
    device.currentAlert = false;

    // Safety Check: Prevent crash if conditions is missing or not an array
    if (!device.conditions || !Array.isArray(device.conditions)) {
        console.warn(`⚠️ No conditions found for device: ${device.deviceId || 'unknown'}`);
        return triggered;
    }

    // Check each condition
    device.conditions.forEach(cond => {
        if (!cond || typeof cond.type !== 'string') return;

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

            // Automatically update alert flags
            switch (cond.type) {
                case "temperature":
                    device.temperatureAlert = true;
                    break;
                case "humidity":
                    device.humidityAlert = true;
                    break;
                case "odour":
                    device.odourAlert = true;
                    break;
                case "AQI":
                    device.aqiAlert = true;
                    break;
                case "gass":
                    device.glAlert = true;
                    break;
                case "voltage":
                    device.voltageAlert = true;
                    break;
                case "current":
                    device.currentAlert = true;
                    break;
            }
        }
    });

    return triggered;
};

module.exports = checkConditions;