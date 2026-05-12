const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema({
    name: {
        type: String,
        enum: ["free", "basic", "premium", "custom"],
        required: true,
        unique: true
    },
    description: {
        type: String,
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
    }
}, {
    timestamps: true
});

subscriptionPlanSchema.pre('save', async function () {
    if (this.name === "free") {
        this.isTrial = true;
    }
});

const subscriptionPlanModel = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
module.exports = subscriptionPlanModel;