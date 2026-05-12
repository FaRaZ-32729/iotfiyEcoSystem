// src/middleware/subscriptionLimit.js
const User = require("../models/userModel");
const Subscription = require("../models/subscriptionModel");

const checkSubscriptionLimit = (resourceType) => {
    return async (req, res, next) => {
        try {
            const user = await User.findById(req.user._id).populate("currentSubscription.plan");

            if (!user.currentSubscription) {
                return res.status(403).json({ message: "No active subscription found" });
            }

            const plan = user.currentSubscription.plan;

            let currentCount = 0;

            if (resourceType === "organization") {
                currentCount = user.organizations.length;
                if (currentCount >= plan.maxOrganizations) {
                    return res.status(403).json({ 
                        message: `Organization limit reached (${plan.maxOrganizations})` 
                    });
                }
            } 
            else if (resourceType === "venue") {
                // You can add logic to count venues per organization
            } 
            else if (resourceType === "device") {
                // Count devices logic
            }

            next();
        } catch (error) {
            res.status(500).json({ message: "Subscription check failed" });
        }
    };
};

module.exports = checkSubscriptionLimit;