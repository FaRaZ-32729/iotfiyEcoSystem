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

    deviceType: { type: String, required: true, enum: ["OD", "THD", "AQID", "GLD", "ED", "AC", "SMD", "WLD"] },
    category: { type: String, required: true, enum: ["monitoring", "scheduling", "trigger"] },

    status: { type: String, enum: ["online", "offline"], default: "offline" },
    state: { type: String, enum: ["ON", "OFF"], default: "OFF" },

    manualButton: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    interval: { type: Number, default: 5, min: 1 },

    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },
    conditions: [conditionSchema],
    apiKey: { type: String, required: true, unique: true },
    version: { type: String, default: null },

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

    smokeAlert: { type: Boolean, default: false },
    /** Smoke level 0–100% from ESP (SMD). Separate from boolean espSmoke. */
    espSmokePct: { type: Number, default: null },
    espSmoke: { type: Boolean, default: false },

    /** Water leakage (WLD) — ESP waterLeak true/false */
    waterLeakAlert: { type: Boolean, default: false },
    espWaterLeak: { type: Boolean, default: false },

    glAlert: { type: Boolean, default: false },
    espGL: { type: Number, default: null },

    voltageAlert: { type: Boolean, default: false },
    espVoltage: { type: Number, default: null },

    currentAlert: { type: Boolean, default: false },
    espCurrent: { type: Number, default: null },

    // === AC Device fields ===
    /** Ackit brand name only (unique on Ackit) — IR codes stay on Ackit */
    brandName: { type: String, default: null, trim: true, lowercase: true },
    setTemperature: { type: Number, default: 26 },
    acMode: {
        type: String,
        enum: ["Cool", "Heat", "Dry", "FanOnly", "Auto"],
        default: "Cool"
    },
    fanSpeed: {
        type: String,
        enum: ["Low", "Medium", "High", "Ultra", "Turbo"],
        default: "Low"
    },
    acLocked: { type: Boolean, default: false },
    acHealthAlert: { type: Boolean, default: false },
    /** When true: show AC health alerts. When false: show live ESP room temperature instead. */
    acHealthMonitoringIncluded: { type: Boolean, default: false },
    energyMonitoringIncluded: { type: Boolean, default: false },
    espPower: { type: Number, default: null },
    espEnergy: { type: Number, default: null },

    // === ALERT ACCESS FIELDS (Only for Trigger Category) ===
    tempAlertAccess: { type: Boolean, default: false },
    humiAlertAccess: { type: Boolean, default: false },
    odourAlertAccess: { type: Boolean, default: false },
    aqiAlertAccess: { type: Boolean, default: false },
    smokeAlertAccess: { type: Boolean, default: false },
    waterLeakAlertAccess: { type: Boolean, default: false },
    glAlertAccess: { type: Boolean, default: false },
    voltageAlertAccess: { type: Boolean, default: false },
    currentAlertAccess: { type: Boolean, default: false },

    lastUpdateTime: { type: Date, default: null }

}, { timestamps: true });

