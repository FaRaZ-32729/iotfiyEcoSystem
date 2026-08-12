/**
 * Agent write tools: Organization / Venue / Device / Team-user CRUD.
 * Mirrors HTTP controller rules (role, permission, ownership, plan limits).
 * Deletes require confirm=true; missing fields return needsFields for the model to ask the user.
 */
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Organization = require("../models/organizationModel");
const Venue = require("../models/venueModel");
const Device = require("../models/deviceModel");
const User = require("../models/userModel");
const { createOrganizationSchema } = require("../validations/organizationValidation");
const {
    createVenueSchema,
    updateVenueSchema,
} = require("../validations/venueValidation");
const {
    createDeviceSchema,
    updateDeviceSchema,
} = require("../validations/deviceValidation");
const { createSubUserSchema } = require("../validations/userValidation");
const sendEmail = require("../services/emailServices");

function isObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function zodError(err) {
    if (err?.name !== "ZodError") return null;
    return {
        error: "Validation failed",
        needsFields: err.issues.map((i) => ({
            field: i.path.join(".") || "unknown",
            message: i.message,
        })),
        instructionForAssistant:
            "Ask the user for the missing/invalid fields listed in needsFields, then retry the tool.",
    };
}

function denyMutate(user) {
    if (user?.role === "admin") {
        return {
            error:
                "Admin cannot create/update/delete organizations, venues, or devices via Eco. Use manager accounts for writes.",
        };
    }
    if (user?.role === "user" && user.permission !== "manage") {
        return {
            error:
                "Your permission is view-only. You cannot create, update, or delete records.",
        };
    }
    if (user?.role === "manager") return null;
    if (user?.role === "user" && user.permission === "manage") return null;
    return { error: "Not allowed to mutate resources." };
}

function denyTeam(user) {
    if (user?.role !== "manager") {
        return {
            error: "Only managers can create, update, or delete team users.",
        };
    }
    return null;
}

function needsConfirm(preview) {
    return {
        needsConfirmation: true,
        preview,
        instructionForAssistant:
            "Show this preview to the user and ask them to confirm. When they confirm, call the same tool again with confirm=true.",
    };
}

function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveBillingUser(user) {
    if (user.role === "user" && user.creatorId) {
        return User.findById(user.creatorId).populate({
            path: "currentSubscription",
            populate: { path: "plan" },
        });
    }
    return User.findById(user._id).populate({
        path: "currentSubscription",
        populate: { path: "plan" },
    });
}

async function assertPlanAllows(user, resourceType) {
    const billing = await resolveBillingUser(user);
    if (!billing) return { error: "Billing account not found." };
    if (!billing.currentSubscription) {
        return {
            error: "No active subscription. Please select/renew a plan first.",
        };
    }
    const sub = billing.currentSubscription;
    if (sub.status !== "active") {
        return {
            error: `Subscription is ${sub.status}. Please renew before creating more.`,
        };
    }
    const plan = sub.plan;
    if (!plan) return { error: "Subscription plan details not found." };

    let used = 0;
    let max = 0;
    const ownerId = billing._id;

    if (resourceType === "organization") {
        used = await Organization.countDocuments({ owner: ownerId });
        max = plan.maxOrganizations;
    } else if (resourceType === "venue") {
        const orgIds = (
            await Organization.find({ owner: ownerId }).select("_id").lean()
        ).map((o) => o._id);
        used = await Venue.countDocuments({ organization: { $in: orgIds } });
        max = plan.maxVenues;
    } else if (resourceType === "device") {
        const orgIds = (
            await Organization.find({ owner: ownerId }).select("_id").lean()
        ).map((o) => o._id);
        const venueIds = (
            await Venue.find({ organization: { $in: orgIds } }).select("_id").lean()
        ).map((v) => v._id);
        used = await Device.countDocuments({ venue: { $in: venueIds } });
        max = plan.maxDevices;
    } else if (resourceType === "user") {
        used = await User.countDocuments({
            creatorId: ownerId,
            role: "user",
        });
        max = plan.maxUsers || 10;
    }

    if (used >= max) {
        return {
            error: `Plan limit reached for ${resourceType}: ${used}/${max}. Upgrade or remove unused items.`,
            usage: { used, total: max, remaining: 0 },
        };
    }
    return { ok: true, billing, plan, usage: { used, total: max, remaining: max - used } };
}

async function resolveOrganization(user, { organizationId, organizationName }) {
    if (organizationId) {
        if (!isObjectId(organizationId)) {
            return { error: "Invalid organizationId." };
        }
        const org = await Organization.findById(organizationId);
        if (!org) return { error: "Organization not found." };
        return { org };
    }
    if (organizationName) {
        const q = { name: new RegExp(`^${escapeRegex(organizationName)}$`, "i") };
        if (user.role === "manager") q.owner = user._id;
        else if (user.role === "user") {
            q._id = { $in: user.organizations || [] };
        }
        const matches = await Organization.find(q).limit(5);
        if (!matches.length) return { error: `No organization named "${organizationName}".` };
        if (matches.length > 1) {
            return {
                error: "Multiple organizations match that name. Ask for organizationId.",
                matches: matches.map((o) => ({ id: String(o._id), name: o.name })),
            };
        }
        return { org: matches[0] };
    }
    return {
        error: "Provide organizationId or organizationName.",
        needsFields: [{ field: "organizationName", message: "Organization name or id required" }],
        instructionForAssistant:
            "Ask which organization (name is fine). You can call listMyOrganizations first.",
    };
}

