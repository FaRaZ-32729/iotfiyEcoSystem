// models/sensorMdoel.js
const mongoose = require("mongoose");
const { getDBConnection } = require("../config/multiDb");

const sensorSchema = new mongoose.Schema({
    deviceId: { 
        type: String, 
        required: true, 
        index: true 
    },
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

// Dynamic Model per Device Type
const SensorReading = (deviceType) => {
    const conn = getDBConnection(deviceType);
    return conn.model(`SensorReading_${deviceType}`, sensorSchema);
};

module.exports = SensorReading;