const express = require("express");
const { createOrganization } = require("../controllers/organizationController");
const authenticate = require("../middlewares/auth");
const router = express.Router();

router.post("/create", authenticate, createOrganization);

module.exports = router;