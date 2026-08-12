const express = require("express");
const { createOrganization, getAllOrganizations, getOrganizationsByOwner, getOrganizationById, getUserOrganizations, updateOrganization, deleteOrganization } = require("../controllers/organizationController");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const router = express.Router();

const managerGate = [authenticate, requireManagerSubscription];

router.post("/create", ...managerGate, createOrganization);
router.get("/all", ...managerGate, getAllOrganizations);
router.get("/owner/:ownerId", ...managerGate, getOrganizationsByOwner);
router.get("/single/:id", ...managerGate, getOrganizationById);
router.get("/my-organizations", ...managerGate, getUserOrganizations);
router.put("/update/:id", ...managerGate, updateOrganization);
router.delete("/delete-org/:id", ...managerGate, deleteOrganization);

module.exports = router;
