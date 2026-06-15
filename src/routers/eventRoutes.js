// src/routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const checkManagePermission = require("../middlewares/checkPermission");
const { createSchedule, manualToggle, getEventsByDevice, toggleScheduleStatus, deleteSchedule, getCurrentOrNextScheduleData } = require("../controllers/eventController");


router.post("/create", authenticate, checkManagePermission(), createSchedule);
// for manual toggle you must have to give deviceId not _id
router.post("/manual-toggle", authenticate, manualToggle);
// here you have to use deviceId to get events of a device 
router.get("/get/:deviceId", getEventsByDevice);
// currnet or next event
router.get("/current-next/:deviceId", authenticate, getCurrentOrNextSchedule);
// here you have to use _id of the event
router.patch("/:id/status", toggleScheduleStatus);
// here you have to use _id of the event
router.delete("/delete/:id", deleteSchedule);

module.exports = router;