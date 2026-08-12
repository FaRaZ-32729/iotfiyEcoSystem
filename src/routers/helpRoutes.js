const express = require("express");
const multer = require("multer");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const {
    helpChat,
    helpChatStream,
    helpTranscribe,
    helpRealtimeSession,
    helpRealtimeTool,
    helpRealtimeFormatChat,
} = require("../controllers/helpController");

const router = express.Router();
const managerGate = [authenticate, requireManagerSubscription];

const uploadAudio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
});

router.post("/chat", ...managerGate, helpChat);
router.post("/chat/stream", ...managerGate, helpChatStream);
router.post(
    "/transcribe",
    ...managerGate,
    uploadAudio.single("audio"),
    helpTranscribe
);

router.post("/realtime/session", ...managerGate, helpRealtimeSession);
router.post("/realtime/tool", ...managerGate, helpRealtimeTool);
router.post("/realtime/format-chat", ...managerGate, helpRealtimeFormatChat);

module.exports = router;
