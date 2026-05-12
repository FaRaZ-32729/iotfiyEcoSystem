// src/modules/subscription/subscriptionPlan.controller.js
const SubscriptionPlan = require("../models/subscriptionPlanModel");
const { createPlanSchema } = require("../validations/subscriptionValidations");

// Create New Plan (Admin Only)
const createSubscriptionPlan = async (req, res) => {
    try {
        const validatedData = createPlanSchema.parse(req.body);

        const existing = await SubscriptionPlan.findOne({ name: validatedData.name });
        if (existing) {
            return res.status(400).json({ message: "Plan with this name already exists" });
        }

        const plan = await SubscriptionPlan.create(validatedData);

        res.status(201).json({
            success: true,
            message: "Subscription Plan created successfully",
            plan
        });
    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({ message: error.errors });
        }
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get All Plans
const getAllPlans = async (req, res) => {
    try {
        const plans = await SubscriptionPlan.find({ isActive: true }).sort({ price: 1 });
        res.json({ success: true, plans });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// Get Single Plan
const getPlanById = async (req, res) => {
    try {
        const plan = await SubscriptionPlan.findById(req.params.id);
        if (!plan) return res.status(404).json({ message: "Plan not found" });

        res.json({ success: true, plan });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    createSubscriptionPlan,
    getAllPlans,
    getPlanById
};