async function resolveVenue(user, { venueId, venueName, organizationId }) {
    if (venueId) {
        if (!isObjectId(venueId)) return { error: "Invalid venueId." };
        const venue = await Venue.findById(venueId).populate("organization", "name owner");
        if (!venue) return { error: "Venue not found." };
        return { venue };
    }
    if (venueName) {
        const q = { name: new RegExp(`^${escapeRegex(venueName)}$`, "i") };
        if (organizationId && isObjectId(organizationId)) {
            q.organization = organizationId;
        }
        let matches = await Venue.find(q).populate("organization", "name owner").limit(8);
        if (user.role === "manager") {
            matches = matches.filter(
                (v) => String(v.organization?.owner) === String(user._id)
            );
        } else if (user.role === "user") {
            const allowed = new Set(
                (user.venues || []).map((v) => String(v.venueId))
            );
            matches = matches.filter((v) => allowed.has(String(v._id)));
        }
        if (!matches.length) return { error: `No venue named "${venueName}" in your access.` };
        if (matches.length > 1) {
            return {
                error: "Multiple venues match. Ask for venueId or organizationName.",
                matches: matches.map((v) => ({
                    id: String(v._id),
                    name: v.name,
                    organization: v.organization?.name,
                })),
            };
        }
        return { venue: matches[0] };
    }
    return {
        error: "Provide venueId or venueName.",
        needsFields: [{ field: "venueName", message: "Venue name or id required" }],
        instructionForAssistant: "Ask which venue. Call listMyVenues if helpful.",
    };
}

async function userCanUseOrganization(user, org) {
    if (!org) return false;
    if (user.role === "manager") return String(org.owner) === String(user._id);
    if (user.role === "user") {
        return (user.organizations || []).some((id) => String(id) === String(org._id));
    }
    return false;
}

async function userOwnsOrganization(user, org) {
    return user.role !== "admin" && String(org.owner) === String(user._id);
}

// ─── Organization ───────────────────────────────────────────────────────────

async function createOrganization(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const name = String(args.name || "").trim();
    if (!name) {
        return {
            error: "Organization name is required.",
            needsFields: [{ field: "name", message: "At least 3 characters" }],
            instructionForAssistant: "Ask the user for the organization name, then retry.",
        };
    }

    try {
        createOrganizationSchema.parse({ name });
    } catch (err) {
        return zodError(err) || { error: err.message };
    }

    const limit = await assertPlanAllows(user, "organization");
    if (limit.error) return limit;

    const existing = await Organization.findOne({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        owner: user._id,
    });
    if (existing) {
        return { error: "You already have an organization with this name." };
    }

    const organization = await Organization.create({
        name,
        owner: user._id,
    });
    await User.findByIdAndUpdate(user._id, {
        $addToSet: { organizations: organization._id },
    });

    return {
        success: true,
        message: "Organization created successfully.",
        organization: {
            id: String(organization._id),
            name: organization.name,
        },
    };
}

async function updateOrganization(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const resolved = await resolveOrganization(user, args);
    if (resolved.error) return resolved;
    const { org } = resolved;

    if (!(await userOwnsOrganization(user, org))) {
        return {
            error:
                "Only the organization owner can rename it. Managers own their orgs; manage-users can only rename orgs they themselves created.",
        };
    }

    const name = String(args.newName || args.name || "").trim();
    if (!name) {
        return {
            error: "Provide newName (the new organization name).",
            needsFields: [{ field: "newName", message: "Required" }],
            instructionForAssistant: "Ask what the new organization name should be.",
        };
    }
    if (name.toLowerCase() === String(org.name).toLowerCase()) {
        return { error: "New name is the same as the current name." };
    }

    const dup = await Organization.findOne({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        owner: org.owner,
        _id: { $ne: org._id },
    });
    if (dup) return { error: "You already have an organization with this name." };

    org.name = name;
    await org.save();
    return {
        success: true,
        message: "Organization name updated.",
        organization: { id: String(org._id), name: org.name },
    };
}

async function deleteOrganization(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const resolved = await resolveOrganization(user, args);
    if (resolved.error) return resolved;
    const { org } = resolved;

    if (!(await userOwnsOrganization(user, org))) {
        return { error: "Only the organization owner can delete it." };
    }

    const venues = await Venue.find({ organization: org._id }).select("_id name").lean();
    const venueIds = venues.map((v) => v._id);
    const deviceCount = await Device.countDocuments({ venue: { $in: venueIds } });

    if (args.confirm !== true && args.confirm !== "true") {
        return needsConfirm({
            action: "deleteOrganization",
            organization: { id: String(org._id), name: org.name },
            willAlsoDelete: {
                venues: venues.length,
                devices: deviceCount,
                venueNames: venues.map((v) => v.name),
            },
            warning: "This permanently deletes the organization and all its venues & devices.",
        });
    }

    await Device.deleteMany({ venue: { $in: venueIds } });
    await Venue.deleteMany({ organization: org._id });
    await User.updateMany(
        { organizations: org._id },
        { $pull: { organizations: org._id } }
    );
    await Organization.findByIdAndDelete(org._id);

    return {
        success: true,
        message: "Organization and related venues/devices deleted.",
        deleted: {
            organizationId: String(org._id),
            venues: venues.length,
            devices: deviceCount,
        },
    };
}

