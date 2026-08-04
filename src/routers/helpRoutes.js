const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const { helpChat, helpChatStream } = require("../controllers/helpController");

router.post("/chat", authenticate, helpChat);
router.post("/chat/stream", authenticate, helpChatStream);

module.exports = router;
