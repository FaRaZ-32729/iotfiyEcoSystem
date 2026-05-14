// src/middleware/subscriptionLimit.js
const User = require("../models/userModel");

const checkSubscriptionLimit = (resourceType) => {
    return async (req, res, next) => {
        try {
            const user = await User.findById(req.user._id)
                .populate({
                    path: "currentSubscription",
                    populate: { path: "plan" }
                });

            // No subscription at all
            if (!user.currentSubscription) {
                return res.status(403).json({
                    success: false,
                    message: "No active subscription found. Please subscribe to a plan first."
                });
            }

            const subscription = user.currentSubscription;

            // Check if subscription is active
            if (subscription.status !== "active") {
                return res.status(403).json({
                    success: false,
                    message: `Your subscription is ${subscription.status}. Please renew it.`
                });
            }

            const plan = subscription.plan;

            if (!plan) {
                return res.status(403).json({
                    success: false,
                    message: "Subscription plan details not found"
                });
            }

            // Check limits based on resource type
            let currentCount = 0;
            let maxLimit = 0;

            if (resourceType === "organization") {
                currentCount = user.organizations ? user.organizations.length : 0;
                maxLimit = plan.maxOrganizations;
            }
            else if (resourceType === "venue") {
                // You can implement venue count logic later
                maxLimit = plan.maxVenues;
            }
            else if (resourceType === "device") {
                maxLimit = plan.maxDevices;
            }

            if (currentCount >= maxLimit) {
                return res.status(403).json({
                    success: false,
                    message: `Limit reached! You can create maximum ${maxLimit} ${resourceType}s under your current plan.`
                });
            }

            // All checks passed
            next();

        } catch (error) {
            console.error("Subscription Limit Check Error:", error);
            return res.status(500).json({
                success: false,
                message: "Subscription check failed. Please try again."
            });
        }
    };
};

module.exports = checkSubscriptionLimit;