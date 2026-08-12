const express = require("express");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const { createVenue, getAllVenues, getSingleVenue, getVenuesByOrganization, updateVenue, deleteVenue } = require("../controllers/venueController");
const checkManagePermission = require("../middlewares/checkPermission");
const router = express.Router();

const managerGate = [authenticate, requireManagerSubscription];

router.post("/create", ...managerGate, checkManagePermission(), createVenue);
router.get("/all", ...managerGate, getAllVenues);
router.get("/single/:id", ...managerGate, getSingleVenue);
router.get("/get-by-org/:organizationId", ...managerGate, getVenuesByOrganization);
router.put("/update/:id", ...managerGate, updateVenue);
router.delete("/delete-venue/:id", ...managerGate, deleteVenue);

module.exports = router;
