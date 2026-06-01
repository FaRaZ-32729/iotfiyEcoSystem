const express = require("express");
const dotenv = require("dotenv");
const dbConnection = require("./src/config/dbConnection");
const cookieParser = require("cookie-parser");
const { initializeMQTT } = require("./src/mqtt/initializeMQTT");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// Routers
const centeralRoutes = require("./src/routers/centeralRoutes");

// Utilities

dotenv.config();
dbConnection();

const port = process.env.PORT || 5054;
const app = express();
const server = http.createServer(app);

// Middlewares
const allowedOrigins = [
    "https://luckyone-iotfiysolutions.vercel.app",
    "http://localhost:5173"
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // allow mobile/postman
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

// Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "https://your-frontend.com"],
        methods: ["GET", "POST"],
        credentials: true
    }
});


app.use(express.json());
app.use(cookieParser());



// Routes
app.use("/api", centeralRoutes);
// Inside server.js — Add this route
// app.post("/api/test/trigger-schedule", async (req, res) => {
//     try {
//         const { deviceId, command = "ON" } = req.body;

//         console.log(`🧪 [TEST TRIGGER] Manual trigger for ${deviceId} | Command: ${command}`);

//         const scheduleQueue = require("./src/queues/scheduleQueue");

//         await scheduleQueue.add(`test-schedule-${Date.now()}`, {
//             scheduleId: `test-${Date.now()}`,
//             deviceId,
//             command
//         });

//         res.json({ success: true, message: "Test job added to queue" });
//     } catch (error) {
//         console.error("Test trigger error:", error);
//         res.status(500).json({ success: false, error: error.message });
//     }
// });

app.get("/", (req, res) => {
    res.status(200).json({
        message: "hello faraz"
    });
});
global.io = io;
initializeMQTT();

// console.log(new Date().toUTCString());
console.log("backend is running on port")
// Start server
server.listen(port, () => {
    console.log(`Express & WebSocket is running on port : ${port}`);
});