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
    smoke: Number,
    waterLeak: Boolean,
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