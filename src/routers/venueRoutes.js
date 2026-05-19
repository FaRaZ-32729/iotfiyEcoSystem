const express = require("express");
const authenticate = require("../middlewares/auth");
const { createVenue, getAllVenues, getSingleVenue, getVenuesByOrganization, updateVenue } = require("../controllers/venueController");
const router = express.Router();

router.post("/create", authenticate, createVenue);
router.get("/all", getAllVenues);
router.get("/single/:id", getSingleVenue);
router.get("/get-by-org/:organizationId", getVenuesByOrganization);
router.put("/update/:id", authenticate, updateVenue);

module.exports = router;