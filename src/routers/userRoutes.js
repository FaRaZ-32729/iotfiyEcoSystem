const express = require("express");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const roleGuard = require("../middlewares/roleGuard");
const { suspendManager, getAllUsers, getAllManagers, getUsersByManager, getSingleUser, deleteUser, deleteManager, updateManagerCreatedUser, requestEmailChange, verifyEmailChange, getSubUserQrLogin, regenerateSubUserQrLogin } = require("../controllers/userController");
const router = express.Router();

const managerGate = [authenticate, requireManagerSubscription];

router.put(
    "/suspend/:managerId",
    authenticate,
    roleGuard(["admin"]),
    suspendManager
);

router.put("/update-user/:userId", ...managerGate, updateManagerCreatedUser);

// Account email change — auth only (not product entitlement)
router.post("/request-email-change", authenticate, requestEmailChange);
router.post("/verify-email-change", authenticate, verifyEmailChange);

router.get("/all", ...managerGate, getAllUsers);
router.get("/single/:userId", ...managerGate, getSingleUser);
router.get("/managers", authenticate, roleGuard(["admin"]), getAllManagers);
router.get("/manager/:managerId", ...managerGate, getUsersByManager);

router.get("/:userId/qr-login", ...managerGate, roleGuard(["manager"]), getSubUserQrLogin);
router.post("/:userId/qr-login/regenerate", ...managerGate, roleGuard(["manager"]), regenerateSubUserQrLogin);

router.delete("/delete-user/:id", ...managerGate, deleteUser);
router.delete(
    "/delete-manager/:id",
    authenticate,
    roleGuard(["admin"]),
    deleteManager
);

module.exports = router;
