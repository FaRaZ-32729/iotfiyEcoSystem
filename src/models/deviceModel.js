// models/deviceModel.js
const mongoose = require("mongoose");

const conditionSchema = new mongoose.Schema({
    type: { type: String, required: true },
    operator: { type: String, required: true },
    value: { type: Number, required: true }
});

const deviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true, trim: true },
    deviceName: { type: String, required: true, trim: true },

    deviceType: {
        type: String,
        required: true,
        enum: ["OD", "THD", "AQID", "GLD", "ED"]
    },

    category: {
        type: String,
        required: true,
        enum: ["monitoring", "scheduling", "trigger"]
    },

    status: {
        type: String,
        enum: ["online", "offline"],
        default: "offline"
    },

    state: {
        type: String,
        enum: ["ON", "OFF"],
        default: "OFF"
    },

    manualButton: {
        type: Boolean,
        default: false
    },

    lastSeen: {
        type: Date,
        default: null
    },

    interval: { type: Number, default: 5, min: 1 },

    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },

    conditions: [conditionSchema],

    apiKey: { type: String, required: true, unique: true },

    // Common fields
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

}, { timestamps: true });

// Compound Index
deviceSchema.index({ deviceName: 1, venue: 1 }, { unique: true });

// ==================== PRE-SAVE MIDDLEWARE (Modern & Safe) ====================
deviceSchema.pre('save', async function () {
    const type = this.deviceType;
    const category = this.category;

    const allowedFields = {
        "OD": ["odourAlert", "espOdour"],
        "THD": [],
        "AQID": ["aqiAlert", "espAQI"],
        "GLD": ["glAlert", "espGL"],
        "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent"]
    };

    const keepFields = [
        "deviceId", "deviceName", "deviceType", "category", "venue",
        "conditions", "apiKey",
        "temperatureAlert", "humidityAlert", "espTemperature", "espHumidity",
        "lastUpdateTime",
        "status",
        "lastSeen",
        ...(allowedFields[type] || [])
    ];

    if (category === "scheduling" || category === "trigger") {
        keepFields.push("state");
    }

    if (category === "trigger") {
        keepFields.push("manualButton");
        keepFields.push("interval");
    }



    // Remove all unwanted fields
    Object.keys(this.toObject()).forEach(key => {
        if (!keepFields.includes(key) && !["_id", "createdAt", "updatedAt", "__v"].includes(key)) {
            this.set(key, undefined);
        }
    });
});

deviceSchema.set('toJSON', {
    transform: function (doc, ret) {
        const type = doc.deviceType;
        const category = doc.category;

        const allowedFields = {
            "OD": ["odourAlert", "espOdour"],
            "THD": [],
            "AQID": ["aqiAlert", "espAQI"],
            "GLD": ["glAlert", "espGL"],
            "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent"]
        };

        const keepFields = [
            "deviceId", "deviceName", "deviceType", "category", "venue",
            "conditions", "apiKey",
            "temperatureAlert", "humidityAlert", "espTemperature", "espHumidity",
            "lastUpdateTime",
            "state",
            "interval",
            ...(allowedFields[type] || [])
        ];

        if (category !== "trigger") {
            delete ret.interval;
            delete ret.manualButton;
        }

        if (category !== "scheduling" || category !== "trigger") {
            delete ret.state;
        }

        Object.keys(ret).forEach(key => {
            if (!keepFields.includes(key) && !["_id", "createdAt", "updatedAt", "__v"].includes(key)) {
                delete ret[key];
            }
        });

        return ret;
    }
});

const Device = mongoose.model("Device", deviceSchema);
module.exports = Device;