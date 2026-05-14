// src/middleware/checkPendingSubscription.js
const Subscription = require("../models/subscriptionModel");
const User = require("../models/userModel");

const checkPendingSubscription = async (req, res, next) => {
    try {
        const { email } = req.body;   // email will be available in both registerUser and createUserByAdmin

        console.log("🔍 checkPendingSubscription Middleware Triggered");
        console.log("Received Email:", email);

        if (!email) return next();

        // Find pending subscription (where user is null but assignedEmail exists)
        const pendingSubscription = await Subscription.findOne({
            email: email.toLowerCase(),
            user: null,                    // Not yet linked
            status: "active"
        });

        console.log("Pending Subscription Found:", pendingSubscription ? "YES" : "NO");

        if (pendingSubscription) {
            console.log(`🔗 Found pending subscription for ${email}`);

            // Attach to request so controller can use it
            req.pendingSubscription = pendingSubscription;
        }

        next();

    } catch (error) {
        console.error("Check Pending Subscription Error:", error);
        next();
    }
};

module.exports = checkPendingSubscription;