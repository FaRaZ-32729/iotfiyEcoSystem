const SubscriptionPlan = require("../models/subscriptionPlanModel");
const { createPlanSchema } = require("../validations/subscriptionValidations");

// Create New Plan (free , basic , premium , Admin Custom , User Custom) 
const createSubscriptionPlan = async (req, res) => {
    try {
        const validatedData = createPlanSchema.parse(req.body);

        // Free plan must be 15 days
        if (validatedData.name === "free" && validatedData.durationDays !== 15) {
            return res.status(400).json({
                success: false,
                message: "Free plan must have exactly 15 days duration"
            });
        }

        // Handle assignedToEmail logic
        let finalAssignedToEmail = validatedData.assignedToEmail;

        if (validatedData.type === "custom") {
            if (req.user.role === "admin") {
                if (!finalAssignedToEmail) {
                    return res.status(400).json({
                        success: false,
                        message: "assignedToEmail is required when admin creates custom plan"
                    });
                }
            } else {
                finalAssignedToEmail = req.user.email;
            }
        }

        // Check duplicate
        const existing = await SubscriptionPlan.findOne({ name: validatedData.name });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Plan with name "${validatedData.name}" already exists`
            });
        }

        // Create Plan with Creator ID
        const plan = await SubscriptionPlan.create({
            name: validatedData.name,
            type: validatedData.type,
            description: validatedData.description,
            price: validatedData.price,
            durationDays: validatedData.durationDays,
            maxOrganizations: validatedData.maxOrganizations,
            maxVenues: validatedData.maxVenues,
            maxDevices: validatedData.maxDevices,
            assignedToEmail: finalAssignedToEmail,
            isCustom: validatedData.name === "custom",
            isTrial: validatedData.name === "free",
            createdBy: req.user._id          // ← Important: Save who created it
        });

        res.status(201).json({
            success: true,
            message: "Subscription Plan created successfully",
            plan
        });

    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.issues.map(err => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
        }

        console.error("Create Plan Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while creating plan"
        });
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