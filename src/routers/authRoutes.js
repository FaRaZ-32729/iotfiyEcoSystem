// src/modules/auth/auth.routes.js
const express = require("express");
const { registerUser, loginUser, verifyOTP, setPassword, createUserByAdmin, registerAdmin } = require("../controllers/authController");
const router = express.Router();

// Public Routes
router.post("/register-admin", registerAdmin);
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-otp", verifyOTP);
router.post("/set-password/:token", setPassword);

// Protected Routes (Only Admin)
router.post("/admin/create-user", createUserByAdmin);

module.exports = router;