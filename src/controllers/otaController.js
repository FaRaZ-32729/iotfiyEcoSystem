// controllers/otaController.js
const { bucket } = require("../config/firebaseAdmin");
const OTA = require("../models/otaModel");
const path = require("path");
const { publishCommand } = require("../mqtt/commandPublisher");
const Device = require("../models/deviceModel");
const { broadcastOTAProgress, setActiveSessions } = require("../services/otaProgressService");

const uploadOTAFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        const { version, deviceType, } = req.body;
        const user = req.user;

        if (!version || !deviceType) {
            return res.status(400).json({
                success: false,
                message: "version and deviceType are required"
            });
        }

        // Validate .bin file
        if (path.extname(req.file.originalname).toLowerCase() !== '.bin') {
            return res.status(400).json({
                success: false,
                message: "Only .bin files are allowed"
            });
        }

        // ==================== CHECK VERSION UNIQUENESS PER DEVICE TYPE ====================
        const existingOTA = await OTA.findOne({
            version: version,
            deviceType: deviceType
        });

        if (existingOTA) {
            return res.status(400).json({
                success: false,
                message: `Version "${version}" already exists for device type "${deviceType}". Please use a different version.`
            });
        }

        const fileName = `${Date.now()}-${req.file.originalname}`;
        const storagePath = `iotfiyecosystem/ota/${deviceType}/${fileName}`;

        // Upload to Firebase
        const file = bucket.file(storagePath);
        await file.save(req.file.buffer, {
            metadata: {
                contentType: req.file.mimetype,
            }
        });

        // Get public URL
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: '03-01-2500'
        });

        // Save to MongoDB
        const ota = await OTA.create({
            version,
            fileName: req.file.originalname,
            fileUrl: url,
            storagePath,
            deviceType,
            uploadedBy: user._id,
            fileSize: req.file.size
        });

        return res.status(201).json({
            success: true,
            message: "OTA file uploaded successfully",
            ota: {
                id: ota._id,
                version: ota.version,
                deviceType: ota.deviceType,
                fileUrl: ota.fileUrl,
                storagePath: ota.storagePath
            }
        });

    } catch (error) {
        console.error("OTA Upload Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to upload OTA file"
        });
    }
};

// Get All OTA Versions by Device Type (Newest First)
const getOTAVersionsByDeviceType = async (req, res) => {
    try {
        const { deviceType } = req.params;

        if (!deviceType) {
            return res.status(400).json({
                success: false,
                message: "deviceType is required"
            });
        }

        // Validate deviceType
        const validTypes = ["OD", "THD", "AQID", "GLD", "ED"];
        if (!validTypes.includes(deviceType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid deviceType. Allowed: OD, THD, AQID, GLD, ED"
            });
        }

        const otas = await OTA.find({ deviceType })
            .sort({ createdAt: -1 })
            .select('version fileName fileUrl storagePath deviceType isActive fileSize createdAt');
        // .populate('uploadedBy', 'name email')

        if (otas.length === 0) {
            return res.status(404).json({ message: "no version found" })
        }

        return res.status(200).json({
            success: true,
            deviceType,
            total: otas.length,
            otas
        });

    } catch (error) {
        console.error("Get OTA Versions Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching OTA versions"
        });
    }
};

// Delete OTA - MongoDB + Firebase Storage
const deleteOTA = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const ota = await OTA.findById(id);

        if (!ota) {
            return res.status(404).json({
                success: false,
                message: "OTA record not found"
            });
        }

        // Permission Check: Only Admin or the uploader can delete
        if (user.role !== "admin" && ota.uploadedBy.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to delete this OTA file"
            });
        }

        // ==================== DELETE FILE FROM FIREBASE STORAGE ====================
        try {
            const file = bucket.file(ota.storagePath);
            await file.delete();
            console.log(`✅ Firebase file deleted: ${ota.storagePath}`);
        } catch (firebaseErr) {
            console.warn(`⚠️ Firebase deletion warning (file may not exist): ${firebaseErr.message}`);
            // Continue - we still delete from MongoDB
        }

        // ==================== DELETE RECORD FROM MONGODB ====================
        await OTA.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: "OTA file deleted successfully from database and storage",
            deleted: {
                id: ota._id,
                version: ota.version,
                deviceType: ota.deviceType,
                fileName: ota.fileName,
                storagePath: ota.storagePath
            }
        });

    } catch (error) {
        console.error("Delete OTA Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while deleting OTA file"
        });
    }
};

const activeOTASessions = new Map(); // sessionId -> session data
setActiveSessions(activeOTASessions);

// const startOTA = async (req, res) => {
//     try {
//         const { otaId, deviceIds } = req.body;
//         const user = req.user;

//         if (!otaId || !Array.isArray(deviceIds) || deviceIds.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: "otaId and deviceIds array are required"
//             });
//         }

//         const ota = await OTA.findById(otaId);
//         if (!ota) {
//             return res.status(404).json({ success: false, message: "OTA version not found" });
//         }

//         // Get valid online devices of matching deviceType
//         const devices = await Device.find({
//             _id: { $in: deviceIds },
//             deviceType: ota.deviceType,
//             status: "online"
//         }).select("deviceId deviceName state");

//         if (devices.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: "No online devices found matching the OTA device type"
//             });
//         }

//         const sessionId = `ota-${otaId}-${Date.now()}`;

//         const sessionData = {
//             sessionId,
//             otaId: ota._id,
//             version: ota.version,
//             fileUrl: ota.fileUrl,
//             totalDevices: devices.length,
//             completed: 0,
//             failed: 0,
//             progressMap: new Map(), // deviceId -> percentage (0-100)
//             startedAt: new Date()
//         };

