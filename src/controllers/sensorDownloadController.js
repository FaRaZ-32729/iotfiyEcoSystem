// src/controllers/sensorDownloadController.js
const Device = require("../models/deviceModel");
const sensorModel = require("../models/sensorModel");

const UNIT_TO_MONGO = {
    m: "minute",
    h: "hour",
    d: "day",
};

/** Fields we can pull / aggregate from Mongo timeseries per device type */
const MONGO_FIELDS_BY_TYPE = {
    OD: ["temperature", "humidity", "odour"],
    THD: ["temperature", "humidity"],
    AQID: ["temperature", "humidity", "AQI"],
    SMD: ["smoke"],
    WLD: ["waterLeak"],
    GLD: ["temperature", "humidity", "gass"],
    ED: ["temperature", "humidity", "voltage", "current"],
    AC: ["temperature", "current", "voltage"],
};

const BOOLEAN_FIELDS = new Set(["waterLeak"]);

function buildGroupAccumulators(fields) {
    const group = {
        _id: "$_bucket",
    };
    for (const f of fields) {
        if (BOOLEAN_FIELDS.has(f)) {
            // true if any reading in bucket was leak
            group[f] = { $max: { $cond: [`$${f}`, 1, 0] } };
        } else {
            group[f] = { $avg: `$${f}` };
        }
    }
    return group;
}

function roundNumericRow(row, fields) {
    const out = { time: row.time };
    for (const f of fields) {
        const v = row[f];
        if (v === undefined || v === null || v === "") {
            out[f] = null;
            continue;
        }
        if (BOOLEAN_FIELDS.has(f)) {
            out[f] = v === true || v === 1 || v === "1";
            continue;
        }
        const n = Number(v);
        out[f] = Number.isFinite(n) ? +n.toFixed(2) : v;
    }
    return out;
}

/**
 * GET /device/:deviceId/sensor-download
 * Query: start, end (ISO), intervalValue?, intervalUnit? (m|h|d)
 */
const downloadSensorData = async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { start, end, intervalValue, intervalUnit } = req.query;

        if (!deviceId) {
            return res.status(400).json({ success: false, message: "deviceId is required" });
        }
        if (!start || !end) {
            return res.status(400).json({
                success: false,
                message: "start and end ISO timestamps are required",
            });
        }

        const startDate = new Date(start);
        const endDate = new Date(end);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({ success: false, message: "Invalid start/end date" });
        }
        if (endDate < startDate) {
            return res.status(400).json({
                success: false,
                message: "end must be after start",
            });
        }

        const device = await Device.findOne({ deviceId }).select("deviceId deviceType deviceName");
        if (!device) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        const deviceType = String(device.deviceType || "").toUpperCase();
        const fields = MONGO_FIELDS_BY_TYPE[deviceType];
        if (!fields) {
            return res.status(400).json({
                success: false,
                message: `Sensor download not configured for deviceType ${deviceType}`,
            });
        }

        const SensorModel = sensorModel(deviceType);
        if (!SensorModel) {
            return res.status(503).json({
                success: false,
                message: `No Mongo cluster configured for ${deviceType}. Add MONGODB_${deviceType}_URL and restart.`,
            });
        }

        const useInterval =
            intervalValue != null &&
            String(intervalValue).trim() !== "" &&
            intervalUnit &&
            UNIT_TO_MONGO[intervalUnit];

        let intervalMs = null;
        let pipeline;

        if (useInterval) {
            const binSize = parseInt(intervalValue, 10);
            if (!Number.isInteger(binSize) || binSize <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "intervalValue must be a positive integer",
                });
            }

            const unit = UNIT_TO_MONGO[intervalUnit];
            if (unit === "minute") intervalMs = binSize * 60 * 1000;
            else if (unit === "hour") intervalMs = binSize * 3600 * 1000;
            else intervalMs = binSize * 86400 * 1000;

            const group = buildGroupAccumulators(fields);
            pipeline = [
                {
                    $match: {
                        deviceId,
                        timestamp: { $gte: startDate, $lte: endDate },
                    },
                },
                {
                    $addFields: {
                        _bucket: {
                            $dateTrunc: {
                                date: "$timestamp",
                                unit,
                                binSize,
                            },
                        },
                    },
                },
                { $group: group },
                { $sort: { _id: 1 } },
                {
                    $project: {
                        _id: 0,
                        time: "$_id",
                        ...Object.fromEntries(fields.map((f) => [f, `$${f}`])),
                    },
                },
            ];
        } else {
            pipeline = [
                {
                    $match: {
                        deviceId,
                        timestamp: { $gte: startDate, $lte: endDate },
                    },
                },
                { $sort: { timestamp: 1 } },
                {
                    $project: {
                        _id: 0,
                        time: "$timestamp",
                        ...Object.fromEntries(fields.map((f) => [f, `$${f}`])),
                    },
                },
            ];
        }

        const rawRows = await SensorModel.aggregate(pipeline);
        const rows = rawRows.map((r) => roundNumericRow(r, fields));

        // ED: compute power + approximate kWh from successive samples
        let totalUnits = null;
        if (deviceType === "ED") {
            let kWh = 0;
            for (let i = 0; i < rows.length; i++) {
                const v = Number(rows[i].voltage);
                const c = Number(rows[i].current);
                const power =
                    Number.isFinite(v) && Number.isFinite(c) ? +(v * c).toFixed(2) : null;
                rows[i].power = power;

                if (power == null || i === 0) continue;
                const t0 = new Date(rows[i - 1].time).getTime();
                const t1 = new Date(rows[i].time).getTime();
                let dtHours = (t1 - t0) / 3600000;
                if (dtHours <= 0) continue;
                // Cap absurd gaps (same idea as AC energy)
                if (dtHours > 6) continue;
                const prevP = Number(rows[i - 1].power);
                if (!Number.isFinite(prevP)) continue;
                kWh += ((prevP + power) / 2 / 1000) * dtHours;
            }
            totalUnits = +kWh.toFixed(4);
        }

        return res.status(200).json({
            success: true,
            deviceId: device.deviceId,
            deviceType,
            fields,
            interval: useInterval
                ? { value: Number(intervalValue), unit: intervalUnit, ms: intervalMs }
                : null,
            totalUnits,
            count: rows.length,
            rows,
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
