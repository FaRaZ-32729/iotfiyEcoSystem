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
    description: {
        type: String,
        required: true
    },

    price: {
        type: Number,
        required: true,
        min: 0
    },

    durationDays: {
        type: Number,
        required: true
    },

    // Plan Limits
    maxOrganizations: {
        type: Number,
        required: true
    },
    maxVenues: {
        type: Number,
        required: true
    },
    maxDevices: {
        type: Number,
        required: true
    },

    isActive: {
        type: Boolean,
        default: true
    },

    isTrial: {
        type: Boolean,
        default: false
    },

    features: [{
        type: String
    }], // e.g., "real-time-monitoring", "advanced-scheduling", "alerts", "reports"

    recommended: {
        type: Boolean,
        default: false
    }

}, { 
    timestamps: true 
});

// Example: Free plan should be marked as trial
subscriptionPlanSchema.pre('save', function(next) {
    if (this.name === "free") {
        this.isTrial = true;
    }
    next();
});

const subscriptionPlanModel = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
module.exports = subscriptionPlanModel;