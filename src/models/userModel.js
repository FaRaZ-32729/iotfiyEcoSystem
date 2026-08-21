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
        required: false   // Will be set later if created by admin
    },

    role: {
        type: String,
        enum: ["admin", "manager", "user"],
        default: "manager"
    },

    // ==================== CREATION METHOD ====================
    createdBy: {
        type: String,
        enum: ["self", "admin", "manager"],
        default: "self"
    },

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
    suspensionReason: {
        type: String,
        default: null
    },
    permission: {
        type: String,
        default: null
    },

    // ==================== AUTH TOKENS ====================
    otp: String,
    otpExpiry: Date,
    setupToken: String,
    resetToken: String,
    resetTokenExpiry: Date,
    lastLogin: Date,

    // ==================== QR LOGIN (sub-users / role=user ONLY) ====================
    // Managers/admins must NOT get a unique null token — that caused E11000 on signup.
    // No default: field omitted unless createSubUser sets a real string.
    qrLoginToken: {
        type: String,
    },
    qrLoginEnabled: {
        type: Boolean,
        default: true,
    },
    qrLoginRotatedAt: {
        type: Date,
        default: null,
    },

    tempEmail: {
        type: String,
        lowercase: true,
        trim: true,
        default: null
    },
    emailChangeOtp: String,
    emailChangeOtpExpiry: Date,

}, {
    timestamps: true
});

// Indexes
userSchema.index({ role: 1 });
userSchema.index({ createdBy: 1 });
userSchema.index({ creatorId: 1 });
// Unique only when a real QR token string exists (sub-users). Multiple missing/null OK.
userSchema.index(
    { qrLoginToken: 1 },
    {
        unique: true,
        name: "qrLoginToken_partial_unique",
        partialFilterExpression: {
            qrLoginToken: { $exists: true, $type: "string", $gt: "" },
        },
    }
);

/**
 * One-time-safe repair for production: old unique index on qrLoginToken blocked
 * manager signup (many docs with null). Call after mongoose.connect.
 */
async function ensureQrLoginTokenIndex() {
    const col = userModel.collection;
    try {
        const indexes = await col.indexes();
        const bad = indexes.find(
            (idx) =>
                idx.name === "qrLoginToken_1" ||
                (idx.key && idx.key.qrLoginToken === 1 && !idx.partialFilterExpression)
        );
        if (bad) {
            await col.dropIndex(bad.name);
            console.log(`[User] Dropped legacy index ${bad.name} (blocked manager signup)`);
        }
    } catch (err) {
        if (err?.code !== 27 && err?.codeName !== "IndexNotFound") {
            console.warn("[User] qrLoginToken index drop:", err.message);
        }
    }

    // Managers/admins: remove explicit null so field is absent
    const unsetResult = await userModel.updateMany(
        {
            $or: [
                { qrLoginToken: null },
                { qrLoginToken: "" },
            ],
        },
        { $unset: { qrLoginToken: 1 } }
    );
    if (unsetResult.modifiedCount > 0) {
        console.log(
            `[User] Cleared empty qrLoginToken on ${unsetResult.modifiedCount} account(s)`
        );
    }

    await userModel.syncIndexes();
}

const userModel = mongoose.model("User", userSchema);
userModel.ensureQrLoginTokenIndex = ensureQrLoginTokenIndex;
module.exports = userModel;