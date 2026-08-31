const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const checkManagePermission = require("../middlewares/checkPermission");
const { createSchedule, manualToggle, getEventsByDevice, getCurrentOrNextScheduleForDevice, toggleScheduleStatus, deleteSchedule } = require("../controllers/eventController");

const managerGate = [authenticate, requireManagerSubscription];

router.post("/create", ...managerGate, checkManagePermission(), createSchedule);
router.post("/manual-toggle", ...managerGate, manualToggle);
router.get("/get/:deviceId", ...managerGate, getEventsByDevice);
router.get("/current-next/:deviceId", ...managerGate, getCurrentOrNextScheduleForDevice);
router.patch("/:id/status", ...managerGate, toggleScheduleStatus);
router.delete("/delete/:id", ...managerGate, deleteSchedule);

module.exports = router;
