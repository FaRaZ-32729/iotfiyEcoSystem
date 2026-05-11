// models/subscriptionModel.js
const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    plan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubscriptionPlan",
        required: true
    },

    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: {
        type: Date,
        required: true
    },

    status: {
        type: String,
        enum: ["active", "expired", "cancelled", "trial"],
        default: "active"
    },

    isTrial: {
        type: Boolean,
        default: false
    },

    paymentInfo: {
        transactionId: String,
        paymentMethod: String,
        amountPaid: Number
    }

}, { 
    timestamps: true 
});

// Auto update status when expired
subscriptionSchema.pre('save', function (next) {
    if (this.endDate < new Date() && this.status === "active") {
        this.status = "expired";
    }
    next();
});

module.exports = mongoose.model("Subscription", subscriptionSchema);