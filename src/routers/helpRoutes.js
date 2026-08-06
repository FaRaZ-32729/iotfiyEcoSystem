const express = require("express");
const multer = require("multer");
const authenticate = require("../middlewares/auth");
const {
    helpChat,
    helpChatStream,
    helpTranscribe,
    helpRealtimeSession,
    helpRealtimeTool,
    helpRealtimeFormatChat,
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

// Live speech-to-speech (WebRTC Realtime) — separate from text chat / STT mic
router.post("/realtime/session", authenticate, helpRealtimeSession);
router.post("/realtime/tool", authenticate, helpRealtimeTool);
router.post("/realtime/format-chat", authenticate, helpRealtimeFormatChat);

module.exports = router;
