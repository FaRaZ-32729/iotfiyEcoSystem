// src/modules/subscription/subscription.controller.js
const Subscription = require("../models/subscriptionModel");
const SubscriptionPlan = require("../models/subscriptionPlanModel");
const User = require("../models/userModel");
const { purchaseSubscriptionSchema } = require("../validations/subscriptionValidations");
const sendEmail = require("../services/emailServices");

// Purchase / Activate Subscription
const purchaseSubscription = async (req, res) => {
    try {
        const { planId } = purchaseSubscriptionSchema.parse(req.body);
        const userId = req.user._id;

        // Fetch plan
        const plan = await SubscriptionPlan.findById(planId);

        if (!plan) {
            return res.status(404).json({ success: false, message: "Plan not found" });
        }

        if (!plan.isActive) {
            return res.status(400).json({ success: false, message: "This plan is currently inactive" });
        }

        // Fetch user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (!user.isVerified) {
            return res.status(403).json({ success: false, message: "Please verify your email first" });
        }

        // Optional: Prevent buying if already has active subscription (you can relax later)
        if (user.currentSubscription) {
            const activeSub = await Subscription.findById(user.currentSubscription);
            if (activeSub && activeSub.status === "active") {
                return res.status(400).json({
                    success: false,
                    message: "You already have an active subscription. Please cancel or upgrade later."
                });
            }
        }

        // Calculate dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + plan.durationDays);

        // Create Subscription
        const subscription = await Subscription.create({
            user: userId,
            plan: planId,
            email: req.user.email,
            startDate,
            endDate,
            status: "active",
            isTrial: plan.isTrial,
            paymentInfo: {
                amountPaid: plan.price,
                paymentMethod: "manual",
            }
        });

        // Update User
        user.currentSubscription = subscription._id;
        user.isActive = true;
        await user.save();

        // Send Email
        await sendEmail(
            user.email,
            "🎉 Your IoTify Subscription is Now Active!",
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #4F46E5;">Congratulations ${user.name}!</h2>
                <p>Your <strong>${plan.name}</strong> plan has been activated successfully.</p>
                <p>Valid until: <strong>${endDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></p>
                <p>You can now create organizations, venues, and devices.</p>
            </div>
            `
        );

        res.status(201).json({
            success: true,
            message: "Subscription activated successfully",
            subscription: {
                id: subscription._id,
                plan: plan.name,
                startDate,
                endDate
            },
            user: {
                isActive: true,
                currentSubscription: subscription._id
            }
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

        console.error("Purchase Subscription Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// Get User's Current Subscription
const getMySubscription = async (req, res) => {
    try {
        const subscription = await Subscription.findOne({ user: req.user._id })
            .populate("plan");

        if (!subscription) {
            return res.status(404).json({ message: "No active subscription found" });
        }

        res.json({ success: true, subscription });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    purchaseSubscription,
    getMySubscription
};