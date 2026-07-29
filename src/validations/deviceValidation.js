// src/validations/deviceValidation.js
const { z } = require("zod");

const conditionSchema = z.object({
    type: z.enum(["temperature", "humidity", "odour", "AQI", "smoke", "waterLeak", "gass", "voltage", "current"]),
    operator: z.enum([">", "<", "="]),
    value: z.number()
});

const deviceTypeEnum = z.enum(["OD", "THD", "AQID", "GLD", "ED", "AC", "SMD", "WLD"]);

// ==================== CREATE DEVICE SCHEMA (Flat Fields) ====================
const createDeviceSchema = z.object({
    deviceName: z.string().min(2).max(100),
    venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID"),
    deviceType: deviceTypeEnum,
    category: z.enum(["monitoring", "scheduling", "trigger"]),
    conditions: z.array(conditionSchema).default([]),
    interval: z.number().min(1).optional(),
    energyMonitoringIncluded: z.boolean().optional(),
    /** AC only — Ackit brand name (unique) */
    brandName: z.string().min(1).max(100).optional(),

    // Flat Alert Access Fields (Recommended)
    tempAlertAccess: z.boolean().optional(),
    humiAlertAccess: z.boolean().optional(),
    odourAlertAccess: z.boolean().optional(),
    aqiAlertAccess: z.boolean().optional(),
    smokeAlertAccess: z.boolean().optional(),
    waterLeakAlertAccess: z.boolean().optional(),
    glAlertAccess: z.boolean().optional(),
    voltageAlertAccess: z.boolean().optional(),
    currentAlertAccess: z.boolean().optional(),
}).superRefine((data, ctx) => {
    validateDeviceConditions(data, ctx);

    if (data.deviceType === "AC" && !data.brandName) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["brandName"],
            message: "brandName is required for AC devices",
        });
    }

    // WLD is monitoring-only
    if (data.deviceType === "WLD" && data.category !== "monitoring") {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["category"],
            message: "Water Leakage Device (WLD) supports monitoring category only",
        });
    }

    // Trigger category hone par kam se kam ek alert access field hona chahiye (optional strictness)
    if (data.category === "trigger") {
        const hasAnyAccess =
            data.tempAlertAccess !== undefined ||
            data.humiAlertAccess !== undefined ||
            data.odourAlertAccess !== undefined ||
            data.aqiAlertAccess !== undefined ||
            data.smokeAlertAccess !== undefined ||
            data.waterLeakAlertAccess !== undefined ||
            data.glAlertAccess !== undefined ||
            data.voltageAlertAccess !== undefined ||
            data.currentAlertAccess !== undefined;

        if (!hasAnyAccess) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["alertAccess"],
                message: "At least one alert access field is required for trigger devices"
            });
        }
    }
});

// ==================== UPDATE DEVICE SCHEMA ====================
const updateDeviceSchema = z.object({
    deviceName: z.string().min(2).max(100).optional(),
    venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID").optional(),
    deviceType: deviceTypeEnum.optional(),
    category: z.enum(["monitoring", "scheduling", "trigger"]).optional(),
    conditions: z.array(conditionSchema).optional(),
    interval: z.number().min(1).optional(),
    energyMonitoringIncluded: z.boolean().optional(),
    brandName: z.string().min(1).max(100).optional(),

    // Flat Alert Access Fields for Update
    tempAlertAccess: z.boolean().optional(),
    humiAlertAccess: z.boolean().optional(),
    odourAlertAccess: z.boolean().optional(),
    aqiAlertAccess: z.boolean().optional(),
    smokeAlertAccess: z.boolean().optional(),
    waterLeakAlertAccess: z.boolean().optional(),
    glAlertAccess: z.boolean().optional(),
    voltageAlertAccess: z.boolean().optional(),
    currentAlertAccess: z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.deviceType || data.conditions) {
        validateDeviceConditions(data, ctx);
    }

    if (data.deviceType === "WLD" && data.category && data.category !== "monitoring") {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["category"],
            message: "Water Leakage Device (WLD) supports monitoring category only",
        });
    }
});

// Helper function
const validateDeviceConditions = (data, ctx) => {
    if (!data.deviceType) return;

    // Required condition types per device. ED temp/humidity are optional (user may leave empty).
    const requiredConditions = {
        OD: ["temperature", "humidity", "odour"],
        THD: ["temperature", "humidity"],
        AQID: ["temperature", "humidity", "AQI"],
        SMD: ["smoke"],
        GLD: ["temperature", "humidity", "gass"],
        ED: ["voltage", "current"],
        // AC / WLD: no threshold conditions — ESP drives alerts directly
        AC: [],
        WLD: [],
    };

    const optionalConditions = {
        ED: ["temperature", "humidity"],
    };

    const required = requiredConditions[data.deviceType] || [];
    const optional = optionalConditions[data.deviceType] || [];
    const allowed = [...required, ...optional];
    const providedTypes = (data.conditions || []).map(c => c.type);

    for (const condition of required) {
        if (!providedTypes.includes(condition)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["conditions"],
                message: `${condition} condition is required for ${data.deviceType}`
            });
        }
    }

    for (const provided of providedTypes) {
        if (!allowed.includes(provided)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["conditions"],
                message: `${provided} is not allowed for ${data.deviceType}`
            });
        }
    }
};

module.exports = {
    createDeviceSchema,
    updateDeviceSchema
};
