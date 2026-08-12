// src/controllers/subscriptionController.js
const Subscription = require("../models/subscriptionModel");
const SubscriptionPlan = require("../models/subscriptionPlanModel");
const User = require("../models/userModel");
const Organization = require("../models/organizationModel");
const Venue = require("../models/venueModel");
const Device = require("../models/deviceModel");
const { purchaseSubscriptionSchema } = require("../validations/subscriptionValidations");
const sendEmail = require("../services/emailServices");

async function activatePlanForUser({ user, plan, paymentMethod = "manual" }) {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    if (user.currentSubscription) {
        const prev = await Subscription.findById(user.currentSubscription);
        if (prev && prev.status === "active") {
            prev.status = "cancelled";
            await prev.save();
        }
    }

    const subscription = await Subscription.create({
        user: user._id,
        plan: plan._id,
        email: user.email,
        startDate,
        endDate,
        status: "active",
        isTrial: Boolean(plan.isTrial),
        paymentInfo: {
            amountPaid: plan.price,
            paymentMethod,
        },
        previousPlan: user.currentSubscription || undefined,
    });

    user.currentSubscription = subscription._id;
    await user.save();

    return { subscription, startDate, endDate };
}

// Purchase / Activate Subscription (also used for "choose another plan" after expiry)
const purchaseSubscription = async (req, res) => {
    try {
        const { planId } = purchaseSubscriptionSchema.parse(req.body);
        const userId = req.user._id;

        const plan = await SubscriptionPlan.findById(planId);
        if (!plan) {
            return res.status(404).json({ success: false, message: "Plan not found" });
        }
        if (!plan.isActive) {
            return res.status(400).json({ success: false, message: "This plan is currently inactive" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (!user.isVerified) {
            return res.status(403).json({ success: false, message: "Please verify your email first" });
        }

        if (user.currentSubscription) {
            const activeSub = await Subscription.findById(user.currentSubscription);
            if (activeSub && activeSub.status === "active") {
                const stillValid =
                    activeSub.endDate && new Date(activeSub.endDate) >= new Date();
                if (stillValid) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "You already have an active subscription. Please renew after it expires or contact support to change plans.",
                    });
                }
                activeSub.status = "expired";
                await activeSub.save();
            }
        }

        const { subscription, startDate, endDate } = await activatePlanForUser({
            user,
            plan,
            paymentMethod: "manual",
        });

        try {
            await sendEmail(
                user.email,
                "Your ecoSystem subscription is now active",
                `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #0D5CA4;">Congratulations ${user.name}!</h2>
                <p>Your <strong>${plan.name}</strong> plan has been activated successfully.</p>
                <p>Valid until: <strong>${endDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                })}</strong></p>
            </div>
            `
            );
        } catch (emailErr) {
            console.error("Purchase email failed:", emailErr.message || emailErr);
        }

        res.status(201).json({
            success: true,
            message: "Subscription activated successfully",
            subscription: {
                id: subscription._id,
                plan: plan.name,
                status: subscription.status,
                startDate,
                endDate,
            },
            user: {
                isActive: true,
                currentSubscription: subscription._id,
            },
        });
    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                errors: error.issues.map((err) => ({
                    field: err.path[0],
                    message: err.message,
                })),
            });
        }
        console.error("Purchase Subscription Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * One-click renew of the previous (current) plan — for expired managers.
 * Body optional: { planId } to renew a specific plan; default = last subscription's plan.
 */
const renewSubscription = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate({
            path: "currentSubscription",
            populate: { path: "plan" },
        });
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const current = user.currentSubscription;
        if (current?.status === "active" && new Date(current.endDate) >= new Date()) {
            return res.status(400).json({
                success: false,
                message: "Your subscription is still active.",
            });
        }

        const planId = req.body?.planId || current?.plan?._id || current?.plan;
        if (!planId) {
            return res.status(400).json({
                success: false,
                message: "No previous plan found. Please choose a plan.",
                redirectTo: "/select-plan",
            });
        }

        const plan = await SubscriptionPlan.findById(planId);
        if (!plan || !plan.isActive) {
            return res.status(400).json({
                success: false,
                message: "Plan is not available. Please choose another plan.",
            });
        }

        if (current && current.status === "active") {
            current.status = "expired";
            await current.save();
        }

        const { subscription, startDate, endDate } = await activatePlanForUser({
            user,
            plan,
            paymentMethod: "renew",
        });

        res.status(201).json({
            success: true,
            message: "Subscription renewed successfully",
            subscription: {
                id: subscription._id,
                plan: plan.name,
                planId: plan._id,
                status: subscription.status,
                startDate,
                endDate,
            },
        });
    } catch (error) {
        console.error("Renew Subscription Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

const getMySubscription = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate({
            path: "currentSubscription",
            populate: { path: "plan" },
        });
        const subscription = user?.currentSubscription;
        if (!subscription) {
            return res.status(404).json({
                success: false,
                code: "SUBSCRIPTION_REQUIRED",
                message: "No subscription found",
            });
        }
        if (
            subscription.status === "active" &&
            subscription.endDate &&
            new Date(subscription.endDate) < new Date()
        ) {
            subscription.status = "expired";
            await subscription.save();
        }
        res.json({ success: true, subscription });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};

const getSubscriptionUsage = async (req, res) => {
    try {
        const userDoc = await User.findById(req.user._id).populate({
            path: "currentSubscription",
            populate: { path: "plan" },
        });

        if (!userDoc?.currentSubscription) {
            return res.status(400).json({
                success: false,
                code: "SUBSCRIPTION_REQUIRED",
                message: "No subscription found",
            });
        }

        let subscription = userDoc.currentSubscription;
        if (
            subscription.status === "active" &&
            subscription.endDate &&
            new Date(subscription.endDate) < new Date()
        ) {
            subscription.status = "expired";
            await subscription.save();
        }

        const plan = subscription.plan;
        if (!plan) {
            return res.status(400).json({
                success: false,
                message: "Subscription plan details not found",
            });
        }

        const usedOrganizations = await Organization.countDocuments({
            owner: userDoc._id,
        });
        const userOrgIds = await Organization.find({ owner: userDoc._id }).select(
            "_id"
        );
        const orgIds = userOrgIds.map((org) => org._id);
        const usedVenues = await Venue.countDocuments({
            organization: { $in: orgIds },
        });
        const userVenues = await Venue.find({
            organization: { $in: orgIds },
        }).select("_id");
        const usedDevices = await Device.countDocuments({
            venue: { $in: userVenues.map((v) => v._id) },
        });
        const usedUsers = await User.countDocuments({
            creatorId: userDoc._id,
            role: "user",
        });

        const usage = {
            organizations: {
                used: usedOrganizations,
                total: plan.maxOrganizations,
                remaining: Math.max(0, plan.maxOrganizations - usedOrganizations),
            },
            venues: {
                used: usedVenues,
                total: plan.maxVenues,
                remaining: Math.max(0, plan.maxVenues - usedVenues),
            },
            devices: {
                used: usedDevices,
                total: plan.maxDevices,
                remaining: Math.max(0, plan.maxDevices - usedDevices),
            },
            users: {
                used: usedUsers,
                total: plan.maxUsers || 10,
                remaining: Math.max(0, (plan.maxUsers || 10) - usedUsers),
            },
        };

        res.status(200).json({
            success: true,
            subscription: {
                id: subscription._id,
                planId: plan._id,
                planName: plan.name,
                planType: plan.type,
                status: subscription.status,
                isActive: subscription.status === "active",
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                price: plan.price,
                durationDays: plan.durationDays,
            },
            usage,
            overallStatus: {
                isWithinLimit:
                    usedOrganizations <= plan.maxOrganizations &&
                    usedVenues <= plan.maxVenues &&
                    usedDevices <= plan.maxDevices &&
                    usedUsers <= (plan.maxUsers || 10),
            },
        });
    } catch (error) {
        console.error("Get Subscription Usage Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while fetching usage",
        });
    }
};

module.exports = {
    purchaseSubscription,
    renewSubscription,
    getSubscriptionUsage,
    getMySubscription,
};
