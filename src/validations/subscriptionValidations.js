// src/validations/subscription.validation.js
const z = require("zod");

const createPlanSchema = z.object({
    name: z.enum(["free", "basic", "premium", "custom"]),
    description: z.string().min(10).optional(),
    price: z.number().min(0),
    durationDays: z.number().positive(),
    maxOrganizations: z.number().positive(),
    maxVenues: z.number().positive(),
    maxDevices: z.number().positive(),
});

const purchaseSubscriptionSchema = z.object({
    planId: z.string().min(1)
});

module.exports = {
    createPlanSchema,
    purchaseSubscriptionSchema
};