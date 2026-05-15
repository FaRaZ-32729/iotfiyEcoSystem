// src/Controllers/venueController.js
const Venue = require("../models/venueModel");
const Organization = require("../models/organizationModel");
const { createVenueSchema } = require("../validations/venueValidation");
const checkSubscriptionLimit = require("../middlewares/subscriptionLimit");
const User = require("../models/userModel");

const createVenue = async (req, res) => {
    try {
        const validatedData = createVenueSchema.parse(req.body);
        const user = req.user;

        // Check if organization exists and belongs to user
        const organization = await Organization.findById(validatedData.organization);
        if (!organization) {
            return res.status(404).json({
                success: false,
                message: "Organization not found"
            });
        }

        // Check ownership (Admin can create anywhere, Manager only in their orgs)
        if (user.role !== "admin") {
            if (!user.organizations.includes(validatedData.organization)) {
                return res.status(403).json({
                    success: false,
                    message: "You can only create venues in your own organizations"
                });
            }
        }

        // Check subscription limit
        if (user.role !== "admin") {
            await checkSubscriptionLimit("venue")(req, res, () => { });
            if (res.headersSent) return;
        }

        // Check duplicate venue name in same organization
        const existingVenue = await Venue.findOne({
            name: { $regex: new RegExp(`^${validatedData.name}$`, 'i') },
            organization: validatedData.organization
        });

        if (existingVenue) {
            return res.status(400).json({
                success: false,
                message: "Venue with this name already exists in this organization"
            });
        }

        // Create Venue
        const venue = await Venue.create({
            name: validatedData.name,
            description: validatedData.description,
            organization: validatedData.organization,
            createdBy: user._id
        });

        await User.findByIdAndUpdate(user._id, {
            $push: { venues: venue._id },
        });

        res.status(201).json({
            success: true,
            message: "Venue created successfully",
            venue
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

        console.error("Create Venue Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while creating venue"
        });
    }
};

module.exports = { createVenue };