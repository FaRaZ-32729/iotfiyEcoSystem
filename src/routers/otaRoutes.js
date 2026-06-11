// routes/otaRoutes.js
const express = require("express");
const multer = require("multer");
const { uploadOTAFile, deleteOTA, getOTAVersionsByDeviceType, startOTA, getOTADownloadUrl } = require("../controllers/otaController");
const authenticate = require("../middlewares/auth");

const router = express.Router();

// Multer setup for file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

router.post("/upload", authenticate, upload.single('file'), uploadOTAFile);
router.post("/start", authenticate, startOTA);
router.get("/versions/:deviceType", authenticate, getOTAVersionsByDeviceType);
// only for esp32 to download the .bin file not for Frontend namuna developer
router.get("/download/:otaId", getOTADownloadUrl);
router.delete("/delete/:id", authenticate, deleteOTA);

module.exports = router;