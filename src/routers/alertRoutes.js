const express = require("express");
const authenticate = require("../middlewares/auth");
const { getAlertsByOrganization, getAlertsByVenue } = require("../controllers/alertController");
const router = express.Router();

router.get("/by-org/:organizationId", authenticate, getAlertsByOrganization);
router.get("/by-venue/:venueId", authenticate, getAlertsByVenue);

module.exports = router;