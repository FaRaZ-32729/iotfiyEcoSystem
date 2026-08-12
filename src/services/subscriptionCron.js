/**
 * Daily subscription expiry cron (once per day).
 */
const cron = require("node-cron");
const {
    expireDueSubscriptions,
} = require("./subscriptionLifecycleService");

let started = false;

function startSubscriptionCron() {
    if (started) return;
    started = true;

    // Once daily at 00:15 Asia/Karachi (UTC+5)
    cron.schedule(
        "15 0 * * *",
        async () => {
            try {
                console.log("[subscriptionCron] running expireDueSubscriptions…");
                const result = await expireDueSubscriptions();
                console.log("[subscriptionCron] done", result);
            } catch (err) {
                console.error("[subscriptionCron] failed", err.message || err);
            }
        },
        { timezone: "Asia/Karachi" }
    );

    console.log(
        "[subscriptionCron] scheduled daily 00:15 Asia/Karachi"
    );
}

module.exports = { startSubscriptionCron };
