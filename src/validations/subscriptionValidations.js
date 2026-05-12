// src/validations/subscription.validation.js
const z = require("zod");

const createPlanSchema = z.object({
    name: z.enum(["free", "basic", "premium", "custom"]),
    displayName: z.string().min(3),
    description: z.string().min(10),
    price: z.number().min(0),
    durationDays: z.number().positive(),
    maxOrganizations: z.number().positive(),
    maxVenues: z.number().positive(),
    maxDevices: z.number().positive(),
    features: z.array(z.string()).optional(),
    recommended: z.boolean().optional()
});

const purchaseSubscriptionSchema = z.object({
    planId: z.string().min(1)
});

module.exports = {
    createPlanSchema,
    purchaseSubscriptionSchema
};