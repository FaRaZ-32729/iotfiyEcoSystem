// models/otaModel.js
const mongoose = require("mongoose");

const otaSchema = new mongoose.Schema({
    version: {
        type: String,
        required: true,
        trim: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String,
        required: true
    },
    storagePath: {
        type: String,
        required: true
    },
    deviceType: {
        type: String,
        enum: ["OD", "THD", "AQID", "SMD", "GLD", "ED"],
        required: true
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    fileSize: Number
}, { timestamps: true });

otaSchema.index({ version: 1, deviceType: 1 }, { unique: true });

module.exports = mongoose.model("OTA", otaSchema);