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
            "🎉 Your IoTify Subscription is Now Active!",
            `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 30px 20px; background: #ffffff;">
        <h1 style="color: #4F46E5; text-align: center;">Welcome to IoTify!</h1>
        
        <p style="font-size: 16px;">Dear <strong>${user.name}</strong>,</p>
        
        <p>Your subscription has been successfully activated. Thank you for trusting us with your IoT journey.</p>
        
        <div style="background: linear-gradient(135deg, #4F46E5, #6366F1); color: white; padding: 25px; border-radius: 12px; margin: 25px 0; text-align: center;">
            <p style="margin: 0 0 8px 0; font-size: 18px;"><strong>${plan.name}</strong> Plan</p>
            <p style="margin: 0; font-size: 15px;">Valid until: <strong>${endDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></p>
        </div>

        <p>You can now create organizations, venues, and start adding your devices.</p>
        
        <p style="margin-top: 25px;">Need help getting started? Our support team is always here for you.</p>
        
        <br><br>
        <p>Best Regards,<br><strong>The IoTify Team</strong></p>
    </div>
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
            return res.status(400).json({
                success: false,
                errors: error.issues.map((err) => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
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