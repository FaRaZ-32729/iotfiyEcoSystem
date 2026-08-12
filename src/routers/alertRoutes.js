const express = require("express");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const { getAlertsByOrganization, getAlertsByVenue } = require("../controllers/alertController");
const router = express.Router();

const managerGate = [authenticate, requireManagerSubscription];

router.get("/by-org/:organizationId", ...managerGate, getAlertsByOrganization);
router.get("/by-venue/:venueId", ...managerGate, getAlertsByVenue);

module.exports = router;
