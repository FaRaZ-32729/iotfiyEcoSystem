// models/scheduleModel.js
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        index: true
    },

    startTime: {        // HH:mm in UTC
        type: String,
        required: true
    },

    endTime: {          // HH:mm in UTC
        type: String,
        required: true
    },

    days: [{
        type: String,
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }],

    command: {
        type: String,
        enum: ["ON", "OFF"],
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

    isOvernight: {
        type: Boolean,
        default: false
    },

    manualOverride: {
        type: Boolean,
        default: false
    },

    overrideDate: {
        type: String,
        default: null
    },
    isRecurring: {
        type: Boolean,
        default: null
    }

}, { timestamps: true });

// Compound index for fast lookup
eventSchema.index({ deviceId: 1, status: 1 });

const eventModel = mongoose.model("events", eventSchema);

module.exports = eventModel;