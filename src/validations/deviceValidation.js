
// // src/validations/deviceValidation.js
// const { z } = require("zod");

// const conditionSchema = z.object({
//     type: z.enum(["temperature", "humidity", "odour", "AQI", "gass", "voltage", "current"]),
//     operator: z.enum([">", "<", "="]),
//     value: z.number()
// });

// const createDeviceSchema = z.object({
//     deviceName: z.string().min(2).max(100),
//     venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID"),
//     deviceType: z.enum(["OD", "THD", "AQID", "GLD", "ED"]),
//     category: z.enum(["monitoring", "scheduling", "trigger"]),
//     conditions: z.array(conditionSchema),
//     interval: z.number().min(1).optional()
// }).superRefine((data, ctx) => {
//     validateDeviceConditions(data, ctx);
// });

// // ==================== UPDATE SCHEMA (With Smart Validation) ====================
// const updateDeviceSchema = z.object({
//     deviceName: z.string().min(2).max(100).optional(),
//     venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID").optional(),
//     deviceType: z.enum(["OD", "THD", "AQID", "GLD", "ED"]).optional(),
//     category: z.enum(["monitoring", "scheduling", "trigger"]).optional(),
//     conditions: z.array(conditionSchema).optional(),
//     interval: z.number().min(1).optional()
// }).superRefine((data, ctx) => {
//     // Only validate conditions if deviceType OR conditions are being updated
//     if (data.deviceType || data.conditions) {
//         validateDeviceConditions(data, ctx);
//     }
// });

// // Helper function to avoid code duplication
// const validateDeviceConditions = (data, ctx) => {
//     const requiredConditions = {
//         OD: ["temperature", "humidity", "odour"],
//         THD: ["temperature", "humidity"],
//         AQID: ["temperature", "humidity", "AQI"],
//         GLD: ["temperature", "humidity", "gass"],
//         ED: ["temperature", "humidity", "voltage", "current"]
//     };

//     const allowed = requiredConditions[data.deviceType];
//     const providedTypes = (data.conditions || []).map(c => c.type);

//     // Check missing required conditions
//     for (const condition of allowed) {
//         if (!providedTypes.includes(condition)) {
//             ctx.addIssue({
//                 code: z.ZodIssueCode.custom,
//                 path: ["conditions"],
//                 message: `${condition} condition is required for ${data.deviceType}`
//             });
//         }
//     }

//     // Check extra invalid conditions
//     for (const provided of providedTypes) {
//         if (!allowed.includes(provided)) {
//             ctx.addIssue({
//                 code: z.ZodIssueCode.custom,
//                 path: ["conditions"],
//                 message: `${provided} is not allowed for ${data.deviceType}`
//             });
//         }
//     }
// };




// module.exports = { createDeviceSchema, updateDeviceSchema };

// src/validations/deviceValidation.js
const { z } = require("zod");

const conditionSchema = z.object({
    type: z.enum(["temperature", "humidity", "odour", "AQI", "gass", "voltage", "current"]),
    operator: z.enum([">", "<", "="]),
    value: z.number()
});

// ==================== CREATE DEVICE SCHEMA (Flat Fields) ====================
const createDeviceSchema = z.object({
    deviceName: z.string().min(2).max(100),
    venueId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID"),
    deviceType: z.enum(["OD", "THD", "AQID", "GLD", "ED"]),
    category: z.enum(["monitoring", "scheduling", "trigger"]),
    conditions: z.array(conditionSchema),
    interval: z.number().min(1).optional(),

    // Flat Alert Access Fields (Recommended)
    tempAlertAccess: z.boolean().optional(),
    humiAlertAccess: z.boolean().optional(),
    odourAlertAccess: z.boolean().optional(),
    aqiAlertAccess: z.boolean().optional(),
    glAlertAccess: z.boolean().optional(),
    voltageAlertAccess: z.boolean().optional(),
    currentAlertAccess: z.boolean().optional(),
}).superRefine((data, ctx) => {
    validateDeviceConditions(data, ctx);

    // Trigger category hone par kam se kam ek alert access field hona chahiye (optional strictness)
    if (data.category === "trigger") {
        const hasAnyAccess =
            data.tempAlertAccess !== undefined ||
            data.humiAlertAccess !== undefined ||
            data.odourAlertAccess !== undefined ||
            data.aqiAlertAccess !== undefined ||
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
    deviceType: z.enum(["OD", "THD", "AQID", "GLD", "ED"]).optional(),
    category: z.enum(["monitoring", "scheduling", "trigger"]).optional(),
    conditions: z.array(conditionSchema).optional(),
    interval: z.number().min(1).optional(),

    // Flat Alert Access Fields for Update
    tempAlertAccess: z.boolean().optional(),
    humiAlertAccess: z.boolean().optional(),
    odourAlertAccess: z.boolean().optional(),
    aqiAlertAccess: z.boolean().optional(),
    glAlertAccess: z.boolean().optional(),
    voltageAlertAccess: z.boolean().optional(),
    currentAlertAccess: z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.deviceType || data.conditions) {
        validateDeviceConditions(data, ctx);
    }
});

// Helper function
const validateDeviceConditions = (data, ctx) => {
    const requiredConditions = {
        OD: ["temperature", "humidity", "odour"],
        THD: ["temperature", "humidity"],
        AQID: ["temperature", "humidity", "AQI"],
        GLD: ["temperature", "humidity", "gass"],
        ED: ["temperature", "humidity", "voltage", "current"]
    };

    const allowed = requiredConditions[data.deviceType];
    const providedTypes = (data.conditions || []).map(c => c.type);

    for (const condition of allowed) {
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