// models/organizationModel.js
const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },

    // Current owner/manager
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Subscription reference (optional, for tracking)
    subscription: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subscription"
    }

}, { 
    timestamps: true 
});

// Index for faster search
organizationSchema.index({ name: 1 });
organizationSchema.index({ owner: 1 });

module.exports = mongoose.model("Organization", organizationSchema);