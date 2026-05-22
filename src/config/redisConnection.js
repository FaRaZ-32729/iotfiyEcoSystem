// const IORedis = require("ioredis");

// const redisConnection = new IORedis({
//     host: "127.0.0.1",
//     port: 6379,

//     // 🔐 password from env (safer for production)
//     password: process.env.REDIS_PASSWORD || "Growmore12345@",

//     // ⚡ BullMQ required setting
//     maxRetriesPerRequest: null,

//     // ⚡ IMPORTANT for BullMQ stability
//     enableReadyCheck: true,

//     // 🔁 prevents app crash on temporary Redis failure
//     retryStrategy(times) {
//         return Math.min(times * 100, 3000);
//     }
// });

// // ================== EVENTS ==================

// // ⚠️ FIXED: connect is NOT "connecting"
// redisConnection.on("connect", () => {
//     console.log("🔌 Redis: TCP Connection Established");
// });

// redisConnection.on("ready", () => {
//     console.log("✅ Redis: Ready to use");
// });

// redisConnection.on("error", (err) => {
//     console.error("❌ Redis Error:", err.message);
// });

// redisConnection.on("close", () => {
//     console.log("⚠️ Redis Connection Closed");
// });

// redisConnection.on("reconnecting", () => {
//     console.log("🔄 Redis Reconnecting...");
// });

// redisConnection.on("end", () => {
//     console.log("⛔ Redis Connection Ended");
// });

// module.exports = redisConnection;



// src/config/redis.js
const { Redis } = require("ioredis");

const redisConnection = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,

    maxRetriesPerRequest: null,     // Required for BullMQ
    enableReadyCheck: true,

    retryStrategy(times) {
        console.log(`Redis reconnecting... attempt ${times}`);
        return Math.min(times * 100, 3000);
    }
});

redisConnection.on("connect", () => console.log("✅ Redis Connected"));
redisConnection.on("error", (err) => console.error("❌ Redis Error:", err.message));
redisConnection.on("reconnecting", () => console.log("🔄 Redis Reconnecting..."));

module.exports = redisConnection;