// ─── Venue ──────────────────────────────────────────────────────────────────

async function createVenue(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const name = String(args.name || "").trim();
    const resolved = await resolveOrganization(user, args);
    if (resolved.error) {
        if (!name) {
            return {
                error: "Venue name and organization are required.",
                needsFields: [
                    { field: "name", message: "Venue name" },
                    { field: "organizationName", message: "Which organization" },
                ],
                instructionForAssistant:
                    "Ask for venue name and which organization it belongs to.",
            };
        }
        return resolved;
    }
    if (!name) {
        return {
            error: "Venue name is required.",
            needsFields: [{ field: "name", message: "Required" }],
            instructionForAssistant: "Ask for the venue name.",
        };
    }

    const { org } = resolved;
    if (!(await userCanUseOrganization(user, org))) {
        return { error: "You can only create venues in organizations you have access to." };
    }

    try {
        createVenueSchema.parse({
            name,
            organization: String(org._id),
        });
    } catch (err) {
        return zodError(err) || { error: err.message };
    }

    const limit = await assertPlanAllows(user, "venue");
    if (limit.error) return limit;

    const existing = await Venue.findOne({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        organization: org._id,
    });
    if (existing) {
        return { error: "A venue with this name already exists in that organization." };
    }

    const venue = await Venue.create({
        name,
        description: args.description || undefined,
        organization: org._id,
        createdBy: user._id,
    });

    return {
        success: true,
        message: "Venue created successfully.",
        venue: {
            id: String(venue._id),
            name: venue.name,
            organizationId: String(org._id),
            organizationName: org.name,
        },
    };
}

async function updateVenue(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    // Identify the venue first (do not treat target-org args as identity filters)
    const resolved = await resolveVenue(user, {
        venueId: args.venueId,
        venueName: args.venueName,
        organizationId: args.currentOrganizationId,
    });
    if (resolved.error) return resolved;
    const { venue } = resolved;

    const currentOrg = await Organization.findById(
        venue.organization?._id || venue.organization
    );
    if (!currentOrg) return { error: "Organization not found for this venue." };

    // Mirror API: only organization owner can update (managers typically)
    if (!(await userOwnsOrganization(user, currentOrg))) {
        return {
            error:
                "Only the organization owner can edit this venue (rename or move). Manage sub-users who do not own the org cannot edit venues — same as the Edit Venue API.",
        };
    }

    const newName =
        args.newName != null
            ? String(args.newName).trim()
            : args.name != null
              ? String(args.name).trim()
              : undefined;
    const description =
        args.description !== undefined ? args.description : undefined;

    // Target org for move (same as Edit Venue → organization dropdown)
    let targetOrg = null;
    const explicitNewOrgId = args.newOrganizationId || null;
    const explicitNewOrgName = args.newOrganizationName || null;
    const maybeMoveOrgId =
        args.organizationId &&
        String(args.organizationId) !== String(currentOrg._id)
            ? args.organizationId
            : null;
    const maybeMoveOrgName =
        args.organizationName &&
        String(args.organizationName).toLowerCase() !==
            String(currentOrg.name).toLowerCase()
            ? args.organizationName
            : null;

    if (
        explicitNewOrgId ||
        explicitNewOrgName ||
        maybeMoveOrgId ||
        maybeMoveOrgName
    ) {
        const orgRes = await resolveOrganization(user, {
            organizationId: explicitNewOrgId || maybeMoveOrgId || undefined,
            organizationName: explicitNewOrgName || maybeMoveOrgName || undefined,
        });
        if (orgRes.error) {
            return {
                ...orgRes,
                instructionForAssistant:
                    "Ask which organization to move the venue into (name is fine). Call listMyOrganizations if needed, then retry updateVenue with newOrganizationName or newOrganizationId.",
            };
        }
        targetOrg = orgRes.org;
        if (!(await userOwnsOrganization(user, targetOrg))) {
            return {
                error:
                    "You can only move a venue into an organization you own.",
            };
        }
    }

    if (
        newName === undefined &&
        description === undefined &&
        !targetOrg
    ) {
        return {
            error:
                "Provide newName, description, and/or newOrganizationName (to move the venue — same as Edit Venue).",
            needsFields: [
                { field: "newName", message: "Optional rename" },
                {
                    field: "newOrganizationName",
                    message: "Optional — move venue to another org you own",
                },
            ],
            instructionForAssistant:
                "Venue edit supports rename AND switching organization (like the UI). Ask what to change, then call updateVenue.",
        };
    }

    try {
        updateVenueSchema.parse({
            name: newName,
            description,
            organization: targetOrg ? String(targetOrg._id) : undefined,
        });
    } catch (err) {
        return zodError(err) || { error: err.message };
    }

    const finalOrgId = targetOrg ? targetOrg._id : currentOrg._id;

    if (newName) {
        const dup = await Venue.findOne({
            name: new RegExp(`^${escapeRegex(newName)}$`, "i"),
            organization: finalOrgId,
            _id: { $ne: venue._id },
        });
        if (dup) {
            return {
                error:
                    "A venue with this name already exists in the target organization.",
            };
        }
        venue.name = newName;
    } else if (targetOrg) {
        // Moving with same name — still check uniqueness in target org
        const dup = await Venue.findOne({
            name: new RegExp(`^${escapeRegex(venue.name)}$`, "i"),
            organization: finalOrgId,
            _id: { $ne: venue._id },
        });
        if (dup) {
            return {
                error:
                    "A venue with this name already exists in the target organization. Rename it or pick another org.",
            };
        }
    }

    if (description !== undefined) venue.description = description;
    if (targetOrg) venue.organization = targetOrg._id;
    await venue.save();

    return {
        success: true,
        message: targetOrg
            ? "Venue updated (including organization move)."
            : "Venue updated.",
        venue: {
            id: String(venue._id),
            name: venue.name,
            organizationId: String(venue.organization),
            organizationName: targetOrg ? targetOrg.name : currentOrg.name,
            movedOrganization: Boolean(targetOrg),
        },
        instructionForAssistant:
            "Confirm the change to the user. Organization switch IS supported — same as Edit Venue in the UI.",
    };
}

