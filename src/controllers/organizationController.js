// src/controllers/organizationController.js
const Organization = require("../models/organizationModel");
const { createOrganizationSchema } = require("../validations/organizationValidation");
const checkSubscriptionLimit = require("../middlewares/subscriptionLimit");
const User = require("../models/userModel");

const createOrganization = async (req, res) => {
    try {
        const validatedData = createOrganizationSchema.parse(req.body);
        const user = req.user;

        if (user.role !== "admin") {
            await checkSubscriptionLimit("organization")(req, res, () => {
            });            
            if (res.headersSent) return;
        }

        // Check duplicate organization name
        const existingOrg = await Organization.findOne({
            name: { $regex: new RegExp(`^${validatedData.name}$`, 'i') }
        });

        if (existingOrg) {
            return res.status(400).json({
                success: false,
                message: "Organization with this name already exists"
            });
        }

        // Create Organization
        const organization = await Organization.create({
            name: validatedData.name,
            owner: user._id,
        });

        // Add to user's organizations
        await User.findByIdAndUpdate(user._id, {
            $push: { organizations: organization._id },
        });

        res.status(201).json({
            success: true,
            message: "Organization created successfully",
            organization
        });

    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                errors: error.issues.map(err => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
        }

        console.error("Create Organization Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while creating organization"
        });
    }
};

module.exports = { createOrganization };