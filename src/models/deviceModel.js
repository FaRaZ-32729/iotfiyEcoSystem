// models/deviceModel.js
const mongoose = require("mongoose");

const conditionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ["temperature", "humidity", "odour", "AQI", "gass", "voltage", "current"]
    },
    operator: {
        type: String,
        required: true,
        enum: [">", "<", "="]
    },
    value: {
        type: Number,
        required: true
    }
});

const deviceSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    deviceName: {
        type: String,
        required: true,
        trim: true
    },

    // ==================== NEW PROFESSIONAL DEVICE TYPE ====================
    deviceType: {
        type: String,
        required: true,
        enum: [
            "OD",      // Odour Device
            "THD",     // Temperature & Humidity Device
            "AQID",    // AQI Device
            "GLD",     // Gas Leakage Device
            "ED",      // Energy Device
        ]
    },

    // New field for better categorization
    category: {
        type: String,
        required: true,
        enum: [
            "monitoring",           // Only monitoring
            "scheduling",           // Scheduling + Monitoring
            "trigger",              // Trigger based + Monitoring
        ]
    },

    venue: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Venue",
        required: true
    },

    conditions: [conditionSchema],

    apiKey: {
        type: String,
        required: true,
        unique: true
    },

    // Common sensor fields
    temperatureAlert: { type: Boolean, default: false },
    humidityAlert: { type: Boolean, default: false },
    espTemperature: { type: Number, default: null },
    espHumidity: { type: Number, default: null },

    // Type-specific fields
    odourAlert: { type: Boolean, default: false },
    espOdour: { type: Number, default: null },

    aqiAlert: { type: Boolean, default: false },
    espAQI: { type: Number, default: null },

    glAlert: { type: Boolean, default: false },
    espGL: { type: Number, default: null },

    voltageAlert: { type: Boolean, default: false },
    espVoltage: { type: Number, default: null },

    currentAlert: { type: Boolean, default: false },
    espCurrent: { type: Number, default: null },

    lastUpdateTime: { type: Date, default: null }

}, {
    timestamps: true
});

// Compound Index: deviceName must be unique per venue
deviceSchema.index({ deviceName: 1, venue: 1 }, { unique: true });

const Device = mongoose.model("Device", deviceSchema);
module.exports = Device;