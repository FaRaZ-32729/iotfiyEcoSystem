const IORedis = require("ioredis");

const redisConnection = new IORedis({
    host: "127.0.0.1",
    port: 6379,

    // 🔐 password from env (safer for production)
    password: process.env.REDIS_PASSWORD || "Growmore12345@",

    // ⚡ BullMQ required setting
    maxRetriesPerRequest: null,

    // ⚡ IMPORTANT for BullMQ stability
    enableReadyCheck: true,

    // 🔁 prevents app crash on temporary Redis failure
    retryStrategy(times) {
        return Math.min(times * 100, 3000);
    }
});

// ================== EVENTS ==================

// ⚠️ FIXED: connect is NOT "connecting"
redisConnection.on("connect", () => {
    console.log("🔌 Redis: TCP Connection Established");
});

redisConnection.on("ready", () => {
    console.log("✅ Redis: Ready to use");
});

redisConnection.on("error", (err) => {
    console.error("❌ Redis Error:", err.message);
});

redisConnection.on("close", () => {
    console.log("⚠️ Redis Connection Closed");
});

redisConnection.on("reconnecting", () => {
    console.log("🔄 Redis Reconnecting...");
});

redisConnection.on("end", () => {
    console.log("⛔ Redis Connection Ended");
});

module.exports = redisConnection;