async function deleteVenue(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const resolved = await resolveVenue(user, args);
    if (resolved.error) return resolved;
    const { venue } = resolved;

    const org = await Organization.findById(
        venue.organization?._id || venue.organization
    );
    if (!org) return { error: "Organization not found." };
    if (!(await userOwnsOrganization(user, org))) {
        return { error: "Only the organization owner can delete this venue." };
    }

    const deviceCount = await Device.countDocuments({ venue: venue._id });
    if (args.confirm !== true && args.confirm !== "true") {
        return needsConfirm({
            action: "deleteVenue",
            venue: { id: String(venue._id), name: venue.name },
            willAlsoDelete: { devices: deviceCount },
            warning: "All devices in this venue will be deleted permanently.",
        });
    }

    await Device.deleteMany({ venue: venue._id });
    await User.updateMany(
        { "venues.venueId": venue._id },
        { $pull: { venues: { venueId: venue._id } } }
    );
    await Venue.findByIdAndDelete(venue._id);

    return {
        success: true,
        message: "Venue and its devices deleted.",
        deleted: { venueId: String(venue._id), devices: deviceCount },
    };
}

// ─── Device ─────────────────────────────────────────────────────────────────

function generateApiKey(deviceId) {
    return Buffer.from(String(deviceId)).toString("base64");
}

async function generateDeviceId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    while (true) {
        let deviceId = "";
        for (let i = 0; i < 6; i++) {
            deviceId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (!(await Device.findOne({ deviceId }))) return deviceId;
    }
}

async function createDevice(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const missing = [];
    if (!args.deviceName) missing.push({ field: "deviceName", message: "Required" });
    if (!args.deviceType) missing.push({ field: "deviceType", message: "OD|THD|AQID|GLD|ED|AC|SMD|WLD" });
    if (!args.category) missing.push({ field: "category", message: "monitoring|scheduling|trigger" });
    if (!args.venueId && !args.venueName) {
        missing.push({ field: "venueName", message: "Venue name or venueId" });
    }
    if (missing.length) {
        return {
            error: "Missing required fields to create a device.",
            needsFields: missing,
            instructionForAssistant:
                "Ask for deviceName, deviceType, category, and venue. For AC also ask brandName. For sensors ask threshold conditions (type, operator, value). Then retry.",
        };
    }

    const venueRes = await resolveVenue(user, args);
    if (venueRes.error) return venueRes;
    const { venue } = venueRes;

    const org = await Organization.findById(
        venue.organization?._id || venue.organization
    );
    if (!org || !(await userCanUseOrganization(user, org))) {
        return { error: "You cannot create devices in this venue." };
    }

    const body = {
        deviceName: String(args.deviceName).trim(),
        venueId: String(venue._id),
        deviceType: String(args.deviceType).toUpperCase(),
        category: String(args.category).toLowerCase(),
        conditions: Array.isArray(args.conditions) ? args.conditions : [],
        interval: args.interval,
        energyMonitoringIncluded: args.energyMonitoringIncluded,
        brandName: args.brandName,
        tempAlertAccess: args.tempAlertAccess,
        humiAlertAccess: args.humiAlertAccess,
        odourAlertAccess: args.odourAlertAccess,
        aqiAlertAccess: args.aqiAlertAccess,
        smokeAlertAccess: args.smokeAlertAccess,
        waterLeakAlertAccess: args.waterLeakAlertAccess,
        glAlertAccess: args.glAlertAccess,
        voltageAlertAccess: args.voltageAlertAccess,
        currentAlertAccess: args.currentAlertAccess,
    };

    let validated;
    try {
        validated = createDeviceSchema.parse(body);
    } catch (err) {
        return zodError(err) || { error: err.message };
    }

    const limit = await assertPlanAllows(user, "device");
    if (limit.error) return limit;

    const existingName = await Device.findOne({
        deviceName: new RegExp(`^${escapeRegex(validated.deviceName)}$`, "i"),
        venue: venue._id,
    });
    if (existingName) {
        return { error: "Device name already exists in this venue." };
    }

    const isAc = validated.deviceType === "AC";
    const isWld = validated.deviceType === "WLD";
    let acBrand = null;
    if (isAc) {
        const { getBrandByName } = require("../services/ackitBrandService");
        acBrand = await getBrandByName(validated.brandName);
        if (!acBrand) {
            return {
                error: "Selected AC brand not found on Ackit.",
                needsFields: [{ field: "brandName", message: "Valid Ackit brand name" }],
            };
        }
    }

    let alertAccessConfig = {};
    if (validated.category === "trigger") {
        alertAccessConfig = {
            tempAlertAccess: !!validated.tempAlertAccess,
            humiAlertAccess: !!validated.humiAlertAccess,
            odourAlertAccess: !!validated.odourAlertAccess,
            aqiAlertAccess: !!validated.aqiAlertAccess,
            smokeAlertAccess: !!validated.smokeAlertAccess,
            waterLeakAlertAccess: !!validated.waterLeakAlertAccess,
            glAlertAccess: !!validated.glAlertAccess,
            voltageAlertAccess: !!validated.voltageAlertAccess,
            currentAlertAccess: !!validated.currentAlertAccess,
        };
    }

    const deviceId = await generateDeviceId();
    const apiKey = generateApiKey(deviceId);
    const acDefaults = isAc
        ? {
              conditions: [],
              brandName: String(acBrand.brandName).toLowerCase(),
              setTemperature: 26,
              acMode: "Cool",
              fanSpeed: "Low",
              acLocked: false,
              acHealthAlert: false,
              energyMonitoringIncluded: validated.energyMonitoringIncluded === true,
          }
        : {};

    const device = await Device.create({
        deviceId,
        deviceName: validated.deviceName,
        deviceType: validated.deviceType,
        category: validated.category,
        venue: venue._id,
        conditions: isAc || isWld ? [] : validated.conditions,
        apiKey,
        ...alertAccessConfig,
        ...acDefaults,
    });

    return {
        success: true,
        message: "Device created successfully.",
        device: {
            id: String(device._id),
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: device.category,
            venueId: String(venue._id),
            venueName: venue.name,
            apiKey: device.apiKey,
        },
        instructionForAssistant:
            "Tell the user the device was created and share deviceId (and apiKey if they need to configure hardware). Do not invent extra fields.",
    };
}

