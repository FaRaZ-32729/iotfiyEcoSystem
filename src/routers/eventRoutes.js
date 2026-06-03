// src/routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const checkManagePermission = require("../middlewares/checkPermission");
const { createSchedule, manualToggle } = require("../controllers/eventController");


router.post("/create", authenticate, checkManagePermission(), createSchedule);

// for manual toggle you must have to give deviceId not _id
router.post("/manual-toggle", authenticate, manualToggle);

module.exports = router;