// src/modules/authRoutes.js
const express = require("express");
const { registerUser, loginUser, verifyOTP, setPassword, createUserByAdmin, registerAdmin, logoutUser, createSubUser } = require("../controllers/authController");
const authenticate = require("../middlewares/auth");
const checkPendingSubscription = require("../middlewares/checkPendingSubscription");
const roleGuard = require("../middlewares/roleGuard");
const router = express.Router();

// Public Routes
router.post("/register-admin", registerAdmin);
router.post("/register", checkPendingSubscription, registerUser);
router.post("/register-user", authenticate, roleGuard(["manager"]), createSubUser);
router.post("/login", loginUser);
router.post("/verify-otp", verifyOTP);
router.post("/verify-otp/:token", verifyOTP);
router.post("/set-password/:token", setPassword);
router.delete("/logout", logoutUser);

// Protected Routes (Only Admin)
router.post("/admin/register", authenticate, roleGuard(["admin"]), checkPendingSubscription, createUserByAdmin);

module.exports = router;