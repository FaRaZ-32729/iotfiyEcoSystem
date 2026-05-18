// src/routes/centralRoutes.js
const express = require("express");
const router = express.Router();

// Import all module routes
const authRoutes = require("./authRoutes")
const subscriptionRoutes = require("./subscriptionRoutes")
const organizationRoutes = require("./organizationRoutes")
const venueRoutes = require("./venueRoutes")
const deviceRoutes = require("./deviceRoutes")
const userRoutes = require("./userRoutes")

// Mount all routes with proper prefixes
router.use("/auth", authRoutes);
router.use("/subscription", subscriptionRoutes);
router.use("/organization", organizationRoutes);
router.use("/venue", venueRoutes);
router.use("/device", deviceRoutes);
router.use("/user", userRoutes);

// Health check route
router.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Hellow FaRaZ your IOTFIY-EcoSystem Backend is healthy",
        timestamp: new Date().toISOString()
    });
});

module.exports = router;