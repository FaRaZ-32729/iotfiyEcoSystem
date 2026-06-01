// src/routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const checkManagePermission = require("../middlewares/checkPermission");
const { createSchedule } = require("../controllers/eventController");

router.post("/create", authenticate, checkManagePermission(), createSchedule);

module.exports = router;