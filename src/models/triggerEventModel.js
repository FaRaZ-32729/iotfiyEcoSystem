// models/triggerScheduleModel.js
const mongoose = require("mongoose");

const triggerScheduleSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        index: true
    },

    startTime: {        // HH:mm in UTC
        type: String,
        required: true
    },

    days: [{
        type: String,
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }],

    intervalSeconds: {
        type: Number,
        required: true,
        min: 1
    },

    command: {
        type: String,
        enum: ["ON"],
        default: "ON"
    },

    status: {
        type: String,
        enum: ["ACTIVE", "INACTIVE"],
        default: "ACTIVE"
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    isRecurring: {
        type: Boolean,
        default: true
    },

    startCron: String,     // Only for recurring

}, { timestamps: true });

// Compound Index
triggerScheduleSchema.index({ deviceId: 1, status: 1 });

const TriggerSchedule = mongoose.model("triggerEvents", triggerScheduleSchema);

module.exports = TriggerSchedule;