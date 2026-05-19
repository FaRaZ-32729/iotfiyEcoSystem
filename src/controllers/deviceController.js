// src/modules/devices/device.controller.js
const Device = require("../models/deviceModel");
const Venue = require("../models/venueModel");
const checkSubscriptionLimit = require("../middlewares/subscriptionLimit");
const { createDeviceSchema, updateDeviceSchema } = require("../validations/deviceValidation");

// Helper function to generate API Key
const generateApiKey = (deviceId) => {
    let rawString = deviceId;
    // conditions.forEach(cond => {
    //     rawString += `|${cond.type}${cond.operator}${cond.value}`;
    // });
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
        const apiKey = generateApiKey(deviceId);

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

// ==================== GET ALL DEVICES ====================
const getAllDevices = async (req, res) => {
    try {
        const devices = await Device.find()
            .populate("venue", "name")
            .sort({ createdAt: -1 });

        if (devices.length === 0) {
            return res.status(404).json({ message: "No devices found" })
        }
        return res.status(200).json({
            success: true,
            count: devices.length,
            devices
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== GET DEVICES BY VENUE ====================
const getDevicesByVenue = async (req, res) => {
    try {
        const { venueId } = req.params;

        const devices = await Device.find({ venue: venueId })
            .populate("venue", "name");
        if (devices.length === 0) {
            return res.status(404).json({ message: "No devices under this venue" });
        }

        return res.status(200).json({
            success: true,
            count: devices.length,
            devices
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== GET SINGLE DEVICE ====================
const getSingleDevice = async (req, res) => {
    try {
        const { id } = req.params;

        const device = await Device.findById(id).populate("venue", "name");

        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        return res.status(200).json({ success: true, device });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== UPDATE DEVICE ====================
const updateDevice = async (req, res) => {
    try {
        const { id } = req.params;
        const validatedData = updateDeviceSchema.parse(req.body);
        const user = req.user;

        const device = await Device.findById(id);
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        // Permission Check
        // const venue = await Venue.findById(device.venue);
        // const org = await Organization.findById(venue.organization);

        // if (user.role !== "admin" && org.owner.toString() !== user._id.toString()) {
        //     return res.status(403).json({
        //         success: false,
        //         message: "You don't have permission to update this device"
        //     });
        // }

        // If changing venue
        if (validatedData.venueId && validatedData.venueId !== device.venue.toString()) {
            const newVenue = await Venue.findById(validatedData.venueId);
            if (!newVenue) {
                return res.status(404).json({ success: false, message: "New venue not found" });
            }

            const newOrg = await Organization.findById(newVenue.organization);
            if (user.role !== "admin" && newOrg.owner.toString() !== user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "You don't have access to the new venue's organization"
                });
            }
        }

        // Update fields
        if (validatedData.deviceName) device.deviceName = validatedData.deviceName;
        if (validatedData.deviceType) device.deviceType = validatedData.deviceType;
        if (validatedData.category) device.category = validatedData.category;
        if (validatedData.venueId) device.venue = validatedData.venueId;
        if (validatedData.conditions) device.conditions = validatedData.conditions;

        await device.save();

        return res.status(200).json({
            success: true,
            message: "Device updated successfully",
            device
        });

    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                errors: error.issues
            });
        }
        console.error(error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== DELETE DEVICE ====================
const deleteDevice = async (req, res) => {
    try {
        const { id } = req.params;

        const device = await Device.findById(id);
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        await Device.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: "Device deleted successfully"
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = { createDevice, getAllDevices, getDevicesByVenue, getSingleDevice, updateDevice, deleteDevice };