const express = require("express");
const multer = require("multer");
const authenticate = require("../middlewares/auth");
const {
    helpChat,
    helpChatStream,
    helpTranscribe,
} = require("../controllers/helpController");

const router = express.Router();

// Audio stays in RAM — short voice clips, no disk needed
const uploadAudio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

router.post("/chat", authenticate, helpChat);
router.post("/chat/stream", authenticate, helpChatStream);
router.post(
    "/transcribe",
    authenticate,
    uploadAudio.single("audio"),
    helpTranscribe
);

module.exports = router;
