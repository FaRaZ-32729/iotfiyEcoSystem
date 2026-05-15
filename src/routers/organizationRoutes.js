const express = require("express");
const { createOrganization, getAllOrganizations, getOrganizationsByOwner, getOrganizationById } = require("../controllers/organizationController");
const authenticate = require("../middlewares/auth");
const router = express.Router();

router.post("/create", authenticate, createOrganization);

router.get("/all", getAllOrganizations);
router.get("/owner/:ownerId", getOrganizationsByOwner);
router.get("/single/:id", getOrganizationById);

module.exports = router;