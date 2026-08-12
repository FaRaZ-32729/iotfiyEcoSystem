// models/organizationModel.js
const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
    name: {
        type: String,
        trim: true,
        required: true,
    },

    // Current owner/manager
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

}, {
    timestamps: true
});

// Same name is allowed for different managers; unique only per owner.
organizationSchema.index({ owner: 1, name: 1 }, { unique: true });

const Organization = mongoose.model("Organization", organizationSchema);

// Drop leftover global unique-on-name index from older schema.
Organization.collection.dropIndex("name_1").catch(() => {});

module.exports = Organization;
