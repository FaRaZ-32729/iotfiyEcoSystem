// // models/sensorMdoel.js
// const mongoose = require("mongoose");
// const { getDBConnection } = require("../config/multiDb");

// const sensorSchema = new mongoose.Schema({
//     deviceId: { 
//         type: String, 
//         required: true, 
//         index: true 
//     },
//     timestamp: { 
//         type: Date, 
//         required: true 
//     },

//     temperature: Number,
//     humidity: Number,
//     odour: Number,
//     AQI: Number,
//     gass: Number,
//     voltage: Number,
//     current: Number,

// }, {
//     timeseries: {
//         timeField: "timestamp",
//         metaField: "deviceId",
//         granularity: "minutes"
//     }
// });

// // Dynamic Model per Device Type
// const SensorReading = (deviceType) => {
//     const conn = getDBConnection(deviceType);
//     return conn.model(`SensorReading_${deviceType}`, sensorSchema);
// };

// module.exports = SensorReading;


// models/SensorReading.js
// // models/sensorMdoel.js
// const mongoose = require("mongoose");
// const { getDBConnection } = require("../config/multiDBs");

// const sensorSchema = new mongoose.Schema({
//     deviceId: {
//         type: String,
//         required: true,
//         index: true
//     },
//     deviceType: {
//         type: String,
//         required: true,
//         enum: ["OD", "THD", "AQID", "GLD", "ED"]
//     },
//     timestamp: {
//         type: Date,
//         required: true
//     },

//     temperature: Number,
//     humidity: Number,
//     odour: Number,
//     AQI: Number,
//     gass: Number,
//     voltage: Number,
//     current: Number,

// }, {
//     timeseries: {
//         timeField: "timestamp",
//         metaField: "deviceId",
//         granularity: "minutes"
//     }
// });

// // ==================== PRE-SAVE MIDDLEWARE (SIMPLE & SAFE) ====================
// sensorSchema.pre('save', function (next) {
//     try {
//         const deviceType = this.get('deviceType') || this.deviceType;

//         if (!deviceType) {
//             console.warn("⚠️ deviceType not provided in sensor data");
//             return next();
//         }

//         const allowedFields = {
//             "OD": ["temperature", "humidity", "odour"],
//             "THD": ["temperature", "humidity"],
//             "AQID": ["temperature", "humidity", "AQI"],
//             "GLD": ["temperature", "humidity", "gass"],
//             "ED": ["temperature", "humidity", "voltage", "current"]
//         };

//         const keepFields = ["deviceId", "deviceType", "timestamp", ...(allowedFields[deviceType] || [])];

//         Object.keys(this.toObject()).forEach(key => {
//             if (!keepFields.includes(key)) {
//                 this.set(key, undefined);
//             }
//         });

//         next();
//     } catch (err) {
//         console.error("Middleware Error:", err.message);
//         next();   // Must call next()
//     }
// });

// // Dynamic Model
// const sensorModel = (deviceType) => {
//     const conn = getDBConnection(deviceType);
//     if (!conn) {
//         console.warn(`⚠️ No connection found for deviceType: ${deviceType}`);
//         return null;
//     }
//     return conn.model(`SensorReading_${deviceType}`, sensorSchema);
// };

// module.exports = sensorModel;



// models/sensorMdoel.js
const mongoose = require("mongoose");
const { getDBConnection } = require("../config/multiDBs");

const sensorSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        index: true
    },
    // deviceType: {
    //     type: String,
    //     required: true,
    //     enum: ["OD", "THD", "AQID", "GLD", "ED"]
    // },
    timestamp: {
        type: Date,
        required: true
    },

    temperature: Number,
    humidity: Number,
    odour: Number,
    AQI: Number,
    gass: Number,
    voltage: Number,
    current: Number,

}, {
    timeseries: {
        timeField: "timestamp",
        metaField: "deviceId",
        granularity: "minutes"
    }
});

// Dynamic Model
const sensorModel = (deviceType) => {
    const conn = getDBConnection(deviceType);
    if (!conn) {
        console.warn(`⚠️ No connection found for deviceType: ${deviceType}`);
        return null;
    }
    return conn.model(`${deviceType}_SensorReading`, sensorSchema);
};

module.exports = sensorModel;