// ==================== PRE-SAVE MIDDLEWARE (Important Fix) ====================
deviceSchema.pre('save', async function () {
    const category = this.category;

    // Agar category "trigger" nahi hai to saare AlertAccess fields remove kar do
    if (category !== "trigger") {
        this.tempAlertAccess = undefined;
        this.humiAlertAccess = undefined;
        this.odourAlertAccess = undefined;
        this.aqiAlertAccess = undefined;
        this.smokeAlertAccess = undefined;
        this.waterLeakAlertAccess = undefined;
        this.glAlertAccess = undefined;
        this.voltageAlertAccess = undefined;
        this.currentAlertAccess = undefined;
    }

    const type = this.deviceType;

    const allowedFields = {
        "OD": ["odourAlert", "espOdour", "odourAlertAccess"],
        "THD": [],
        "AQID": ["aqiAlert", "espAQI", "aqiAlertAccess"],
        "SMD": ["smokeAlert", "espSmoke", "espSmokePct", "smokeAlertAccess"],
        "WLD": ["waterLeakAlert", "espWaterLeak", "waterLeakAlertAccess"],
        "GLD": ["glAlert", "espGL", "glAlertAccess"],
        "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent",
            "voltageAlertAccess", "currentAlertAccess"],
        "AC": [
            "brandName",
            "setTemperature", "acMode", "fanSpeed", "acLocked",
            "acHealthAlert", "acHealthMonitoringIncluded", "energyMonitoringIncluded",
            "espCurrent", "espVoltage", "espPower", "espEnergy"
        ]
    };

    // SMD / WLD: no temperature / humidity fields
    const keepFields = [
        "deviceId", "deviceName", "deviceType", "category", "venue",
        "conditions", "apiKey",
        "lastUpdateTime", "status", "lastSeen", "version",
        ...(type === "SMD" || type === "WLD" ? [] : ["temperatureAlert", "humidityAlert", "espTemperature", "espHumidity"]),
        ...(allowedFields[type] || [])
    ];

    if (category === "scheduling" || category === "trigger") {
        keepFields.push("state");
    }

    if (category === "trigger") {
        keepFields.push("manualButton");
        keepFields.push("interval");
        keepFields.push("tempAlertAccess");
        keepFields.push("humiAlertAccess");
    }

    // Remove unwanted fields
    Object.keys(this.toObject()).forEach(key => {
        if (!keepFields.includes(key) && !["_id", "createdAt", "updatedAt", "__v"].includes(key)) {
            this.set(key, undefined);
        }
    });
});

// ==================== TOJSON TRANSFORM ====================
deviceSchema.set('toJSON', {
    transform: function (doc, ret) {
        const category = doc.category;
        const type = doc.deviceType;

        // Non-trigger devices se alert access fields hata do
        if (category !== "trigger") {
            delete ret.tempAlertAccess;
            delete ret.humiAlertAccess;
            delete ret.odourAlertAccess;
            delete ret.aqiAlertAccess;
            delete ret.smokeAlertAccess;
            delete ret.waterLeakAlertAccess;
            delete ret.glAlertAccess;
            delete ret.voltageAlertAccess;
            delete ret.currentAlertAccess;
        }

        const allowedFields = {
            "OD": ["odourAlert", "espOdour", "odourAlertAccess"],
            "THD": [],
            "AQID": ["aqiAlert", "espAQI", "aqiAlertAccess"],
            "SMD": ["smokeAlert", "espSmoke", "espSmokePct", "smokeAlertAccess"],
            "WLD": ["waterLeakAlert", "espWaterLeak", "waterLeakAlertAccess"],
            "GLD": ["glAlert", "espGL", "glAlertAccess"],
            "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent",
                "voltageAlertAccess", "currentAlertAccess"],
            "AC": [
                "brandName",
                "setTemperature", "acMode", "fanSpeed", "acLocked",
                "acHealthAlert", "acHealthMonitoringIncluded", "energyMonitoringIncluded",
                "espCurrent", "espVoltage", "espPower", "espEnergy"
            ]
        };

        const keepFields = [
            "deviceId", "deviceName", "deviceType", "category", "venue",
            "conditions", "apiKey",
            "lastUpdateTime", "status", "interval", "version",
            ...(type === "SMD" || type === "WLD" ? [] : ["temperatureAlert", "humidityAlert", "espTemperature", "espHumidity"]),
            ...(allowedFields[type] || [])
        ];

        if (category === "scheduling" || category === "trigger") {
            keepFields.push("state");
        }
        if (category === "trigger") {
            keepFields.push("manualButton");
            keepFields.push("interval");
            keepFields.push("tempAlertAccess");
            keepFields.push("humiAlertAccess");
            keepFields.push("odourAlertAccess");
            keepFields.push("aqiAlertAccess");
            keepFields.push("smokeAlertAccess");
            keepFields.push("waterLeakAlertAccess");
            keepFields.push("glAlertAccess");
            keepFields.push("voltageAlertAccess");
            keepFields.push("currentAlertAccess");
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