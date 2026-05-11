// models/subscriptionPlanModel.js
const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema({
    name: {
        type: String,
        enum: ["free", "basic", "premium", "custom"],
        required: true,
        unique: true
    },
    displayName: {
        type: String,
        required: true
    },
    description: String,

    price: {
        type: Number,
        required: true,
        min: 0
    },

    durationDays: {
        type: Number,
        required: true
    },

    // Limits
    maxOrganizations: { type: Number, required: true },
    maxVenues: { type: Number, required: true },
    maxDevices: { type: Number, required: true },

    isActive: {
        type: Boolean,
        default: true
    },
    isTrial: {
        type: Boolean,
        default: false
    },

    features: [String]   // e.g., ["real-time-monitoring", "advanced-alerts", "reports"]
}, { 
    timestamps: true 
});

module.exports = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);