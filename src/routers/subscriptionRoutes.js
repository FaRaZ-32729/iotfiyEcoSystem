const express = require("express");
const { getAllPlans, getPlanById, createSubscriptionPlan } = require("../controllers/subscriptionPlanController");
const {
    purchaseSubscription,
    renewSubscription,
    getMySubscription,
    getSubscriptionUsage,
} = require("../controllers/SubscriptionController");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const roleGuard = require("../middlewares/roleGuard");
const router = express.Router();

const managerOnly = [authenticate, roleGuard(["manager"])];
const managerGate = [...managerOnly, requireManagerSubscription];

// Public - View Plans
router.get("/get-all-plans", getAllPlans);
router.get("/get-plan/:id", getPlanById);

// Purchase: manager-only; no active-sub required (first-time + expired re-buy).
router.post("/purchase", ...managerOnly, purchaseSubscription);
router.post("/renew", ...managerGate, renewSubscription);
router.get("/my-subscription", ...managerGate, getMySubscription);
router.get("/usage", ...managerGate, getSubscriptionUsage);

// Admin catalog + manager custom-plan request from SelectPlan
router.post(
    "/create-plan",
    authenticate,
    roleGuard(["admin", "manager"]),
    createSubscriptionPlan
);

module.exports = router;