//         activeOTASessions.set(sessionId, sessionData);

//         console.log(`🚀 OTA Session Started: ${sessionId} | ${devices.length} devices`);

//         // Send OTA command to each device
//         for (const device of devices) {
//             sessionData.progressMap.set(device.deviceId, 0);

//             // publishCommand(device.deviceId, {
//             //     type: "OTA_START",
//             //     message: "hellow faraz",
//             //     version: ota.version,
//             //     // fileUrl: ota.fileUrl,
//             //     fileUrl: "https://google.comfaraz1234567",
//             //     fileSize: ota.fileSize,
//             //     sessionId: sessionId,
//             //     timestamp: new Date().toISOString()
//             // });
//             publishCommand(device.deviceId, {
//                 type: "OTA_START",
//                 otaId: ota._id.toString(),        // ← Send only ID
//                 version: ota.version,
//                 sessionId: sessionId,
//                 timestamp: new Date().toISOString()
//             });

//             // Initial progress broadcast
//             broadcastOTAProgress(sessionId, device.deviceId, 0);
//         }

//         return res.status(200).json({
//             success: true,
//             message: `OTA update started for ${devices.length} devices`,
//             sessionId,
//             totalDevices: devices.length,
//             devices: devices.map(d => ({
//                 deviceId: d.deviceId,
//                 deviceName: d.deviceName
//             }))
//         });

//     } catch (error) {
//         console.error("Start OTA Error:", error);
//         return res.status(500).json({ success: false, message: "Failed to start OTA" });
//     }
// };

// const getOTADownloadUrl = async (req, res) => {
//     console.log("hitting the download apis")
//     try {
//         const { otaId } = req.params;

//         const ota = await OTA.findById(otaId);
//         if (!ota) {
//             return res.status(404).json({ success: false, message: "OTA not found" });
//         }
//         if (ota.fileUrl) {
//             console.log(`🔄 Redirecting to file: ${ota.fileUrl}`);
//             return res.redirect(302, ota.fileUrl);
//         }

//         res.status(404).json({ success: false, message: "File URL not found" });

//     } catch (error) {
//         res.status(500).json({ success: false, message: "Server error" });
//     }
// };

const startOTA = async (req, res) => {
    try {
        const { otaId, deviceIds } = req.body;
        const user = req.user;

        if (!otaId || !Array.isArray(deviceIds) || deviceIds.length === 0) {
            return res.status(400).json({ success: false, message: "otaId and deviceIds array are required" });
        }

        const ota = await OTA.findById(otaId);
        if (!ota) {
            return res.status(404).json({ success: false, message: "OTA version not found" });
        }

        const devices = await Device.find({
            _id: { $in: deviceIds },
            deviceType: ota.deviceType,
            status: "online"
        }).select("deviceId deviceName state");

        if (devices.length === 0) {
            return res.status(400).json({ success: false, message: "No online devices found" });
        }

        const sessionId = `ota-${otaId}-${Date.now()}`;

        // Session Data with better tracking
        const sessionData = {
            sessionId,
            otaId: ota._id.toString(),
            version: ota.version,
            fileUrl: ota.fileUrl,
            totalDevices: devices.length,
            completed: 0,
            failed: 0,
            progressMap: new Map(),           // deviceId -> progress %
            statusMap: new Map(),             // deviceId -> "pending" | "downloading" | "completed" | "failed"
            startedAt: new Date()
        };

        // Initialize each device
        devices.forEach(device => {
            sessionData.progressMap.set(device.deviceId, 0);
            sessionData.statusMap.set(device.deviceId, "pending");
        });

        activeOTASessions.set(sessionId, sessionData);

        console.log(`🚀 OTA Session Started: ${sessionId} | ${devices.length} devices`);

        // Send command to each device
        for (const device of devices) {
            publishCommand(device.deviceId, {
                type: "OTA_START",
                otaId: ota._id.toString(),
                version: ota.version,
                sessionId: sessionId,
                timestamp: new Date().toISOString()
            });

            broadcastOTAProgress(sessionId, device.deviceId, 0, "pending");
        }

        return res.status(200).json({
            success: true,
            message: `OTA started for ${devices.length} devices`,
            sessionId,
            totalDevices: devices.length,
            devices: devices.map(d => ({
                deviceId: d.deviceId,
                deviceName: d.deviceName
            }))
        });

    } catch (error) {
        console.error("Start OTA Error:", error);
        return res.status(500).json({ success: false, message: "Failed to start OTA" });
    }
};

const getOTADownloadUrl = async (req, res) => {
    console.log("ota download api hitted");
    try {
        const { otaId } = req.params;

        const ota = await OTA.findById(otaId);
        if (!ota || !ota.storagePath) {
            return res.status(404).json({ success: false, message: "OTA file not found" });
        }

        console.log(`🔄 Proxying OTA file: ${ota.storagePath}`);

        const file = bucket.file(ota.storagePath);

        // Get Metadata (File Size)
        const [metadata] = await file.getMetadata();

        // Set Headers
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${ota.fileName}"`);
        res.setHeader('Content-Length', metadata.size);   // ← Yeh sahi se set ho raha hai

        console.log(`📦 File Size from Firebase: ${metadata.size} bytes`);

        const stream = file.createReadStream();

        stream.on('error', (error) => {
            console.error("Firebase Stream Error:", error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: "Download failed" });
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error("Proxy Download Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Server error" });
        }
    }
};


module.exports = { uploadOTAFile, deleteOTA, getOTAVersionsByDeviceType, startOTA, activeOTASessions, getOTADownloadUrl };