async function updateDevice(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    let device = null;
    if (args.mongoId && isObjectId(args.mongoId)) {
        device = await Device.findById(args.mongoId);
    } else if (args.deviceId) {
        device = await Device.findOne({ deviceId: String(args.deviceId).trim() });
    } else if (args.deviceName) {
        const matches = await Device.find({
            deviceName: new RegExp(`^${escapeRegex(args.deviceName)}$`, "i"),
        }).limit(5);
        if (matches.length > 1) {
            return {
                error: "Multiple devices share this name. Ask for deviceId.",
                matches: matches.map((d) => ({
                    deviceId: d.deviceId,
                    deviceName: d.deviceName,
                    id: String(d._id),
                })),
            };
        }
        device = matches[0] || null;
    }
    if (!device) {
        return {
            error: "Device not found. Provide deviceId or deviceName.",
            needsFields: [{ field: "deviceId", message: "Preferred" }],
        };
    }

    // Access: venue must be accessible
    const venue = await Venue.findById(device.venue).populate("organization", "owner");
    if (!venue) return { error: "Device venue not found." };
    const org = await Organization.findById(
        venue.organization?._id || venue.organization
    );
    if (!org || !(await userCanUseOrganization(user, org))) {
        return { error: "You do not have access to update this device." };
    }

    const patch = {};
    if (args.newDeviceName || args.deviceName) {
        patch.deviceName = String(args.newDeviceName || args.deviceName).trim();
    }
    if (args.venueId || args.venueName) {
        const vr = await resolveVenue(user, args);
        if (vr.error) return vr;
        patch.venueId = String(vr.venue._id);
    }
    if (args.category) patch.category = args.category;
    if (args.deviceType) patch.deviceType = String(args.deviceType).toUpperCase();
    if (args.conditions) patch.conditions = args.conditions;
    if (args.brandName) patch.brandName = args.brandName;
    if (args.interval != null) patch.interval = args.interval;
    if (args.energyMonitoringIncluded != null) {
        patch.energyMonitoringIncluded = args.energyMonitoringIncluded;
    }

    if (!Object.keys(patch).length) {
        return {
            error:
                "Nothing to update. Provide newDeviceName and/or venueName/venueId to move (same as Edit Device).",
            needsFields: [
                { field: "newDeviceName", message: "Optional rename" },
                { field: "venueName", message: "Optional — move device to another venue" },
            ],
            instructionForAssistant:
                "Device edit supports rename AND changing venue. Ask what to change, then retry.",
        };
    }

    let validated;
    try {
        validated = updateDeviceSchema.parse(patch);
    } catch (err) {
        return zodError(err) || { error: err.message };
    }

    if (validated.deviceName) {
        const dup = await Device.findOne({
            deviceName: new RegExp(`^${escapeRegex(validated.deviceName)}$`, "i"),
            venue: validated.venueId || device.venue,
            _id: { $ne: device._id },
        });
        if (dup) return { error: "Another device in this venue already has that name." };
        device.deviceName = validated.deviceName;
    }
    if (validated.venueId) device.venue = validated.venueId;
    if (validated.category) device.category = validated.category;
    if (validated.deviceType) device.deviceType = validated.deviceType;
    if (validated.conditions) device.conditions = validated.conditions;
    if (validated.brandName) device.brandName = String(validated.brandName).toLowerCase();
    if (validated.interval != null) device.interval = validated.interval;
    if (validated.energyMonitoringIncluded != null) {
        device.energyMonitoringIncluded = validated.energyMonitoringIncluded;
    }

    await device.save();
    return {
        success: true,
        message: "Device updated.",
        device: {
            id: String(device._id),
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: device.category,
        },
    };
}

