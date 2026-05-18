// src/middleware/subscriptionLimit.js
const Device = require("../models/deviceModel");
const Organization = require("../models/organizationModel");
const User = require("../models/userModel");
const Venue = require("../models/venueModel");

// const checkSubscriptionLimit = (resourceType) => {
//     return async (req, res, next) => {
//         try {
//             const user = await User.findById(req.user._id)
//                 .populate({
//                     path: "currentSubscription",
//                     populate: { path: "plan" }
//                 });

//             // No subscription at all
//             if (!user.currentSubscription) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "No active subscription found. Please subscribe to a plan first."
//                 });
//             }

//             const subscription = user.currentSubscription;

//             // Check if subscription is active
//             if (subscription.status !== "active") {
//                 return res.status(403).json({
//                     success: false,
//                     message: `Your subscription is ${subscription.status}. Please renew it.`
//                 });
//             }

//             const plan = subscription.plan;

//             if (!plan) {
//                 return res.status(403).json({
//                     success: false,
//                     message: "Subscription plan details not found"
//                 });
//             }

//             // Check limits based on resource type
//             let currentCount = 0;
//             let maxLimit = 0;

//             if (resourceType === "organization") {
//                 currentCount = user.organizations ? user.organizations.length : 0;
//                 maxLimit = plan.maxOrganizations;
//             }
//             else if (resourceType === "venue") {

//                 const orgIds = user.organizations || [];
//                 currentCount = await Organization.aggregate([
//                     { $match: { _id: { $in: orgIds } } },
//                     { $lookup: { from: "venues", localField: "_id", foreignField: "organization", as: "venues" } },
//                     { $unwind: "$venues" },
//                     { $count: "total" }
//                 ]).then(result => result[0]?.total || 0);

//                 maxLimit = plan.maxVenues;
//             }
//             else if (resourceType === "device") {
//                 const orgIds = user.organizations || [];

//                 // get venues under user's organizations
//                 const venues = await Venue.find({
//                     organization: { $in: orgIds }
//                 }).select("_id");

//                 const venueIds = venues.map(v => v._id);

//                 currentCount = await Device.countDocuments({
//                     venue: { $in: venueIds }
//                 });

//                 maxLimit = plan.maxDevices;

//             }
//             else if (resourceType === "user") {
//                 currentCount = await User.countDocuments({
//                     organizations: { $in: user.organizations }
//                 });

//                 maxLimit = plan.maxUsers;
//             }

//             if (currentCount >= maxLimit) {
//                 return res.status(403).json({
//                     success: false,
//                     message: `Limit reached! You can create maximum ${maxLimit} ${resourceType}s under your current plan.`
//                 });
//             }

//             // All checks passed
//             next();

//         } catch (error) {
//             console.error("Subscription Limit Check Error:", error);
//             return res.status(500).json({
//                 success: false,
//                 message: "Subscription check failed. Please try again."
//             });
//         }
//     };
// };

const checkSubscriptionLimit = (resourceType) => {
    return async (req, res, next) => {
        try {
            const user = await User.findById(req.user._id)
                .populate({
                    path: "currentSubscription",
                    populate: { path: "plan" }
                });

            if (!user.currentSubscription) {
                return res.status(403).json({
                    success: false,
                    message: "No active subscription found. Please subscribe to a plan first."
                });
            }

            const subscription = user.currentSubscription;

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

            let currentCount = 0;
            let maxLimit = 0;

            switch (resourceType) {
                case "organization":
                    currentCount = user.organizations ? user.organizations.length : 0;
                    maxLimit = plan.maxOrganizations;
                    break;

                case "venue":
                    const orgIds = user.organizations || [];
                    currentCount = await Organization.aggregate([
                        { $match: { _id: { $in: orgIds } } },
                        { $lookup: { from: "venues", localField: "_id", foreignField: "organization", as: "venues" } },
                        { $unwind: "$venues" },
                        { $count: "total" }
                    ]).then(result => result[0]?.total || 0);

                    maxLimit = plan.maxVenues;
                    break;

                case "device":
                    const orgIdsForDevice = user.organizations || [];
                    const venues = await Venue.find({ organization: { $in: orgIdsForDevice } }).select("_id");
                    const venueIds = venues.map(v => v._id);

                    currentCount = await Device.countDocuments({ venue: { $in: venueIds } });
                    maxLimit = plan.maxDevices;
                    break;

                case "user":   // ← Sub-users created by manager
                    currentCount = await User.countDocuments({
                        creatorId: user._id,      // Count only users created by this manager
                        role: "user"
                    });
                    maxLimit = plan.maxUsers || 10;   // Default fallback if field missing
                    break;

                default:
                    return res.status(400).json({
                        success: false,
                        message: "Invalid resource type"
                    });
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