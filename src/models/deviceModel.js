// // models/deviceModel.js
// const mongoose = require("mongoose");

// const conditionSchema = new mongoose.Schema({
//     type: { type: String, required: true },
//     operator: { type: String, required: true },
//     value: { type: Number, required: true }
// });

// const deviceSchema = new mongoose.Schema({
//     deviceId: { type: String, required: true, unique: true, trim: true },
//     deviceName: { type: String, required: true, trim: true },

//     deviceType: {
//         type: String,
//         required: true,
//         enum: ["OD", "THD", "AQID", "GLD", "ED"]
//     },

//     category: {
//         type: String,
//         required: true,
//         enum: ["monitoring", "scheduling", "trigger"]
//     },

//     status: {
//         type: String,
//         enum: ["online", "offline"],
//         default: "offline"
//     },

//     state: {
//         type: String,
//         enum: ["ON", "OFF"],
//         default: "OFF"
//     },

//     manualButton: {
//         type: Boolean,
//         default: false
//     },

//     lastSeen: {
//         type: Date,
//         default: null
//     },

//     interval: { type: Number, default: 5, min: 1 },

//     venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },

//     conditions: [conditionSchema],

//     apiKey: { type: String, required: true, unique: true },

//     version: {
//         type: String,
//         default: null
//     },

//     // Common fields
//     temperatureAlert: { type: Boolean, default: false },
//     humidityAlert: { type: Boolean, default: false },
//     espTemperature: { type: Number, default: null },
//     espHumidity: { type: Number, default: null },

//     // Type-specific fields
//     odourAlert: { type: Boolean, default: false },
//     espOdour: { type: Number, default: null },

//     aqiAlert: { type: Boolean, default: false },
//     espAQI: { type: Number, default: null },

//     glAlert: { type: Boolean, default: false },
//     espGL: { type: Number, default: null },

//     voltageAlert: { type: Boolean, default: false },
//     espVoltage: { type: Number, default: null },

//     currentAlert: { type: Boolean, default: false },
//     espCurrent: { type: Number, default: null },

//     // === NEW ALERT ACCESS FIELDS FOR TRIGGER DEVICES ===
//     tempAlertAccess: { type: Boolean, default: true },
//     humiAlertAccess: { type: Boolean, default: true },
//     odourAlertAccess: { type: Boolean, default: false },
//     aqiAlertAccess: { type: Boolean, default: false },
//     glAlertAccess: { type: Boolean, default: false },
//     voltageAlertAccess: { type: Boolean, default: false },
//     currentAlertAccess: { type: Boolean, default: false },

//     lastUpdateTime: { type: Date, default: null }

// }, { timestamps: true });

// // Compound Index
// deviceSchema.index({ deviceName: 1, venue: 1 }, { unique: true });

// // ==================== PRE-SAVE MIDDLEWARE (Modern & Safe) ====================
// deviceSchema.pre('save', async function () {
//     const type = this.deviceType;
//     const category = this.category;

//     const allowedFields = {
//         "OD": ["odourAlert", "espOdour"],
//         "THD": [],
//         "AQID": ["aqiAlert", "espAQI"],
//         "GLD": ["glAlert", "espGL"],
//         "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent"]
//     };

//     const keepFields = [
//         "deviceId", "deviceName", "deviceType", "category", "venue",
//         "conditions", "apiKey",
//         "temperatureAlert", "humidityAlert", "espTemperature", "espHumidity",
//         "lastUpdateTime",
//         "status",
//         "lastSeen",
//         "version",
//         ...(allowedFields[type] || [])
//     ];

//     if (category === "scheduling" || category === "trigger") {
//         keepFields.push("state");
//     }

//     if (category === "trigger") {
//         keepFields.push("manualButton");
//         keepFields.push("interval");
//     }



//     // Remove all unwanted fields
//     Object.keys(this.toObject()).forEach(key => {
//         if (!keepFields.includes(key) && !["_id", "createdAt", "updatedAt", "__v"].includes(key)) {
//             this.set(key, undefined);
//         }
//     });
// });