async function deleteDevice(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    let device = null;
    if (args.deviceId) {
        device = await Device.findOne({ deviceId: String(args.deviceId).trim() });
    } else if (args.deviceName) {
        const matches = await Device.find({
            deviceName: new RegExp(`^${escapeRegex(args.deviceName)}$`, "i"),
        }).limit(5);
        if (matches.length > 1) {
            return {
                error: "Multiple devices share this name. Ask for deviceId.",
                matches: matches.map((d) => ({
                    deviceId: d.deviceId,
                    deviceName: d.deviceName,
                })),
            };
        }
        device = matches[0] || null;
    }
    if (!device) {
        return {
            error: "Device not found. Provide deviceId or deviceName.",
            needsFields: [{ field: "deviceId", message: "Preferred" }],
        };
    }

    const venue = await Venue.findById(device.venue);
    const org = venue
        ? await Organization.findById(venue.organization)
        : null;
    if (!org || !(await userCanUseOrganization(user, org))) {
        return { error: "You do not have access to delete this device." };
    }

    if (args.confirm !== true && args.confirm !== "true") {
        return needsConfirm({
            action: "deleteDevice",
            device: {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
            },
            warning: "This permanently deletes the device record.",
        });
    }

    await Device.findByIdAndDelete(device._id);
    return {
        success: true,
        message: "Device deleted.",
        deleted: {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
        },
    };
}

// ─── Team users (manager only) ──────────────────────────────────────────────

async function resolveTeamMember(manager, { userId, email, name }) {
    if (userId && isObjectId(userId)) {
        const u = await User.findById(userId);
        if (!u || u.role !== "user") return { error: "Team user not found." };
        if (String(u.creatorId) !== String(manager._id)) {
            return { error: "You can only manage users you created." };
        }
        return { member: u };
    }
    if (email) {
        const u = await User.findOne({
            email: String(email).toLowerCase().trim(),
            role: "user",
            creatorId: manager._id,
        });
        if (!u) return { error: `No team user with email ${email}.` };
        return { member: u };
    }
    if (name) {
        const matches = await User.find({
            creatorId: manager._id,
            role: "user",
            name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        }).limit(5);
        if (!matches.length) return { error: `No team user named "${name}".` };
        if (matches.length > 1) {
            return {
                error: "Multiple users match. Ask for email or userId.",
                matches: matches.map((u) => ({
                    id: String(u._id),
                    name: u.name,
                    email: u.email,
                })),
            };
        }
        return { member: matches[0] };
    }
    return {
        error: "Provide userId, email, or name of the team user.",
        needsFields: [{ field: "email", message: "Preferred unique id" }],
        instructionForAssistant: "Ask which team user (email is best). Call listMyTeamMembers first.",
    };
}

async function createTeamMember(user, args = {}) {
    const denied = denyTeam(user);
    if (denied) return denied;

    const missing = [];
    if (!args.name) missing.push({ field: "name", message: "Required" });
    if (!args.email) missing.push({ field: "email", message: "Required" });
    if (!args.organizationId && !args.organizationName && !args.organizations?.length) {
        missing.push({
            field: "organizationName",
            message: "At least one organization",
        });
    }
    if (missing.length) {
        return {
            error: "Missing fields to create a team user.",
            needsFields: missing,
            instructionForAssistant:
                "Ask for name, email, permission (view|manage, default view), and which organization(s)/venue(s) to assign. Then retry.",
        };
    }

    let orgIds = Array.isArray(args.organizations) ? args.organizations.map(String) : [];
    if (!orgIds.length) {
        const r = await resolveOrganization(user, args);
        if (r.error) return r;
        orgIds = [String(r.org._id)];
    }

    let venueIds = Array.isArray(args.venues) ? args.venues.map(String) : [];
    if (args.venueId) venueIds.push(String(args.venueId));
    if (args.venueName && !venueIds.length) {
        const vr = await resolveVenue(user, {
            venueName: args.venueName,
            organizationId: orgIds[0],
        });
        if (vr.error) return vr;
        venueIds = [String(vr.venue._id)];
    }

    let validated;
    try {
        validated = createSubUserSchema.parse({
            name: String(args.name).trim(),
            email: String(args.email).toLowerCase().trim(),
            role: "user",
            organizations: orgIds,
            venues: venueIds.length ? venueIds : undefined,
            permission: args.permission || "view",
            timer: args.timer,
        });
    } catch (err) {
        return zodError(err) || { error: err.message };
    }

    const limit = await assertPlanAllows(user, "user");
    if (limit.error) return limit;

    if (await User.findOne({ email: validated.email })) {
        return { error: "Email already exists." };
    }

    const validOrgs = await Organization.find({
        _id: { $in: validated.organizations },
        owner: user._id,
    });
    if (validOrgs.length !== validated.organizations.length) {
        return { error: "You can only assign organizations that you own." };
    }

    let assignedVenues = [];
    if (validated.venues?.length) {
        const validVenues = await Venue.find({
            _id: { $in: validated.venues },
            organization: { $in: validated.organizations },
        });
        if (validVenues.length !== validated.venues.length) {
            return {
                error: "One or more venues are invalid or not in selected organizations.",
            };
        }
        assignedVenues = validVenues.map((v) => ({
            venueId: v._id,
            venueName: v.name,
        }));
    }

    if (!process.env.JWT_SECRET || !process.env.FRONTEND_URL) {
        return { error: "Server misconfiguration (JWT_SECRET / FRONTEND_URL)." };
    }

    let newUser;
    try {
        newUser = await User.create({
            name: validated.name,
            email: validated.email,
            role: "user",
            creatorId: user._id,
            createdBy: "manager",
            organizations: validated.organizations,
            venues: assignedVenues,
            permission: validated.permission,
            timer: validated.timer,
            isActive: false,
            isVerified: false,
        });

        const setupToken = jwt.sign(
            { email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: "24h" }
        );
        newUser.setupToken = setupToken;
        await newUser.save();

        const setupLink = `${process.env.FRONTEND_URL}/setup-password/${setupToken}`;
        await sendEmail(
            newUser.email,
            "Your Account Has Been Created",
            `
            <h2>Account Created</h2>
            <p>Hello ${newUser.name},</p>
            <p>Your account has been created by ${user.name}.</p>
            <a href="${setupLink}">Set Your Password</a>
            `
        );
    } catch (err) {
        if (newUser?._id) await User.findByIdAndDelete(newUser._id);
        return {
            error:
                err.message?.includes("ETIMEDOUT") || /email|smtp/i.test(err.message || "")
                    ? "Invitation email failed. Check SMTP settings."
                    : err.message || "Failed to create team user.",
        };
    }

    return {
        success: true,
        message: "Team user created. Setup link emailed.",
        user: {
            id: String(newUser._id),
            name: newUser.name,
            email: newUser.email,
            permission: newUser.permission,
        },
    };
}

