/**

 * Subscription access gate for managers and their sub-users.

 * - admin: skip

 * - manager: must have own active subscription (renew/usage paths open when expired/missing)

 * - role "user": inherits manager (creatorId) subscription; product APIs blocked when not active

 */

const User = require("../models/userModel");



/** Paths a manager may hit with no plan, or with an expired plan. */

const OPEN_WITHOUT_ACTIVE_SUB = [

    /^\/api\/subscription\/usage$/,

    /^\/api\/subscription\/purchase$/,

    /^\/api\/subscription\/renew$/,

    /^\/api\/subscription\/my-subscription$/,

    /^\/api\/subscription\/get-all-plans$/,

    /^\/api\/subscription\/get-plan\//,

    /^\/api\/auth\/me$/,

    /^\/api\/auth\/logout$/,

];



/** Sub-users may only hit identity endpoints when manager plan is not active. */

const OPEN_FOR_LOCKED_SUBUSER = [

    /^\/api\/auth\/me$/,

    /^\/api\/auth\/logout$/,

];



function pathMatches(req, patterns) {

    const full = `${req.baseUrl || ""}${req.path || ""}` || req.originalUrl || "";

    const normalized = String(full).split("?")[0];

    return patterns.some((re) => re.test(normalized));

}



function pathAllowsWithoutActiveSub(req) {

    return pathMatches(req, OPEN_WITHOUT_ACTIVE_SUB);

}



function pathAllowsLockedSubUser(req) {

    return pathMatches(req, OPEN_FOR_LOCKED_SUBUSER);

}



async function loadSubscriptionForUserId(userId) {

    const fresh = await User.findById(userId).populate({

        path: "currentSubscription",

        populate: { path: "plan" },

    });

    if (!fresh) return { user: null, subscription: null };



    let subscription = fresh.currentSubscription;

    if (subscription?.endDate && subscription.status === "active") {

        if (new Date(subscription.endDate) < new Date()) {

            subscription.status = "expired";

            await subscription.save();

        }

    }

    return { user: fresh, subscription: subscription || null };

}



async function resolveManagerSubscription(user) {

    return loadSubscriptionForUserId(user._id);

}



async function resolveCreatorManagerSubscription(subUser) {

    const creatorId = subUser.creatorId;

    if (!creatorId) return { manager: null, subscription: null };



    const { user: manager, subscription } = await loadSubscriptionForUserId(creatorId);

    return { manager, subscription };

}



function denySubUser(res, subscription) {

    if (!subscription) {

        return res.status(403).json({

            success: false,

            code: "MANAGER_SUBSCRIPTION_REQUIRED",

            message:

                "Your manager’s subscription is not active. Contact your manager.",

            redirectTo: "/management/locked",

        });

    }

    return res.status(403).json({

        success: false,

        code: "MANAGER_SUBSCRIPTION_EXPIRED",

        message:

            "Your manager’s subscription has expired. Contact your manager.",

        redirectTo: "/management/locked",

    });

}



const requireManagerSubscription = async (req, res, next) => {

    try {

        const role = req.user?.role;

        if (!role || role === "admin") {

            return next();

        }



        // ── Sub-user: inherit manager (creatorId) entitlement ──

        if (role === "user") {

            const { subscription } = await resolveCreatorManagerSubscription(

                req.user

            );



            if (!subscription || subscription.status !== "active") {

                if (pathAllowsLockedSubUser(req)) {

                    return next();

                }

                return denySubUser(res, subscription);

            }



            req.subscription = subscription;

            return next();

        }



        if (role !== "manager") {

            return next();

        }



        // ── Manager: own subscription ──

        const { subscription } = await resolveManagerSubscription(req.user);



        if (!subscription) {

            if (pathAllowsWithoutActiveSub(req)) {

                return next();

            }

            return res.status(403).json({

                success: false,

                code: "SUBSCRIPTION_REQUIRED",

                message: "Please select a plan to continue.",

                redirectTo: "/select-plan",

            });

        }



        if (subscription.status !== "active") {

            if (pathAllowsWithoutActiveSub(req)) {

                req.subscription = subscription;

                return next();

            }

            return res.status(403).json({

                success: false,

                code: "SUBSCRIPTION_EXPIRED",

                message: "Your subscription has expired. Please renew to continue.",

                redirectTo: "/management/subscription",

            });

        }



        req.subscription = subscription;

        return next();

    } catch (err) {

        console.error("requireManagerSubscription:", err);

        return res.status(500).json({

            success: false,

            message: "Subscription check failed",

        });

    }

};



module.exports = requireManagerSubscription;

module.exports.resolveCreatorManagerSubscription =

    resolveCreatorManagerSubscription;

module.exports.loadSubscriptionForUserId = loadSubscriptionForUserId;