// deviceSchema.set('toJSON', {
//     transform: function (doc, ret) {
//         const type = doc.deviceType;
//         const category = doc.category;

//         const allowedFields = {
//             "OD": ["odourAlert", "espOdour"],
//             "THD": [],
//             "AQID": ["aqiAlert", "espAQI"],
//             "GLD": ["glAlert", "espGL"],
//             "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent"]
//         };

//         const keepFields = [
//             "deviceId", "deviceName", "deviceType", "category", "venue",
//             "conditions", "apiKey",
//             "temperatureAlert", "humidityAlert", "espTemperature", "espHumidity",
//             "lastUpdateTime",
//             "status",
//             "interval",
//             "version",
//             ...(allowedFields[type] || [])
//         ];

//         // if (category !== "trigger") {
//         //     delete ret.interval;
//         //     delete ret.manualButton;
//         // }
//         if (category === "trigger") {
//             keepFields.push("manualButton");
//             keepFields.push("interval");
//         }

//         // if (category !== "scheduling" || category !== "trigger") {
//         //     keepFields.push("state");
//         // }
//         if (category === "scheduling" || category === "trigger") {
//             keepFields.push("state");
//         }

//         Object.keys(ret).forEach(key => {
//             if (!keepFields.includes(key) && !["_id", "createdAt", "updatedAt", "__v"].includes(key)) {
//                 delete ret[key];
//             }
//         });

//         return ret;
//     }
// });

// const Device = mongoose.model("Device", deviceSchema);
// module.exports = Device;


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

    deviceType: { type: String, required: true, enum: ["OD", "THD", "AQID", "GLD", "ED"] },
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

    glAlert: { type: Boolean, default: false },
    espGL: { type: Number, default: null },

    voltageAlert: { type: Boolean, default: false },
    espVoltage: { type: Number, default: null },

    currentAlert: { type: Boolean, default: false },
    espCurrent: { type: Number, default: null },

    // === ALERT ACCESS FIELDS (Only for Trigger Category) ===
    tempAlertAccess: { type: Boolean, default: false },
    humiAlertAccess: { type: Boolean, default: false },
    odourAlertAccess: { type: Boolean, default: false },
    aqiAlertAccess: { type: Boolean, default: false },
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
        this.glAlertAccess = undefined;
        this.voltageAlertAccess = undefined;
        this.currentAlertAccess = undefined;
    }

    const type = this.deviceType;

    const allowedFields = {
        "OD": ["odourAlert", "espOdour", "odourAlertAccess"],
        "THD": [],
        "AQID": ["aqiAlert", "espAQI", "aqiAlertAccess"],
        "GLD": ["glAlert", "espGL", "glAlertAccess"],
        "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent",
            "voltageAlertAccess", "currentAlertAccess"]
    };

    const keepFields = [
        "deviceId", "deviceName", "deviceType", "category", "venue",
        "conditions", "apiKey",
        "temperatureAlert", "humidityAlert", "espTemperature", "espHumidity",
        "lastUpdateTime", "status", "lastSeen", "version",
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
            delete ret.glAlertAccess;
            delete ret.voltageAlertAccess;
            delete ret.currentAlertAccess;
        }

        const allowedFields = {
            "OD": ["odourAlert", "espOdour", "odourAlertAccess"],
            "THD": [],
            "AQID": ["aqiAlert", "espAQI", "aqiAlertAccess"],
            "GLD": ["glAlert", "espGL", "glAlertAccess"],
            "ED": ["voltageAlert", "espVoltage", "currentAlert", "espCurrent",
                "voltageAlertAccess", "currentAlertAccess"]
        };

        const keepFields = [
            "deviceId", "deviceName", "deviceType", "category", "venue",
            "conditions", "apiKey",
            "temperatureAlert", "humidityAlert", "espTemperature", "espHumidity",
            "lastUpdateTime", "status", "interval", "version",
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