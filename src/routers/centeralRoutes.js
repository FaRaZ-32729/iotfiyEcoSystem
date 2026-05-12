// src/routes/index.js
const express = require("express");
const router = express.Router();

// Import all module routes
const authRoutes = require("./authRoutes")
const subscriptionRoutes = require("./subscriptionRoutes")

// Mount all routes with proper prefixes
router.use("/auth", authRoutes);
router.use("/subscription", subscriptionRoutes);

// Health check route
router.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Hellow FaRaZ your IOTFIY-EcoSystem Backend is healthy",
        timestamp: new Date().toISOString()
    });
});

module.exports = router;