async function updateTeamMember(user, args = {}) {
    const denied = denyTeam(user);
    if (denied) return denied;

    const resolved = await resolveTeamMember(user, args);
    if (resolved.error) return resolved;
    const { member } = resolved;

    let changed = false;

    if (args.organizations || args.organizationId || args.organizationName) {
        let orgIds = Array.isArray(args.organizations)
            ? args.organizations.map(String)
            : [];
        if (!orgIds.length) {
            const r = await resolveOrganization(user, args);
            if (r.error) return r;
            orgIds = [String(r.org._id)];
        }
        const validOrganizations = await Organization.find({
            _id: { $in: orgIds },
            owner: user._id,
        });
        if (validOrganizations.length !== orgIds.length) {
            return { error: "One or more organizations are invalid." };
        }
        member.organizations = orgIds;
        changed = true;
    }

    if (args.venues || args.venueId || args.venueName) {
        let venueIds = Array.isArray(args.venues) ? args.venues.map(String) : [];
        if (args.venueId) venueIds.push(String(args.venueId));
        if (args.venueName && !venueIds.length) {
            const vr = await resolveVenue(user, {
                venueName: args.venueName,
                organizationId: String(member.organizations?.[0] || ""),
            });
            if (vr.error) return vr;
            venueIds = [String(vr.venue._id)];
        }
        const validVenues = await Venue.find({
            _id: { $in: venueIds },
            organization: { $in: member.organizations },
        });
        if (validVenues.length !== venueIds.length) {
            return { error: "One or more venues are invalid for this user's organizations." };
        }
        member.venues = validVenues.map((v) => ({
            venueId: v._id,
            venueName: v.name,
        }));
        changed = true;
    }

    if (args.permission) {
        if (!["view", "manage"].includes(args.permission)) {
            return { error: "permission must be view or manage." };
        }
        member.permission = args.permission;
        changed = true;
    }

    if (!changed) {
        return {
            error: "Provide organizations, venues, and/or permission to update.",
            needsFields: [
                { field: "permission", message: "view | manage" },
                { field: "organizationName", message: "optional reassignment" },
            ],
            instructionForAssistant: "Ask what to change for this user.",
        };
    }

    await member.save();
    return {
        success: true,
        message: "Team user updated.",
        user: {
            id: String(member._id),
            name: member.name,
            email: member.email,
            permission: member.permission,
            organizations: member.organizations.map(String),
            venues: (member.venues || []).map((v) => v.venueName || String(v.venueId)),
        },
    };
}

async function deleteTeamMember(user, args = {}) {
    const denied = denyTeam(user);
    if (denied) return denied;

    const resolved = await resolveTeamMember(user, args);
    if (resolved.error) return resolved;
    const { member } = resolved;

    if (args.confirm !== true && args.confirm !== "true") {
        return needsConfirm({
            action: "deleteTeamMember",
            user: {
                id: String(member._id),
                name: member.name,
                email: member.email,
                permission: member.permission,
            },
            warning: "This permanently deletes the team user account.",
        });
    }

    await User.findByIdAndDelete(member._id);
    return {
        success: true,
        message: "Team user deleted.",
        deleted: {
            id: String(member._id),
            email: member.email,
            name: member.name,
        },
    };
}

const MUTATION_TOOL_IMPL = {
    createOrganization,
    updateOrganization,
    deleteOrganization,
    createVenue,
    updateVenue,
    deleteVenue,
    createDevice,
    updateDevice,
    deleteDevice,
    createTeamMember,
    updateTeamMember,
    deleteTeamMember,
};

