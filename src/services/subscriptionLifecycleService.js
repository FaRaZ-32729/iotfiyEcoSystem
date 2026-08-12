/**
 * Subscription lifecycle: expire due subs (cron) + user email.
 * Admin is NOT emailed — they see status in UI later.
 */
const Subscription = require("../models/subscriptionModel");
const User = require("../models/userModel");
const sendEmail = require("./emailServices");

function getFrontendBaseUrl() {
    return (
        process.env.FRONTEND_URL ||
        process.env.CLIENT_URL ||
        "https://ecosystem.iotfiysolutions.com"
    ).replace(/\/$/, "");
}

async function sendSubscriptionExpiredEmail(user, subscription) {
    if (!user?.email) return;
    const renewUrl = `${getFrontendBaseUrl()}/management/subscription`;
    const end = subscription?.endDate
        ? new Date(subscription.endDate).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
          })
        : "recently";

    await sendEmail(
        user.email,
        "Your ecoSystem subscription has expired",
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0D5CA4;">Subscription expired</h2>
          <p>Hi ${user.name || "there"},</p>
          <p>Your ecoSystem subscription ended on <strong>${end}</strong>.</p>
          <p>Renew now to keep creating organizations, venues, and devices.</p>
          <p style="margin: 24px 0;">
            <a href="${renewUrl}"
               style="background:#0D5CA4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
              Renew now
            </a>
          </p>
          <p style="color:#64748b;font-size:13px;">Or open: ${renewUrl}</p>
        </div>
        `
    );
}

/**
 * Find active/trial subscriptions past endDate → mark expired → email user.
 * Returns summary counts.
 */
async function expireDueSubscriptions() {
    const now = new Date();
    const due = await Subscription.find({
        status: { $in: ["active", "trial"] },
        endDate: { $lt: now },
    })
        .populate("user", "name email role")
        .lean(false);

    let expired = 0;
    let emailed = 0;
    let emailErrors = 0;

    for (const sub of due) {
        sub.status = "expired";
        await sub.save();
        expired += 1;

        const user =
            sub.user ||
            (await User.findOne({ email: sub.email }).select("name email role"));

        if (!user) continue;
        try {
            await sendSubscriptionExpiredEmail(user, sub);
            emailed += 1;
        } catch (err) {
            emailErrors += 1;
            console.error(
                `[subscriptionLifecycle] email failed for ${user.email}:`,
                err.message || err
            );
        }
    }

    return { scanned: due.length, expired, emailed, emailErrors, at: now.toISOString() };
}

module.exports = {
    expireDueSubscriptions,
    sendSubscriptionExpiredEmail,
    getFrontendBaseUrl,
};
