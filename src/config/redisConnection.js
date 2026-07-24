// src/config/redisConnection.js
const { Redis } = require("ioredis");
require("dotenv").config();

/**
 * BullMQ needs Redis. Prefer REDIS_URL (Upstash / cloud), else local HOST/PORT.
 *
 * .env examples:
 *   REDIS_URL=rediss://default:TOKEN@xxx.upstash.io:6379
 *   — or local —
 *   REDIS_HOST=127.0.0.1
 *   REDIS_PORT=6379
 *   REDIS_PASSWORD=
 */
const commonOpts = {
  maxRetriesPerRequest: null, // Required for BullMQ workers
  enableReadyCheck: false, // Friendlier for managed Redis (Upstash)
  retryStrategy(times) {
    console.log(`Redis reconnecting... attempt ${times}`);
    return Math.min(times * 100, 3000);
  },
};

let redisConnection;

if (process.env.REDIS_URL) {
  console.log("🔌 Redis: using REDIS_URL");
  redisConnection = new Redis(process.env.REDIS_URL, commonOpts);
} else {
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = parseInt(process.env.REDIS_PORT, 10) || 6379;
  console.log(`🔌 Redis: using ${host}:${port}`);
  redisConnection = new Redis({
    host,
    port,
    password: process.env.REDIS_PASSWORD || undefined,
    ...commonOpts,
  });
}

redisConnection.on("connect", () => console.log("✅ Redis Connected"));
redisConnection.on("ready", () => console.log("✅ Redis Ready"));
redisConnection.on("error", (err) => console.error("❌ Redis Error:", err.message));
redisConnection.on("reconnecting", () => console.log("🔄 Redis Reconnecting..."));

module.exports = redisConnection;
