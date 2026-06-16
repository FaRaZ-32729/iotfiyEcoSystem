const mongoose = require("mongoose");

const connections = {};

const multiDBConnections = () => {
    const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 90000,
        connectTimeoutMS: 30000,
        retryWrites: true,
        w: "majority",
        tls: true,
        tlsAllowInvalidCertificates: false, 
        family: 4,                            
    };

    console.log("🔄 Initializing Multi-DB Connections...");

    connections["OD"] = mongoose.createConnection(process.env.MONGODB_OD_URL, options);
    connections["THD"] = mongoose.createConnection(process.env.MONGODB_THD_URL, options);
    connections["AQID"] = mongoose.createConnection(process.env.MONGODB_AQID_URL, options);
    connections["ED"] = mongoose.createConnection(process.env.MONGODB_ED_URL, options);

    // Connection Logs
    Object.keys(connections).forEach(type => {
        connections[type].on('connected', () => {
            console.log(`✅ Successfully Connected to ${type} Cluster`);
        });

        connections[type].on('error', (err) => {
            console.error(`❌ ${type} Cluster Error:`, err.message);
        });

        connections[type].on('disconnected', () => {
            console.warn(`⚠️ ${type} Cluster Disconnected`);
        });
    });
};

const getDBConnection = (deviceType) => {
    const conn = connections[deviceType];
    if (!conn) {
        console.warn(`⚠️ No cluster configured for deviceType: ${deviceType}`);
        return null;
    }
    return conn;
};

module.exports = { multiDBConnections, getDBConnection };