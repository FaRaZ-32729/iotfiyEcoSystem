const express = require("express");
const dotenv = require("dotenv");
const dbConnection = require("./src/config/dbConnection");
const cookieParser = require("cookie-parser");
const { initializeMQTT } = require("./src/mqtt/initializeMQTT");
const cors = require("cors");
const http = require("http");

// Routers
const centeralRoutes = require("./src/routers/centeralRoutes");

// Utilities

dotenv.config();
dbConnection();
// const port = 5053;
const port = process.env.PORT || 5053;
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


app.use(express.json());
app.use(cookieParser());



// Routes
app.use("/api", centeralRoutes)



// console.log(new Date().toUTCString());
// Start server
server.listen(port, () => {
    console.log(`Express & WebSocket is running on port : ${port}`);
    initializeMQTT();
});