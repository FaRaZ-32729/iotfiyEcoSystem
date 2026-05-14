const express = require("express");
const authenticate = require("../middlewares/auth");
const { createVenue } = require("../controllers/venueController");
const router = express.Router();

router.post("/create", authenticate, createVenue);

module.exports = router;