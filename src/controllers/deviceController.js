// src/modules/devices/device.controller.js
const Device = require("../models/deviceModel");
const Venue = require("../models/venueModel");
const checkSubscriptionLimit = require("../middlewares/subscriptionLimit");
const { createDeviceSchema } = require("../validations/deviceValidation");

// Helper function to generate API Key
const generateApiKey = (deviceId, conditions) => {
    let rawString = deviceId;
    conditions.forEach(cond => {
        rawString += `|${cond.type}${cond.operator}${cond.value}`;
    });
    return Buffer.from(rawString).toString("base64");
};

// Helper to generate unique Device ID (e.g., DEV-20250515-001)
const generateDeviceId = async () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    while (true) {
        let deviceId = "";

        for (let i = 0; i < 6; i++) {
            deviceId += chars.charAt(
                Math.floor(Math.random() * chars.length)
            );
        }

        const existing = await Device.findOne({ deviceId });

        if (!existing) {
            return deviceId;
        }
    }
};

// Create Device
const createDevice = async (req, res) => {
    try {
        // Validate with Zod
        const validatedData = createDeviceSchema.parse(req.body);

        // Check venue exists
        const venue = await Venue.findById(validatedData.venueId);
        if (!venue) {
            return res.status(404).json({ success: false, message: "Venue not found" });
        }

        // Subscription limit check for non-admins
        if (req.user.role !== "admin") {
            await checkSubscriptionLimit("device")(req, res, () => { });
            if (res.headersSent) return;
        }

        // Check duplicate deviceName in same venue
        const existingName = await Device.findOne({
            deviceName: { $regex: new RegExp(`^${validatedData.deviceName}$`, 'i') },
            venue: validatedData.venueId
        });
        if (existingName) {
            return res.status(400).json({
                success: false,
                message: "Device name already exists in this venue"
            });
        }

        // Auto generate Device ID
        const deviceId = await generateDeviceId();

        // Generate API Key
        const apiKey = generateApiKey(deviceId, validatedData.conditions);

        // Create Device
        const device = await Device.create({
            deviceId,
            deviceName: validatedData.deviceName,
            deviceType: validatedData.deviceType,
            category: validatedData.category,
            venue: validatedData.venueId,
            conditions: validatedData.conditions,
            apiKey
        });

        res.status(201).json({
            success: true,
            message: "Device created successfully",
            device: {
                id: device._id,
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                category: device.category,
                apiKey: device.apiKey
            }
        });

    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.issues.map(err => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
        }

        console.error("Create Device Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while creating device"
        });
    }
};

module.exports = { createDevice };