/**
 * Shared historical sensor fetch (Download Modal + Eco agent).
 */
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
    TD: ["temperature", "humidity"],
    AQID: ["temperature", "humidity", "AQI"],
    SMD: ["smoke"],
    WLD: ["waterLeak"],
    GLD: ["temperature", "humidity", "gass"],
    GD: ["temperature", "humidity", "gass"],
    ED: ["temperature", "humidity", "voltage", "current"],
    AC: ["temperature", "current", "voltage"],
};

/** Map UI / shorthand types onto cluster keys used in multiDBs */
const CLUSTER_TYPE_ALIAS = {
    TD: "THD",
    GD: "GLD",
};

const BOOLEAN_FIELDS = new Set(["waterLeak"]);

function resolveClusterType(deviceType) {
    const t = String(deviceType || "").toUpperCase();
    return CLUSTER_TYPE_ALIAS[t] || t;
}

function buildGroupAccumulators(fields) {
    const group = { _id: "$_bucket" };
    for (const f of fields) {
        if (BOOLEAN_FIELDS.has(f)) {
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

function summarizeRows(rows, fields) {
    const summary = {};
    for (const f of fields) {
        if (BOOLEAN_FIELDS.has(f)) {
            const trues = rows.filter((r) => r[f] === true || r[f] === 1).length;
            summary[f] = {
                trueCount: trues,
                falseCount: rows.length - trues,
                samples: rows.length,
            };
            continue;
        }
        const vals = rows.map((r) => Number(r[f])).filter(Number.isFinite);
        if (!vals.length) {
            summary[f] = null;
            continue;
        }
        summary[f] = {
            avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
            min: +Math.min(...vals).toFixed(2),
            max: +Math.max(...vals).toFixed(2),
            samples: vals.length,
        };
    }
    return summary;
}

function enrichEdRows(rows) {
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
        if (dtHours <= 0 || dtHours > 6) continue;
        const prevP = Number(rows[i - 1].power);
        if (!Number.isFinite(prevP)) continue;
        kWh += ((prevP + power) / 2 / 1000) * dtHours;
    }
    return +kWh.toFixed(4);
}

/**
 * @param {object} opts
 * @param {string} opts.deviceId
 * @param {Date|string} opts.start
 * @param {Date|string} opts.end
 * @param {number|string} [opts.intervalValue]
 * @param {string} [opts.intervalUnit] m|h|d
 * @param {boolean} [opts.includeSummary=true]
 * @param {number} [opts.maxRows] cap returned rows (null = all)
 */
async function fetchSensorHistory(opts = {}) {
    const {
        deviceId,
        start,
        end,
        intervalValue,
        intervalUnit,
        includeSummary = true,
        maxRows = null,
    } = opts;

    if (!deviceId) {
        return { ok: false, status: 400, message: "deviceId is required" };
    }
    if (!start || !end) {
        return {
            ok: false,
            status: 400,
            message: "start and end ISO timestamps are required",
        };
    }

    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return { ok: false, status: 400, message: "Invalid start/end date" };
    }
    if (endDate < startDate) {
        return { ok: false, status: 400, message: "end must be after start" };
    }

    const device = await Device.findOne({ deviceId })
        .select("deviceId deviceType deviceName")
        .lean();
    if (!device) {
        return { ok: false, status: 404, message: "Device not found" };
    }

    const deviceType = String(device.deviceType || "").toUpperCase();
    const fields = MONGO_FIELDS_BY_TYPE[deviceType] || MONGO_FIELDS_BY_TYPE[resolveClusterType(deviceType)];
    if (!fields) {
        return {
            ok: false,
            status: 400,
            message: `Sensor history not configured for deviceType ${deviceType}`,
            historicalStorageAvailable: false,
        };
    }

    const clusterType = resolveClusterType(deviceType);
    const SensorModel = sensorModel(clusterType);
    if (!SensorModel) {
        return {
            ok: false,
            status: 503,
            historicalStorageAvailable: false,
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType,
            message: `Historical sensor data is not being stored for ${deviceType} devices yet (database cluster URL not configured). Latest live reading may still be available via getDeviceSnapshot.`,
            hintForAssistant:
                "Politely tell the user you can share the latest live/updated reading for this device, but day-to-day historical series is not stored for this type yet. Offer getDeviceSnapshot. Do not invent past numbers.",
        };
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
            return {
                ok: false,
                status: 400,
                message: "intervalValue must be a positive integer",
            };
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
    let rows = rawRows.map((r) => roundNumericRow(r, fields));

    let totalUnits = null;
    if (deviceType === "ED" || clusterType === "ED") {
        totalUnits = enrichEdRows(rows);
        if (!fields.includes("power")) {
            /* power is computed on rows only */
        }
    }

    const summaryFields =
        deviceType === "ED" || clusterType === "ED"
            ? [...fields, "power"]
            : fields;
    const summary = includeSummary ? summarizeRows(rows, summaryFields) : null;

    const totalCount = rows.length;
    let truncated = false;
    if (maxRows != null && Number.isFinite(maxRows) && rows.length > maxRows) {
        truncated = true;
        // evenly sample for the assistant instead of only first N
        const step = Math.ceil(rows.length / maxRows);
        const sampled = [];
        for (let i = 0; i < rows.length && sampled.length < maxRows; i += step) {
            sampled.push(rows[i]);
        }
        if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
            sampled[sampled.length - 1] = rows[rows.length - 1];
        }
        rows = sampled;
    }

    return {
        ok: true,
        status: 200,
        historicalStorageAvailable: true,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType,
        fields,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        interval: useInterval
            ? { value: Number(intervalValue), unit: intervalUnit, ms: intervalMs }
            : null,
        totalUnits,
        count: totalCount,
        returnedRowCount: rows.length,
        truncated,
        summary,
        rows,
    };
}

module.exports = {
    fetchSensorHistory,
    MONGO_FIELDS_BY_TYPE,
    UNIT_TO_MONGO,
    resolveClusterType,
};
