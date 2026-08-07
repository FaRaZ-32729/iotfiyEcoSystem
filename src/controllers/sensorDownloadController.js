// src/controllers/sensorDownloadController.js
const {
    fetchSensorHistory,
    MONGO_FIELDS_BY_TYPE,
} = require("../services/sensorHistoryService");

/**
 * GET /device/:deviceId/sensor-download
 * Query: start, end (ISO), intervalValue?, intervalUnit? (m|h|d)
 */
const downloadSensorData = async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { start, end, intervalValue, intervalUnit } = req.query;

        const result = await fetchSensorHistory({
            deviceId,
            start,
            end,
            intervalValue,
            intervalUnit,
            includeSummary: false,
            maxRows: null,
        });

        if (!result.ok) {
            return res.status(result.status || 500).json({
                success: false,
                message: result.message || "Failed to fetch sensor data",
                historicalStorageAvailable: result.historicalStorageAvailable,
            });
        }

        return res.status(200).json({
            success: true,
            deviceId: result.deviceId,
            deviceType: result.deviceType,
            fields: result.fields,
            interval: result.interval,
            totalUnits: result.totalUnits,
            count: result.count,
            rows: result.rows,
        });
    } catch (err) {
        console.error("sensor download error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Failed to fetch sensor data",
        });
    }
};

module.exports = { downloadSensorData, MONGO_FIELDS_BY_TYPE };
