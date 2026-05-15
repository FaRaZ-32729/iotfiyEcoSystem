const { z } = require("zod");

const conditionSchema = z.object({
    type: z.enum([
        "temperature",
        "humidity",
        "odour",
        "AQI",
        "gass",
        "voltage",
        "current"
    ]),
    operator: z.enum([">", "<", "="]),
    value: z.number()
});

const createDeviceSchema = z.object({
    deviceName: z.string()
        .min(2, "Device name must be at least 2 characters")
        .max(100, "Device name is too long"),

    venueId: z.string()
        .min(1, "Venue ID is required")
        .regex(/^[0-9a-fA-F]{24}$/, "Invalid Venue ID format"),

    deviceType: z.enum(["OD", "THD", "AQID", "GLD", "ED"]),

    category: z.enum(["monitoring", "scheduling", "trigger"]),

    conditions: z.array(conditionSchema)
})
    .superRefine((data, ctx) => {

        const requiredConditions = {
            OD: ["temperature", "humidity", "odour"],
            THD: ["temperature", "humidity"],
            AQID: ["temperature", "humidity", "AQI"],
            GLD: ["temperature", "humidity", "gass"],
            ED: ["temperature", "humidity", "voltage", "current"]
        };

        const allowed = requiredConditions[data.deviceType];

        const providedTypes = data.conditions.map(c => c.type);

        // Check missing conditions
        for (const condition of allowed) {
            if (!providedTypes.includes(condition)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["conditions"],
                    message: `${condition} condition is required for ${data.deviceType}`
                });
            }
        }

        // Check extra invalid conditions
        for (const provided of providedTypes) {
            if (!allowed.includes(provided)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["conditions"],
                    message: `${provided} is not allowed for ${data.deviceType}`
                });
            }
        }
    });

module.exports = { createDeviceSchema };