// routes/triggerScheduleRoutes.js
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const { createTriggerSchedule, getTriggerEventsByDeviceID, toggleTriggerEventStatus, deleteTriggerEvent } = require("../controllers/triggerEventController");

// Create Trigger Schedule
router.post("/create-event", authenticate, createTriggerSchedule);

// Get by Device ID
router.get("/events/:deviceId", authenticate, getTriggerEventsByDeviceID);

// Toggle Status
router.patch("/:id/status", authenticate, toggleTriggerEventStatus);

// Delete
router.delete("/delete/:id", authenticate, deleteTriggerEvent);

module.exports = router;