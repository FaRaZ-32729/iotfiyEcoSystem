const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const { createTriggerSchedule, getTriggerEventsByDeviceID, toggleTriggerEventStatus, deleteTriggerEvent } = require("../controllers/triggerEventController");

const managerGate = [authenticate, requireManagerSubscription];

router.post("/create-event", ...managerGate, createTriggerSchedule);
router.get("/events/:deviceId", ...managerGate, getTriggerEventsByDeviceID);
router.patch("/:id/status", ...managerGate, toggleTriggerEventStatus);
router.delete("/delete/:id", ...managerGate, deleteTriggerEvent);

module.exports = router;
