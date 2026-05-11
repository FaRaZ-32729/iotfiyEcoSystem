// models/userModel.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ["admin", "manager", "user"],
        default: "manager"           // Self-registered users start as manager
    },

    // Who created this user (for sub-users)
    creatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    // ==================== SUBSCRIPTION ====================
    currentSubscription: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subscription",
        default: null
    },

    // ==================== ORGANIZATIONS ====================
    organizations: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Organization"
    }],

    activeOrganization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Organization",
        default: null
    },

    // ==================== VENUES (for sub-users) ====================
    venues: [{
        venueId: { type: mongoose.Schema.Types.ObjectId, ref: "Venue" },
        venueName: String
    }],

    timer: {
        type: String,
        default: null
    },

    // ==================== ACCOUNT STATUS ====================
    isActive: { 
        type: Boolean, 
        default: false 
    },
    isVerified: { 
        type: Boolean, 
        default: false 
    },
    suspensionReason: String,

    // ==================== AUTH FIELDS ====================
    otp: String,
    otpExpiry: Date,
    setupToken: String,
    resetToken: String,
    resetTokenExpiry: Date,

    lastLogin: Date,

}, { 
    timestamps: true 
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ currentSubscription: 1 });


const userModel = mongoose.model("User", userSchema);

module.exports = userModel;