const MUTATION_AGENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "createOrganization",
            description:
                "CREATE an organization for the logged-in manager/manage-user. Ask for name if missing. Checks plan limits.",
            parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateOrganization",
            description:
                "RENAME an organization you own. Prefer organizationId; organizationName ok if unique. Pass newName.",
            parameters: {
                type: "object",
                properties: {
                    organizationId: { type: "string" },
                    organizationName: { type: "string" },
                    newName: { type: "string" },
                    name: { type: "string", description: "Alias for newName" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "deleteOrganization",
            description:
                "DELETE an organization you own (cascades venues+devices). First call without confirm; after user confirms, call again with confirm=true.",
            parameters: {
                type: "object",
                properties: {
                    organizationId: { type: "string" },
                    organizationName: { type: "string" },
                    confirm: { type: "boolean" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createVenue",
            description:
                "CREATE a venue. Need name + organizationId or organizationName. Optional description.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    organizationId: { type: "string" },
                    organizationName: { type: "string" },
                    description: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateVenue",
            description:
                "UPDATE a venue like Edit Venue UI: rename (newName), description, AND/OR move to another organization you own (newOrganizationName or newOrganizationId). Org switch IS supported — never say venues are permanently stuck to one org. Identify venue by venueId or venueName. Org owner only (same as API).",
            parameters: {
                type: "object",
                properties: {
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    currentOrganizationId: {
                        type: "string",
                        description:
                            "Optional disambiguation when resolving venue by name",
                    },
                    newName: { type: "string" },
                    name: { type: "string", description: "Alias for newName" },
                    description: { type: "string" },
                    newOrganizationId: {
                        type: "string",
                        description: "Move venue to this organization id",
                    },
                    newOrganizationName: {
                        type: "string",
                        description: "Move venue to this organization by name",
                    },
                    organizationId: {
                        type: "string",
                        description:
                            "Also accepted as move target when different from current org",
                    },
                    organizationName: {
                        type: "string",
                        description:
                            "Also accepted as move target when different from current org",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "deleteVenue",
            description:
                "DELETE a venue (cascades devices). Org owner only. confirm=true after user confirms.",
            parameters: {
                type: "object",
                properties: {
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    organizationId: { type: "string" },
                    confirm: { type: "boolean" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createDevice",
            description:
                "CREATE a device. Required: deviceName, deviceType (OD|THD|AQID|GLD|ED|AC|SMD|WLD), category (monitoring|scheduling|trigger), venueId or venueName. AC needs brandName. Sensor types need conditions[{type,operator,value}]. Trigger needs at least one *AlertAccess boolean.",
            parameters: {
                type: "object",
                properties: {
                    deviceName: { type: "string" },
                    deviceType: { type: "string" },
                    category: { type: "string" },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    organizationId: { type: "string" },
                    brandName: { type: "string" },
                    conditions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: { type: "string" },
                                operator: { type: "string" },
                                value: { type: "number" },
                            },
                        },
                    },
                    interval: { type: "number" },
                    energyMonitoringIncluded: { type: "boolean" },
                    tempAlertAccess: { type: "boolean" },
                    humiAlertAccess: { type: "boolean" },
                    odourAlertAccess: { type: "boolean" },
                    aqiAlertAccess: { type: "boolean" },
                    smokeAlertAccess: { type: "boolean" },
                    waterLeakAlertAccess: { type: "boolean" },
                    glAlertAccess: { type: "boolean" },
                    voltageAlertAccess: { type: "boolean" },
                    currentAlertAccess: { type: "boolean" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateDevice",
            description:
                "UPDATE a device like Edit Device UI: rename (newDeviceName) and/or move to another venue (venueId/venueName). Prefer deviceId. Venue switch IS supported.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    mongoId: { type: "string" },
                    newDeviceName: { type: "string" },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    organizationId: { type: "string" },
                    category: { type: "string" },
                    deviceType: { type: "string" },
                    brandName: { type: "string" },
                    conditions: { type: "array", items: { type: "object" } },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "deleteDevice",
            description:
                "DELETE a device. Prefer deviceId. confirm=true after user confirms.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    confirm: { type: "boolean" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "createTeamMember",
            description:
                "MANAGER ONLY. Create a sub-user and email setup link. Need name, email, organization(s). Optional venues, permission (view|manage default view).",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    email: { type: "string" },
                    permission: { type: "string" },
                    organizationId: { type: "string" },
                    organizationName: { type: "string" },
                    organizations: { type: "array", items: { type: "string" } },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    venues: { type: "array", items: { type: "string" } },
                    timer: { type: "string" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateTeamMember",
            description:
                "MANAGER ONLY. Update a sub-user's permission / organizations / venues. Identify by userId, email, or name.",
            parameters: {
                type: "object",
                properties: {
                    userId: { type: "string" },
                    email: { type: "string" },
                    name: { type: "string" },
                    permission: { type: "string" },
                    organizationId: { type: "string" },
                    organizationName: { type: "string" },
                    organizations: { type: "array", items: { type: "string" } },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    venues: { type: "array", items: { type: "string" } },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "deleteTeamMember",
            description:
                "MANAGER ONLY. Delete a sub-user. confirm=true after user confirms. Identify by userId, email, or name.",
            parameters: {
                type: "object",
                properties: {
                    userId: { type: "string" },
                    email: { type: "string" },
                    name: { type: "string" },
                    confirm: { type: "boolean" },
                },
            },
        },
    },
];

module.exports = {
    MUTATION_TOOL_IMPL,
    MUTATION_AGENT_TOOLS,
};
