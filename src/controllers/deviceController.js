// src/modules/devices/device.controller.js
const Device = require("../models/deviceModel");
const Venue = require("../models/venueModel");
const checkSubscriptionLimit = require("../middlewares/subscriptionLimit");
const { createDeviceSchema, updateDeviceSchema, alertAccess } = require("../validations/deviceValidation");
const { publishCommand } = require("../mqtt/commandPublisher");
const Organization = require("../models/organizationModel");

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

        // Auto generate Device ID & API Key
        const deviceId = await generateDeviceId();
        const apiKey = generateApiKey(deviceId);

        // ==================== ALERT ACCESS CONFIG (FLAT FIELDS) ====================
        let alertAccessConfig = {};

        if (validatedData.category === "trigger") {
            // Default: All false
            alertAccessConfig = {
                tempAlertAccess: false,
                humiAlertAccess: false,
                odourAlertAccess: false,
                aqiAlertAccess: false,
                smokeAlertAccess: false,
                glAlertAccess: false,
                voltageAlertAccess: false,
                currentAlertAccess: false,
            };

            // Flat fields ko directly pick karo
            if (typeof validatedData.tempAlertAccess === "boolean") {
                alertAccessConfig.tempAlertAccess = validatedData.tempAlertAccess;
            }
            if (typeof validatedData.humiAlertAccess === "boolean") {
                alertAccessConfig.humiAlertAccess = validatedData.humiAlertAccess;
            }
            if (typeof validatedData.odourAlertAccess === "boolean") {
                alertAccessConfig.odourAlertAccess = validatedData.odourAlertAccess;
            }
            if (typeof validatedData.aqiAlertAccess === "boolean") {
                alertAccessConfig.aqiAlertAccess = validatedData.aqiAlertAccess;
            }
            if (typeof validatedData.smokeAlertAccess === "boolean") {
                alertAccessConfig.smokeAlertAccess = validatedData.smokeAlertAccess;
            }
            if (typeof validatedData.glAlertAccess === "boolean") {
                alertAccessConfig.glAlertAccess = validatedData.glAlertAccess;
            }
            if (typeof validatedData.voltageAlertAccess === "boolean") {
                alertAccessConfig.voltageAlertAccess = validatedData.voltageAlertAccess;
            }
            if (typeof validatedData.currentAlertAccess === "boolean") {
                alertAccessConfig.currentAlertAccess = validatedData.currentAlertAccess;
            }

            // Device Type wise unnecessary fields ko false kar do
            const dt = validatedData.deviceType;
            if (dt === "OD") {
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            } else if (dt === "THD") {
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            } else if (dt === "AQID") {
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            } else if (dt === "SMD") {
                alertAccessConfig.tempAlertAccess = false;
                alertAccessConfig.humiAlertAccess = false;
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            } else if (dt === "WLD") {
                alertAccessConfig.tempAlertAccess = false;
                alertAccessConfig.humiAlertAccess = false;
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            } else if (dt === "GLD") {
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            } else if (dt === "ED") {
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
            } else if (dt === "AC") {
                alertAccessConfig.odourAlertAccess = false;
                alertAccessConfig.aqiAlertAccess = false;
                alertAccessConfig.smokeAlertAccess = false;
                alertAccessConfig.glAlertAccess = false;
                alertAccessConfig.voltageAlertAccess = false;
                alertAccessConfig.currentAlertAccess = false;
            }
        }

        // AC / WLD — no threshold conditions
        const isAc = validatedData.deviceType === "AC";
        const isWld = validatedData.deviceType === "WLD";

        let acBrand = null;
        if (isAc) {
            const { getBrandByName } = require("../services/ackitBrandService");
            acBrand = await getBrandByName(validatedData.brandName);
            if (!acBrand) {
                return res.status(400).json({
                    success: false,
                    message: "Selected AC brand not found on Ackit",
                });
            }
        }

        const acDefaults = isAc
            ? {
                conditions: [],
                brandName: String(acBrand.brandName).toLowerCase(),
                setTemperature: 26,
                acMode: "Cool",
                fanSpeed: "Low",
                acLocked: false,
                acHealthAlert: false,
                energyMonitoringIncluded: validatedData.energyMonitoringIncluded === true,
            }
            : {};

        // Create Device
        const device = await Device.create({
            deviceId,
            deviceName: validatedData.deviceName,
            deviceType: validatedData.deviceType,
            category: validatedData.category,
            venue: validatedData.venueId,
            conditions: isAc || isWld ? [] : validatedData.conditions,
            apiKey,
            ...alertAccessConfig,
            ...acDefaults
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
                apiKey: device.apiKey,
                tempAlertAccess: device.tempAlertAccess,
                humiAlertAccess: device.humiAlertAccess,
                odourAlertAccess: device.odourAlertAccess,
                aqiAlertAccess: device.aqiAlertAccess,
                smokeAlertAccess: device.smokeAlertAccess,
                glAlertAccess: device.glAlertAccess,
                voltageAlertAccess: device.voltageAlertAccess,
                currentAlertAccess: device.currentAlertAccess,
                ...(isAc && {
                    brandName: device.brandName,
                    setTemperature: device.setTemperature,
                    acMode: device.acMode,
                    fanSpeed: device.fanSpeed,
                    acLocked: device.acLocked,
                    acHealthAlert: device.acHealthAlert,
                    energyMonitoringIncluded: device.energyMonitoringIncluded,
                }),
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

// const createDevice = async (req, res) => {
//     try {
//         // Validate with Zod
//         const validatedData = createDeviceSchema.parse(req.body);

//         // Check venue exists
//         const venue = await Venue.findById(validatedData.venueId);
//         if (!venue) {
//             return res.status(404).json({ success: false, message: "Venue not found" });
//         }

//         // Subscription limit check for non-admins
//         if (req.user.role !== "admin") {
//             await checkSubscriptionLimit("device")(req, res, () => { });
//             if (res.headersSent) return;
//         }

//         // Check duplicate deviceName in same venue
//         const existingName = await Device.findOne({
//             deviceName: { $regex: new RegExp(`^${validatedData.deviceName}$`, 'i') },
//             venue: validatedData.venueId
//         });
//         if (existingName) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Device name already exists in this venue"
//             });
//         }

//         // Auto generate Device ID
//         const deviceId = await generateDeviceId();

//         // Generate API Key
//         const apiKey = generateApiKey(deviceId);

//         // Create Device
//         const device = await Device.create({
//             deviceId,
//             deviceName: validatedData.deviceName,
//             deviceType: validatedData.deviceType,
//             category: validatedData.category,
//             venue: validatedData.venueId,
//             conditions: validatedData.conditions,
//             apiKey
//         });

//         res.status(201).json({
//             success: true,
//             message: "Device created successfully",
//             device: {
//                 id: device._id,
//                 deviceId: device.deviceId,
//                 deviceName: device.deviceName,
//                 deviceType: device.deviceType,
//                 category: device.category,
//                 apiKey: device.apiKey
//             }
//         });

//     } catch (error) {
//         if (error.name === "ZodError") {
//             return res.status(400).json({
//                 success: false,
//                 message: "Validation failed",
//                 errors: error.issues.map(err => ({
//                     field: err.path[0],
//                     message: err.message
//                 }))
//             });
//         }

//         console.error("Create Device Error:", error);
//         res.status(500).json({
//             success: false,
//             message: "Server error while creating device"
//         });
//     }
// };

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

        // const device = await Device.findById(id).populate("venue", "name");
        const device = await Device.findById(id).populate({
            path: "venue",
            select: "name organization",
            populate: {
                path: "organization",
                select: "name" // add other fields you need
            }
        });

        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        return res.status(200).json({ success: true, device });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== GET ALL DEVICES BY VERSION ====================
const getDevicesByVersion = async (req, res) => {
    try {
        const { version } = req.params;

        if (!version) {
            return res.status(400).json({
                success: false,
                message: "Version is required"
            });
        }

        const devices = await Device.find({
            version: version
        }).select("deviceId deviceName deviceType category status state version lastSeen venue")
            .populate("venue", "name");

        if (devices.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No devices found with firmware version "${version}"`
            });
        }

        return res.status(200).json({
            success: true,
            version: version,
            totalDevices: devices.length,
            devices: devices
        });

    } catch (error) {
        console.error("Get Devices By Version Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching devices"
        });
    }
};

// ==================== GET MY DEVICES (Role-wise) ====================
const getMyDevices = async (req, res) => {
    try {
        const user = req.user;
        let devices = [];

        if (user.role === "admin") {
            devices = await Device.find()
                .populate("venue", "name")
                .populate({
                    path: "venue",
                    populate: { path: "organization", select: "name" }
                })
                .select("deviceId deviceName deviceType category status state firmwareVersion lastSeen venue");

        }
        else if (user.role === "manager") {
            const organizations = await Organization.find({
                owner: user._id
            }).select("_id");

            const organizationIds = organizations.map(org => org._id);

            if (organizationIds.length === 0) {
                return res.status(200).json({
                    success: true,
                    role: "manager",
                    total: 0,
                    message: "No organizations found for this manager",
                });
            }

            devices = await Device.find({
                venue: {
                    $in: await Venue.find({
                        organization: { $in: organizationIds }
                    }).select("_id")
                }
            })
                .populate("venue", "name")
                .populate({
                    path: "venue",
                    populate: {
                        path: "organization",
                        select: "name owner"
                    }
                })
                .select("deviceId deviceName deviceType category status state firmwareVersion lastSeen venue");
        }
        else if (user.role === "user") {
            if (!user.venues || user.venues.length === 0) {
                return res.status(200).json({
                    success: true,
                    role: "user",
                    total: 0,
                    message: "No venues assigned to you",
                });
            }

            const venueIds = user.venues.map(v => v.venueId);

            devices = await Device.find({
                venue: { $in: venueIds }
            })
                .populate("venue", "name")
                .populate({
                    path: "venue",
                    populate: { path: "organization", select: "name" }
                })
                .select("deviceId deviceName deviceType category status state firmwareVersion lastSeen venue");
        }

        return res.status(200).json({
            success: true,
            role: user.role,
            total: devices.length,
            devices: devices
        });

    } catch (error) {
        console.error("Get My Devices Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching devices"
        });
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

        // Permission Check (as it is rakha hai)
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

        // ==================== ALERT ACCESS UPDATE (Only for Trigger) ====================
        if (validatedData.category === "trigger" || device.category === "trigger") {
            // Update alert access fields if provided
            if (typeof validatedData.tempAlertAccess === "boolean") {
                device.tempAlertAccess = validatedData.tempAlertAccess;
            }
            if (typeof validatedData.humiAlertAccess === "boolean") {
                device.humiAlertAccess = validatedData.humiAlertAccess;
            }
            if (typeof validatedData.odourAlertAccess === "boolean") {
                device.odourAlertAccess = validatedData.odourAlertAccess;
            }
            if (typeof validatedData.aqiAlertAccess === "boolean") {
                device.aqiAlertAccess = validatedData.aqiAlertAccess;
            }
            if (typeof validatedData.smokeAlertAccess === "boolean") {
                device.smokeAlertAccess = validatedData.smokeAlertAccess;
            }
            if (typeof validatedData.glAlertAccess === "boolean") {
                device.glAlertAccess = validatedData.glAlertAccess;
            }
            if (typeof validatedData.voltageAlertAccess === "boolean") {
                device.voltageAlertAccess = validatedData.voltageAlertAccess;
            }
            if (typeof validatedData.currentAlertAccess === "boolean") {
                device.currentAlertAccess = validatedData.currentAlertAccess;
            }
        }

        // Update fields (as it is)
        if (validatedData.deviceName) device.deviceName = validatedData.deviceName;
        if (validatedData.deviceType) device.deviceType = validatedData.deviceType;
        if (validatedData.category) device.category = validatedData.category;
        if (validatedData.venueId) device.venue = validatedData.venueId;
        if (validatedData.conditions) device.conditions = validatedData.conditions;
        if (validatedData.interval !== undefined) device.interval = validatedData.interval;
        if (typeof validatedData.energyMonitoringIncluded === "boolean") {
            device.energyMonitoringIncluded = validatedData.energyMonitoringIncluded;
        }

        const nextType = validatedData.deviceType || device.deviceType;

        // AC brand (Ackit name only)
        if (nextType === "AC") {
            if (validatedData.brandName) {
                const { getBrandByName } = require("../services/ackitBrandService");
                const acBrand = await getBrandByName(validatedData.brandName);
                if (!acBrand) {
                    return res.status(400).json({
                        success: false,
                        message: "Selected AC brand not found on Ackit",
                    });
                }
                device.brandName = String(acBrand.brandName).toLowerCase();
            } else if (!device.brandName) {
                return res.status(400).json({
                    success: false,
                    message: "brandName is required for AC devices",
                });
            }
            device.conditions = [];
        } else if (nextType === "WLD") {
            device.conditions = [];
            if (validatedData.category && validatedData.category !== "monitoring") {
                return res.status(400).json({
                    success: false,
                    message: "Water Leakage Device (WLD) supports monitoring category only",
                });
            }
            device.category = "monitoring";
        } else if (validatedData.deviceType && validatedData.deviceType !== "AC") {
            device.brandName = null;
        }

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
                message: "Validation failed",
                errors: error.issues.map(err => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
        }
        console.error(error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
// const updateDevice = async (req, res) => {
//     try {
//         const { id } = req.params;
//         const validatedData = updateDeviceSchema.parse(req.body);
//         const user = req.user;

//         const device = await Device.findById(id);
//         if (!device) {
//             return res.status(404).json({ success: false, message: "Device not found" });
//         }

//         // Permission Check
//         // const venue = await Venue.findById(device.venue);
//         // const org = await Organization.findById(venue.organization);

//         // if (user.role !== "admin" && org.owner.toString() !== user._id.toString()) {
//         //     return res.status(403).json({
//         //         success: false,
//         //         message: "You don't have permission to update this device"
//         //     });
//         // }

//         // If changing venue
//         if (validatedData.venueId && validatedData.venueId !== device.venue.toString()) {
//             const newVenue = await Venue.findById(validatedData.venueId);
//             if (!newVenue) {
//                 return res.status(404).json({ success: false, message: "New venue not found" });
//             }

//             const newOrg = await Organization.findById(newVenue.organization);
//             if (user.role !== "admin" && newOrg.owner.toString() !== user._id.toString()) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "You don't have access to the new venue's organization"
//                 });
//             }
//         }

//         // Update fields
//         if (validatedData.deviceName) device.deviceName = validatedData.deviceName;
//         if (validatedData.deviceType) device.deviceType = validatedData.deviceType;
//         if (validatedData.category) device.category = validatedData.category;
//         if (validatedData.venueId) device.venue = validatedData.venueId;
//         if (validatedData.conditions) device.conditions = validatedData.conditions;

//         await device.save();

//         return res.status(200).json({
//             success: true,
//             message: "Device updated successfully",
//             device
//         });

//     } catch (error) {
//         if (error.name === "ZodError") {
//             return res.status(400).json({
//                 success: false,
//                 errors: error.issues
//             });
//         }
//         console.error(error);
//         return res.status(500).json({ success: false, message: "Server error" });
//     }
// };

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

const manualButtonForTriggerDevice = async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { state } = req.body;   // "ON" or "OFF"

        if (!["ON", "OFF"].includes(state)) {
            return res.status(400).json({
                success: false,
                message: "State must be either 'ON' or 'OFF'"
            });
        }

        const device = await Device.findOne({ deviceId });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found"
            });
        }

        if (device.category !== "trigger") {
            return res.status(403).json({
                success: false,
                message: "This API is only for Trigger devices"
            });
        }

        // ==================== OFFLINE CHECK ====================
        if (device.status === "offline") {
            return res.status(200).json({
                success: true,
                message: `Device is currently OFFLINE. `,
            });
        }

        // Update state and manualButton
        const newManualButton = state === "ON";

        device.state = state;
        device.manualButton = newManualButton;
        device.lastUpdateTime = new Date();

        await device.save();

        // Publish command to ESP32
        const success = publishCommand(deviceId, {
            type: "COMMAND",
            command: state,
            manualControl: true,
            timestamp: new Date().toISOString()
        });

        if (success) {
            console.log(`🔧 Manual ${state} command sent to Trigger Device: ${device.deviceName}`);
        } else {
            console.warn(`⚠️ Failed to send manual command to ${deviceId}`);
        }

        // Send real-time update to frontend
        if (global.io) {
            global.io.emit(`device/${deviceId}`, {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                category: "trigger",
                state: device.state,
                manualButton: device.manualButton,
                timestamp: new Date()
            });
        }

        return res.status(200).json({
            success: true,
            message: `Device successfully set to ${state}`,
            device: {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                state: device.state,
                manualButton: device.manualButton
            }
        });

    } catch (error) {
        console.error("Manual Trigger Control Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while updating device state"
        });
    }
};

const VALID_AC_MODES = ["Cool", "Heat", "Dry", "FanOnly", "Auto"];
const VALID_FAN_SPEEDS = ["Low", "Medium", "High", "Ultra", "Turbo"];

/**
 * PUT /device/ac-settings/:deviceId
 * Partial update: setTemperature, acMode, fanSpeed, acLocked
 * Always: DB save → MQTT command → socket emit
 */
const updateAcSettings = async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { setTemperature, acMode, fanSpeed, acLocked } = req.body;

        const device = await Device.findOne({ deviceId });
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        if (device.deviceType !== "AC") {
            return res.status(403).json({
                success: false,
                message: "This API is only for AC devices",
            });
        }

        if (device.status !== "online") {
            return res.status(400).json({
                success: false,
                message: "Device is offline. Cannot update AC settings.",
            });
        }

        const { emitAcDeviceLive } = require("../services/acScheduleHelper");
        const { publishAcSettingsChanges } = require("../mqtt/acKitCommandPublisher");

        const changes = {};
        let changed = false;

        if (setTemperature !== undefined) {
            const temp = Number(setTemperature);
            if (!Number.isFinite(temp) || temp < 16 || temp > 30) {
                return res.status(400).json({
                    success: false,
                    message: "setTemperature must be a number between 16 and 30",
                });
            }
            device.setTemperature = temp;
            changes.setTemperature = temp;
            changed = true;
        }

        if (acMode !== undefined) {
            const mode = String(acMode).trim();
            if (!VALID_AC_MODES.includes(mode)) {
                return res.status(400).json({
                    success: false,
                    message: `acMode must be one of: ${VALID_AC_MODES.join(", ")}`,
                });
            }
            device.acMode = mode;
            changes.acMode = mode;
            changed = true;
        }

        if (fanSpeed !== undefined) {
            const speed = String(fanSpeed).trim();
            if (!VALID_FAN_SPEEDS.includes(speed)) {
                return res.status(400).json({
                    success: false,
                    message: `fanSpeed must be one of: ${VALID_FAN_SPEEDS.join(", ")}`,
                });
            }
            device.fanSpeed = speed;
            changes.fanSpeed = speed;
            changed = true;
        }

        if (typeof acLocked === "boolean") {
            device.acLocked = acLocked;
            changes.acLocked = acLocked;
            changed = true;
        }

        if (!changed) {
            return res.status(400).json({
                success: false,
                message: "Provide at least one of: setTemperature, acMode, fanSpeed, acLocked",
            });
        }

        device.lastUpdateTime = new Date();
        await device.save();

        // Ackit brand API → IR pulse → MQTT (no ESP flash pack required)
        const mqttResult = await publishAcSettingsChanges(deviceId, changes, device);
        if (!mqttResult.ok) {
            return res.status(mqttResult.status || 500).json({
                success: false,
                message: mqttResult.message || "Settings saved but failed to publish MQTT command",
                device: {
                    deviceId: device.deviceId,
                    setTemperature: device.setTemperature,
                    acMode: device.acMode,
                    fanSpeed: device.fanSpeed,
                    acLocked: device.acLocked,
                    state: device.state,
                },
            });
        }

        emitAcDeviceLive(device);

        return res.status(200).json({
            success: true,
            message: "AC settings updated",
            device: {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                state: device.state,
                brandName: device.brandName,
                setTemperature: device.setTemperature,
                acMode: device.acMode,
                fanSpeed: device.fanSpeed,
                acLocked: device.acLocked,
                acHealthAlert: device.acHealthAlert,
                energyMonitoringIncluded: device.energyMonitoringIncluded,
            },
        });
    } catch (error) {
        console.error("Update AC Settings Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while updating AC settings",
        });
    }
};

/** GET /device/ac-brands — names from Ackit DB only */
const getAcBrandOptions = async (_req, res) => {
    try {
        const { listBrandOptions } = require("../services/ackitBrandService");
        const brands = await listBrandOptions();
        return res.status(200).json({
            success: true,
            count: brands.length,
            brands,
        });
    } catch (error) {
        console.error("Get AC Brand Options Error:", error);
        return res.status(503).json({
            success: false,
            message: error.message || "Failed to load AC brands from Ackit",
        });
    }
};

module.exports = {
    createDevice,
    getAllDevices,
    getDevicesByVenue,
    getSingleDevice,
    updateDevice,
    deleteDevice,
    manualButtonForTriggerDevice,
    getDevicesByVersion,
    getMyDevices,
    updateAcSettings,
    getAcBrandOptions,
};