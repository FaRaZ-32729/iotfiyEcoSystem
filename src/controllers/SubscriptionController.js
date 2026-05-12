// src/modules/subscription/subscription.controller.js
const Subscription = require("../../models/subscriptionModel");
const SubscriptionPlan = require("../../models/subscriptionPlanModel");
const User = require("../../models/userModel");
const { purchaseSubscriptionSchema } = require("../../validations/subscription.validation");
const sendEmail = require("../../utils/sendEmail");

// Purchase / Activate Subscription
const purchaseSubscription = async (req, res) => {
    try {
        const { planId } = purchaseSubscriptionSchema.parse(req.body);
        const userId = req.user._id;

        const plan = await SubscriptionPlan.findById(planId);
        if (!plan) return res.status(404).json({ message: "Plan not found" });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Calculate end date
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + plan.durationDays);

        // Create Subscription
        const subscription = await Subscription.create({
            user: userId,
            plan: planId,
            startDate,
            endDate,
            status: "active",
            isTrial: plan.isTrial,
            paymentInfo: {
                amountPaid: plan.price,
                paymentMethod: "manual", // Change later with real payment gateway
            }
        });

        // Update User
        user.currentSubscription = subscription._id;
        user.isActive = true;
        await user.save();

        // Send Welcome / Subscription Activated Email
        await sendEmail(
            user.email,
            "Subscription Activated - Welcome to IoTify!",
            `
            <h2>Subscription Activated Successfully!</h2>
            <p>Dear ${user.name},</p>
            <p>You have successfully subscribed to <strong>${plan.displayName}</strong> plan.</p>
            <p>Valid until: ${endDate.toDateString()}</p>
            <p>You can now create organizations, venues and devices.</p>
            `
        );

        res.status(201).json({
            success: true,
            message: "Subscription activated successfully",
            subscription,
            user: {
                isActive: user.isActive,
                currentSubscription: subscription._id
            }
        });

    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({ message: error.errors });
        }
        console.error(error);
        res.status(500).json({ message: "Server error" });
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