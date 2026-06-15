// const mongoose = require("mongoose");
// require("dotenv").config();

// const connections = {};

// // Initialize all connections
// const multiDBConnections = () => {
//     const options = {
//         maxPoolSize: 10,
//         serverSelectionTimeoutMS: 20000,
//         socketTimeoutMS: 60000,
//         connectTimeoutMS: 20000,
//         retryWrites: true,
//         w: "majority",
//         tls: true,
//         tlsAllowInvalidCertificates: false,
//     };

//     connections["OD"] = mongoose.createConnection(process.env.MONGODB_OD_URL, options);

//     connections["THD"] = mongoose.createConnection(process.env.MONGODB_THD_URL, options);

//     connections["AQID"] = mongoose.createConnection(process.env.MONGODB_AQID_URL, options);

//     connections["ED"] = mongoose.createConnection(process.env.MONGODB_ED_URL, options);

//     // Log connection status
//     Object.keys(connections).forEach(type => {
//         connections[type].on('connected', () => {
//             console.log(`Connected to ${type} Cluster`);
//         });
//         connections[type].on('error', (err) => {
//             console.error(`${type} Cluster Error:`, err.message);
//         });
//     });
// };


// const getDBConnection = (deviceType) => {
//     const conn = connections[deviceType];

//     if (!conn) {
//         console.warn(`No cluster configured for deviceType: ${deviceType}. Data will be ignored.`);
//         return null;
//     }

//     return conn;
// };

// module.exports = { multiDBConnections, getDBConnection };