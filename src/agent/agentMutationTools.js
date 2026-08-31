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
const Event = require("../models/eventModel");
const TriggerSchedule = require("../models/triggerEventModel");
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

/** Always return a plain id string — never String(populated Mongoose doc). */
function toIdString(value) {
    if (value == null || value === "") return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.startsWith("{") || trimmed.includes("ObjectId(")) return null;
        return trimmed;
    }
    if (typeof value === "object") {
        if (value._id != null) return String(value._id);
        if (value.id != null) return String(value.id);
    }
    const asString = String(value);
    if (asString.startsWith("{") || asString.includes("ObjectId(")) return null;
    return asString;
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

/**
 * Gemini sometimes doubles string args named "name" (e.g. ORG003 → ORG003ORG003).
 * If the whole string is an exact repeat of its first half, keep one copy.
 */
function collapseExactDuplicateName(raw) {
    const str = String(raw ?? "").trim();
    if (str.length < 6 || str.length % 2 !== 0) return str;
    const half = str.length / 2;
    const a = str.slice(0, half);
    const b = str.slice(half);
    if (a && a === b) return a;
    return str;
}

/** Prefer organizationName; fall back to name. Always collapse Gemini double-name bug. */
function readOrgCreateName(args = {}) {
    return collapseExactDuplicateName(
        args.organizationName ?? args.name ?? ""
    );
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
        max = plan.maxUsers;
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

    const name = readOrgCreateName(args);
    if (!name) {
        return {
            error: "Organization name is required.",
            needsFields: [
                {
                    field: "organizationName",
                    message: "At least 3 characters — pass the name exactly once",
                },
            ],
            instructionForAssistant:
                "Ask for the organization name once, then call createOrganization with organizationName set to that exact string (do not concatenate or repeat it).",
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

    const name = collapseExactDuplicateName(args.venueName ?? args.name ?? "");
    const resolved = await resolveOrganization(user, args);
    if (resolved.error) {
        if (!name) {
            return {
                error: "Venue name and organization are required.",
                needsFields: [
                    { field: "venueName", message: "Venue name" },
                    { field: "organizationName", message: "Which organization" },
                ],
                instructionForAssistant:
                    "Ask for venue name and which organization it belongs to. Pass each name exactly once.",
            };
        }
        return resolved;
    }
    if (!name) {
        return {
            error: "Venue name is required.",
            needsFields: [{ field: "venueName", message: "Required" }],
            instructionForAssistant:
                "Ask for the venue name once (do not repeat/concatenate it).",
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

    if (user.role === "user") {
        const alreadyAssigned = (user.venues || []).some(
            (v) => String(v.venueId) === String(venue._id)
        );
        if (!alreadyAssigned) {
            await User.findByIdAndUpdate(user._id, {
                $push: {
                    venues: {
                        venueId: venue._id,
                        venueName: venue.name,
                    },
                },
            });
        }
    }

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

    if (newName) {
        await User.updateMany(
            { "venues.venueId": venue._id },
            { $set: { "venues.$[elem].venueName": venue.name } },
            { arrayFilters: [{ "elem.venueId": venue._id }] }
        );
    }

    const previousOrganizationId = String(currentOrg._id);
    const moved = Boolean(
        targetOrg && String(targetOrg._id) !== previousOrganizationId
    );

    return {
        success: true,
        message: moved
            ? "Venue updated (including organization move)."
            : "Venue updated.",
        venue: {
            id: String(venue._id),
            name: venue.name,
            organizationId: String(finalOrgId),
            organizationName: targetOrg ? targetOrg.name : currentOrg.name,
            movedOrganization: moved,
            // Frontend must refetch BOTH orgs (same as Edit Venue UI)
            ...(moved
                ? { previousOrganizationId }
                : {}),
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

const DEVICE_REQUIRED_CONDITIONS = {
    OD: ["temperature", "humidity", "odour"],
    THD: ["temperature", "humidity"],
    AQID: ["temperature", "humidity", "AQI"],
    SMD: ["smoke"],
    WLD: [],
    GLD: ["temperature", "humidity", "gass"],
    ED: ["current"],
    AC: [],
};

const DEFAULT_ED_VOLTAGE = 225;

function applyTriggerAlertDefaults(deviceType, args = {}) {
    const cfg = {
        tempAlertAccess: false,
        humiAlertAccess: false,
        odourAlertAccess: false,
        aqiAlertAccess: false,
        smokeAlertAccess: false,
        waterLeakAlertAccess: false,
        glAlertAccess: false,
        voltageAlertAccess: false,
        currentAlertAccess: false,
    };
    for (const k of Object.keys(cfg)) {
        if (typeof args[k] === "boolean") cfg[k] = args[k];
    }
    const dt = String(deviceType || "").toUpperCase();
    if (dt === "OD") {
        cfg.aqiAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.glAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    } else if (dt === "THD") {
        cfg.odourAlertAccess = false;
        cfg.aqiAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.glAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    } else if (dt === "AQID") {
        cfg.odourAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.glAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    } else if (dt === "SMD") {
        cfg.tempAlertAccess = false;
        cfg.humiAlertAccess = false;
        cfg.odourAlertAccess = false;
        cfg.aqiAlertAccess = false;
        cfg.glAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    } else if (dt === "WLD") {
        cfg.tempAlertAccess = false;
        cfg.humiAlertAccess = false;
        cfg.odourAlertAccess = false;
        cfg.aqiAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.glAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    } else if (dt === "GLD") {
        cfg.odourAlertAccess = false;
        cfg.aqiAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    } else if (dt === "ED") {
        cfg.odourAlertAccess = false;
        cfg.aqiAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.glAlertAccess = false;
    } else if (dt === "AC") {
        cfg.odourAlertAccess = false;
        cfg.aqiAlertAccess = false;
        cfg.smokeAlertAccess = false;
        cfg.glAlertAccess = false;
        cfg.voltageAlertAccess = false;
        cfg.currentAlertAccess = false;
    }
    return cfg;
}

function normalizeCreateConditions(deviceType, conditions) {
    let list = Array.isArray(conditions) ? [...conditions] : [];
    const dt = String(deviceType || "").toUpperCase();
    if (dt === "AC" || dt === "WLD") return [];
    // Same as Add Device UI: ED voltage defaults to 225 if omitted
    if (dt === "ED" && !list.some((c) => c?.type === "voltage")) {
        list.push({ type: "voltage", operator: "=", value: DEFAULT_ED_VOLTAGE });
    }
    return list;
}

async function createDevice(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const deviceType = args.deviceType
        ? String(args.deviceType).toUpperCase()
        : "";
    const category = args.category ? String(args.category).toLowerCase() : "";

    const missing = [];
    const deviceName = collapseExactDuplicateName(args.deviceName || "");
    if (!deviceName) missing.push({ field: "deviceName", message: "Required" });
    if (!deviceType) {
        missing.push({
            field: "deviceType",
            message: "OD|THD|AQID|GLD|ED|AC|SMD|WLD",
        });
    }
    if (!category) {
        missing.push({
            field: "category",
            message: "monitoring|scheduling|trigger",
        });
    }
    if (!args.venueId && !args.venueName) {
        missing.push({ field: "venueName", message: "Venue name or venueId" });
    }
    if (deviceType === "AC" && !args.brandName) {
        missing.push({ field: "brandName", message: "Required for AC (Ackit brand)" });
    }
    if (deviceType === "WLD" && category && category !== "monitoring") {
        return {
            error: "Water Leakage Device (WLD) supports monitoring category only.",
        };
    }

    const requiredConds = DEVICE_REQUIRED_CONDITIONS[deviceType] || [];
    const providedTypes = (Array.isArray(args.conditions) ? args.conditions : []).map(
        (c) => c?.type
    );
    for (const need of requiredConds) {
        if (!providedTypes.includes(need)) {
            missing.push({
                field: "conditions",
                message: `${need} condition required for ${deviceType} (type, operator >, < or =, value number)`,
            });
        }
    }

    if (missing.length) {
        return {
            error: "Missing required fields to create a device (same as Add Device).",
            needsFields: missing,
            requiredConditionsByType: DEVICE_REQUIRED_CONDITIONS,
            instructionForAssistant:
                "Ask for deviceName, deviceType, category, venue. AC → brandName. Sensors → conditions per requiredConditionsByType. Trigger → which alert accesses to enable (temp/humi/…). Then retry createDevice. ED voltage defaults to 225 if omitted.",
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

    const conditions = normalizeCreateConditions(deviceType, args.conditions);

    // Trigger: default all alert flags false (like UI/API) so validation passes
    const triggerAlerts =
        category === "trigger" ? applyTriggerAlertDefaults(deviceType, args) : {};

    const body = {
        deviceName,
        venueId: String(venue._id),
        deviceType,
        category,
        conditions,
        interval: args.interval,
        energyMonitoringIncluded: args.energyMonitoringIncluded,
        brandName: args.brandName,
        ...triggerAlerts,
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
        alertAccessConfig = applyTriggerAlertDefaults(validated.deviceType, validated);
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
        message: "Device created successfully (same rules as Add Device).",
        device: {
            id: String(device._id),
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: device.category,
            venueId: String(venue._id),
            venueName: venue.name,
            organizationName: org.name,
            apiKey: device.apiKey,
            brandName: device.brandName || null,
            conditions: device.conditions || [],
        },
        instructionForAssistant:
            "Tell the user it was created and share deviceId (and apiKey if they need hardware setup). Do not invent extra fields.",
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

    // Access: current venue must be accessible
    const venue = await Venue.findById(device.venue).populate("organization", "owner");
    if (!venue) return { error: "Device venue not found." };
    const org = await Organization.findById(
        venue.organization?._id || venue.organization
    );
    if (!org || !(await userCanUseOrganization(user, org))) {
        return { error: "You do not have access to update this device." };
    }

    // Capture BEFORE mutating venue (needed for UI refresh of old list)
    const previousVenueId = toIdString(device.venue?._id || device.venue);
    const previousOrganizationId = toIdString(
        org?._id || venue.organization?._id || venue.organization
    );

    // Build patch — same fields as Edit Device modal
    const patch = {};
    // Rename only via newDeviceName (deviceName is identity when finding)
    if (args.newDeviceName) {
        patch.deviceName = String(args.newDeviceName).trim();
    }

    if (args.venueId || args.venueName || args.newVenueId || args.newVenueName) {
        const vr = await resolveVenue(user, {
            venueId: args.newVenueId || args.venueId,
            venueName: args.newVenueName || args.venueName,
            organizationId: args.organizationId || args.newOrganizationId,
        });
        if (vr.error) return vr;
        const newVenue = vr.venue;
        const newOrg = await Organization.findById(
            newVenue.organization?._id || newVenue.organization
        );
        // Mirror API: moving device requires owning the target org
        if (
            user.role !== "admin" &&
            (!newOrg || String(newOrg.owner) !== String(user._id))
        ) {
            return {
                error:
                    "You can only move a device into a venue whose organization you own (same as Edit Device API).",
            };
        }
        if (String(newVenue._id) !== String(device.venue)) {
            patch.venueId = String(newVenue._id);
        }
    }

    if (args.category) patch.category = String(args.category).toLowerCase();
    if (args.deviceType) patch.deviceType = String(args.deviceType).toUpperCase();
    if (args.conditions) patch.conditions = args.conditions;
    if (args.brandName) patch.brandName = args.brandName;
    if (args.interval != null) patch.interval = args.interval;
    if (args.energyMonitoringIncluded != null) {
        patch.energyMonitoringIncluded = args.energyMonitoringIncluded;
    }

    const alertKeys = [
        "tempAlertAccess",
        "humiAlertAccess",
        "odourAlertAccess",
        "aqiAlertAccess",
        "smokeAlertAccess",
        "waterLeakAlertAccess",
        "glAlertAccess",
        "voltageAlertAccess",
        "currentAlertAccess",
    ];
    for (const k of alertKeys) {
        if (typeof args[k] === "boolean") patch[k] = args[k];
    }

    if (!Object.keys(patch).length) {
        return {
            error:
                "Nothing to update. Edit Device supports: rename, move venue, deviceType, category, conditions, AC brandName, energyMonitoringIncluded, trigger alert-access flags.",
            needsFields: [
                { field: "newDeviceName", message: "Rename" },
                { field: "newVenueName", message: "Move to another venue" },
                { field: "category", message: "monitoring | scheduling | trigger" },
                { field: "conditions", message: "Thresholds for sensor devices" },
            ],
            instructionForAssistant:
                "Ask what to change (same options as Edit Device UI), then retry updateDevice. Never invent unsupported limitations.",
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
    if (validated.interval != null) device.interval = validated.interval;
    if (typeof validated.energyMonitoringIncluded === "boolean") {
        device.energyMonitoringIncluded = validated.energyMonitoringIncluded;
    }

    const nextCategory = validated.category || device.category;
    if (nextCategory === "trigger" || device.category === "trigger") {
        for (const k of alertKeys) {
            if (typeof validated[k] === "boolean") device[k] = validated[k];
        }
    }

    const nextType = validated.deviceType || device.deviceType;
    if (nextType === "AC") {
        if (validated.brandName) {
            const { getBrandByName } = require("../services/ackitBrandService");
            const acBrand = await getBrandByName(validated.brandName);
            if (!acBrand) {
                return {
                    error: "Selected AC brand not found on Ackit.",
                    needsFields: [{ field: "brandName", message: "Valid Ackit brand" }],
                };
            }
            device.brandName = String(acBrand.brandName).toLowerCase();
        } else if (!device.brandName) {
            return {
                error: "brandName is required for AC devices.",
                needsFields: [{ field: "brandName", message: "Required for AC" }],
            };
        }
        device.conditions = [];
    } else if (nextType === "WLD") {
        device.conditions = [];
        if (validated.category && validated.category !== "monitoring") {
            return {
                error: "Water Leakage Device (WLD) supports monitoring category only.",
            };
        }
        device.category = "monitoring";
    } else if (validated.deviceType && validated.deviceType !== "AC") {
        device.brandName = null;
    }

    await device.save();

    const newVenueId = toIdString(device.venue?._id || device.venue);
    const movedVenue =
        Boolean(validated.venueId) &&
        previousVenueId &&
        newVenueId &&
        previousVenueId !== newVenueId;

    let newOrganizationId = previousOrganizationId;
    if (movedVenue && validated.venueId) {
        const movedToVenue = await Venue.findById(validated.venueId).select(
            "organization"
        );
        newOrganizationId = toIdString(
            movedToVenue?.organization?._id || movedToVenue?.organization
        );
    }

    return {
        success: true,
        message: movedVenue
            ? "Device updated (including venue / organization move)."
            : "Device updated (same capabilities as Edit Device UI).",
        device: {
            id: String(device._id),
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: device.category,
            venueId: newVenueId,
            brandName: device.brandName || null,
            movedVenue,
            ...(movedVenue
                ? {
                      previousVenueId,
                      previousOrganizationId,
                      organizationId: newOrganizationId,
                  }
                : {}),
        },
        instructionForAssistant:
            "Confirm the update. Device venue move, rename, type/category/conditions/alerts are supported — do not invent limits.",
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
            venueId: toIdString(device.venue?._id || device.venue),
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
            name: collapseExactDuplicateName(args.name),
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

    // Multi-org by id array or names (Edit User = multi-select orgs)
    if (
        args.organizations ||
        args.organizationNames ||
        args.organizationId ||
        args.organizationName
    ) {
        let orgIds = Array.isArray(args.organizations)
            ? args.organizations.map(String)
            : [];

        if (Array.isArray(args.organizationNames) && args.organizationNames.length) {
            for (const n of args.organizationNames) {
                const r = await resolveOrganization(user, { organizationName: n });
                if (r.error) return r;
                orgIds.push(String(r.org._id));
            }
        }

        if (!orgIds.length) {
            const r = await resolveOrganization(user, args);
            if (r.error) return r;
            orgIds = [String(r.org._id)];
        }

        orgIds = [...new Set(orgIds)];
        const validOrganizations = await Organization.find({
            _id: { $in: orgIds },
            owner: user._id,
        });
        if (validOrganizations.length !== orgIds.length) {
            return { error: "One or more organizations are invalid." };
        }
        member.organizations = orgIds;
        changed = true;

        // Like UI: when orgs change, drop venues that no longer belong
        if (!args.venues && !args.venueId && !args.venueName && !args.venueNames) {
            const stillValid = await Venue.find({
                _id: { $in: (member.venues || []).map((v) => v.venueId) },
                organization: { $in: orgIds },
            });
            member.venues = stillValid.map((v) => ({
                venueId: v._id,
                venueName: v.name,
            }));
        }
    }

    if (args.venues || args.venueId || args.venueName || args.venueNames) {
        let venueIds = Array.isArray(args.venues) ? args.venues.map(String) : [];
        if (args.venueId) venueIds.push(String(args.venueId));

        if (Array.isArray(args.venueNames) && args.venueNames.length) {
            for (const n of args.venueNames) {
                const vr = await resolveVenue(user, {
                    venueName: n,
                    organizationId: String(member.organizations?.[0] || ""),
                });
                if (vr.error) return vr;
                venueIds.push(String(vr.venue._id));
            }
        }

        if (args.venueName && !venueIds.length) {
            const vr = await resolveVenue(user, {
                venueName: args.venueName,
                organizationId: String(member.organizations?.[0] || ""),
            });
            if (vr.error) return vr;
            venueIds = [String(vr.venue._id)];
        }

        venueIds = [...new Set(venueIds)];
        const validVenues = await Venue.find({
            _id: { $in: venueIds },
            organization: { $in: member.organizations },
        });
        if (validVenues.length !== venueIds.length) {
            return {
                error:
                    "One or more venues are invalid for this user's organizations.",
            };
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
            error:
                "Provide permission and/or organizations and/or venues (same as Edit User UI).",
            needsFields: [
                { field: "permission", message: "view | manage" },
                {
                    field: "organizationNames",
                    message: "Reassign one or more organizations by name",
                },
                { field: "venueNames", message: "Assign venues by name" },
            ],
            instructionForAssistant:
                "Edit User supports permission, organizations, and venues — ask what to change, then retry. Name/email of the user are identity only (not editable here).",
        };
    }

    await member.save();
    return {
        success: true,
        message: "Team user updated (same fields as Edit User UI).",
        user: {
            id: String(member._id),
            name: member.name,
            email: member.email,
            permission: member.permission,
            organizations: member.organizations.map(String),
            venues: (member.venues || []).map(
                (v) => v.venueName || String(v.venueId)
            ),
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

// ─── Events / Schedules ───────────────────────────────────────────────────────

const EVENT_WEEKDAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];

/** Strict UTC "HH:mm" (24h) normalizer. Returns zero-padded "HH:mm" or null. */
function normalizeEventTime(raw) {
    const s = String(raw ?? "").trim();
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Keep only valid lowercase weekday names, de-duplicated. Accepts array or single string. */
function normalizeEventDays(raw) {
    if (raw == null) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const d of arr) {
        const k = String(d || "").toLowerCase().trim();
        if (EVENT_WEEKDAYS.includes(k) && !out.includes(k)) out.push(k);
    }
    return out;
}

function parseHHmmToMinutes(hhmm) {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function minutesToHHmm(totalMinutes) {
    const mins = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Sunday-first — same weekday indexes as EventModal / Date#getDay(). */
const WEEKDAY_SUNDAY_FIRST = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];

function formatOffsetLabel(jsTimezoneOffsetMinutes, ianaName) {
    if (ianaName) return ianaName;
    if (!Number.isFinite(jsTimezoneOffsetMinutes)) return "local";
    const hours = -jsTimezoneOffsetMinutes / 60;
    const sign = hours >= 0 ? "+" : "";
    return `UTC${sign}${hours}`;
}

/**
 * Local HH:mm → UTC using the browser offset, same idea as EventModal:
 * `new Date().getTimezoneOffset()` = minutes to add to local to get UTC
 * (PKT = -300, IST = -330, UAE = -240, US Pacific winter = 480).
 */
function localHHmmToUtc(hhmm, jsTimezoneOffsetMinutes) {
    const utcTotal = parseHHmmToMinutes(hhmm) + jsTimezoneOffsetMinutes;
    let dayShift = Math.floor(utcTotal / (24 * 60));
    if (dayShift > 1) dayShift = -1;
    if (dayShift < -1) dayShift = 1;
    return { time: minutesToHHmm(utcTotal), dayShift };
}

function shiftEventDays(days, dayShift) {
    if (!dayShift || !Array.isArray(days) || !days.length) return days || [];
    return days.map((d) => {
        const idx = WEEKDAY_SUNDAY_FIRST.indexOf(String(d).toLowerCase().trim());
        if (idx < 0) return String(d).toLowerCase();
        return WEEKDAY_SUNDAY_FIRST[(idx + dayShift + 7) % 7];
    });
}

/**
 * Same conversion as EventModal (local clock → UTC HH:mm + weekday shift).
 * jsTimezoneOffsetMinutes MUST be Date#getTimezoneOffset() from the client.
 */
function convertLocalScheduleToUtc({
    startTime,
    endTime,
    days,
    jsTimezoneOffsetMinutes,
    timeZoneName,
}) {
    const start = localHHmmToUtc(startTime, jsTimezoneOffsetMinutes);
    const end = localHHmmToUtc(endTime, jsTimezoneOffsetMinutes);
    const label = formatOffsetLabel(jsTimezoneOffsetMinutes, timeZoneName);
    return {
        startTime: start.time,
        endTime: end.time,
        days: shiftEventDays(days, start.dayShift),
        timezoneLabel: label,
        dayShift: start.dayShift,
        local: { startTime, endTime, days, timezone: label },
    };
}

/**
 * Same as TriggerEventModal: local start + weekdays → UTC HH:mm + weekday shift.
 * No endTime — trigger events fire once at startTime.
 */
function convertLocalTriggerToUtc({
    startTime,
    days,
    jsTimezoneOffsetMinutes,
    timeZoneName,
}) {
    const start = localHHmmToUtc(startTime, jsTimezoneOffsetMinutes);
    const label = formatOffsetLabel(jsTimezoneOffsetMinutes, timeZoneName);
    return {
        startTime: start.time,
        days: shiftEventDays(days, start.dayShift),
        timezoneLabel: label,
        dayShift: start.dayShift,
        local: { startTime, days, timezone: label },
    };
}

async function createTriggerEventForDevice(user, args, device) {
    const localStart = normalizeEventTime(args.startTime);
    const localDays = normalizeEventDays(args.days);

    const jsOffset = Number(
        user.clientTimezoneOffsetMinutes ?? args.timezoneOffsetMinutes
    );
    const timeZoneName = String(
        user.clientTimeZone || args.timeZone || ""
    ).trim();
    const hasClientOffset = Number.isFinite(jsOffset);
    const timesAreUtc = args.timesAreUtc === true || args.timesAreUtc === "true";

    const missing = [];
    if (!localStart) {
        missing.push({
            field: "startTime",
            message: "Local 24h HH:mm as the user said it, e.g. 09:00",
        });
    }
    if (!localDays.length) {
        missing.push({
            field: "days",
            message: "At least one weekday (same as New Trigger Event). e.g. monday",
        });
    }
    if (missing.length) {
        return {
            error: "Missing/invalid fields to create a trigger event (start time + days only).",
            needsFields: missing,
            deviceContext: {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                category: "trigger",
                eventKind: "trigger",
            },
            instructionForAssistant:
                "This is a TRIGGER device. Pass startTime and days EXACTLY as the user said them (local clock). Do NOT pass endTime, command, or setTemperature. Do NOT convert to UTC. Then retry createEvent.",
        };
    }

    const converted =
        timesAreUtc || !hasClientOffset
            ? {
                  startTime: localStart,
                  days: localDays,
                  timezoneLabel: "UTC",
                  dayShift: 0,
                  local: {
                      startTime: localStart,
                      days: localDays,
                      timezone: "UTC",
                  },
              }
            : convertLocalTriggerToUtc({
                  startTime: localStart,
                  days: localDays,
                  jsTimezoneOffsetMinutes: jsOffset,
                  timeZoneName,
              });

    const { createTriggerScheduleForDevice } = require("../controllers/triggerEventController");
    const result = await createTriggerScheduleForDevice({
        user,
        deviceId: device.deviceId,
        startTime: converted.startTime,
        days: converted.days,
    });

    if (!result.ok) {
        return {
            error: result.body?.message || "Could not create the trigger event.",
        };
    }

    const ev = result.schedule;
    return {
        success: true,
        message: result.body?.message || "Trigger event created successfully.",
        event: {
            id: String(ev._id),
            deviceId: ev.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            category: "trigger",
            eventKind: "trigger",
            startTime: ev.startTime,
            days: ev.days || [],
            command: ev.command,
            isRecurring: ev.isRecurring,
            status: ev.status,
            type: result.scheduleType,
            timezone: converted.timezoneLabel,
            dayShift: converted.dayShift,
            local: converted.local,
        },
        instructionForAssistant:
            "Confirm using event.local (what the user asked) AND stored UTC startTime/days. Trigger events have NO endTime. If dayShift is not 0, the UTC weekday differs. Do not invent an end window.",
    };
}

async function resolveMutableDevice(user, args = {}, accessVerb = "use") {
    let device = null;
    if (args.deviceId) {
        device = await Device.findOne({ deviceId: String(args.deviceId).trim() });
    } else if (args.mongoId && isObjectId(args.mongoId)) {
        device = await Device.findById(args.mongoId);
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

    const venue = await Venue.findById(device.venue).populate("organization", "owner");
    if (!venue) return { error: "Device venue not found." };
    const org = await Organization.findById(
        venue.organization?._id || venue.organization
    );
    if (!org || !(await userCanUseOrganization(user, org))) {
        return {
            error: `You do not have access to ${accessVerb} events on this device.`,
        };
    }
    return { device, venue, org };
}

function slimEventForAgent(ev, extra = {}) {
    if (!ev) return null;
    const status = String(ev.status || "").toUpperCase();
    return {
        eventId: String(ev._id),
        deviceId: ev.deviceId,
        startTime: ev.startTime,
        endTime: ev.endTime || null,
        days: ev.days || [],
        status,
        enabled: status === "ACTIVE",
        uiLabel: status === "ACTIVE" ? "Enabled" : "Disabled",
        isRecurring: !!ev.isRecurring,
        ...extra,
    };
}

/** Card Enable/Disable ↔ backend ACTIVE/INACTIVE. */
function parseEventEnabled(args = {}, currentStatus) {
    if (Object.prototype.hasOwnProperty.call(args, "enabled")) {
        const v = args.enabled;
        if (v === true || v === "true") return "ACTIVE";
        if (v === false || v === "false") return "INACTIVE";
    }
    const raw = args.status ?? args.action;
    if (raw == null || raw === "") {
        return String(currentStatus).toUpperCase() === "ACTIVE"
            ? "INACTIVE"
            : "ACTIVE";
    }
    const s = String(raw).trim().toLowerCase();
    if (["active", "enable", "enabled", "on"].includes(s)) return "ACTIVE";
    if (["inactive", "disable", "disabled", "off"].includes(s)) return "INACTIVE";
    if (s === "toggle") {
        return String(currentStatus).toUpperCase() === "ACTIVE"
            ? "INACTIVE"
            : "ACTIVE";
    }
    return null;
}

async function resolveEventForMutation(user, args = {}) {
    const eventId = String(args.eventId || args.id || "").trim();
    if (eventId && isObjectId(eventId)) {
        let record = await Event.findById(eventId);
        let kind = "schedule";
        if (!record) {
            record = await TriggerSchedule.findById(eventId);
            kind = "trigger";
        }
        if (!record) {
            return {
                error: "Event not found. Call getDeviceEvents with status ALL and pass eventId.",
            };
        }
        const device = await Device.findOne({ deviceId: record.deviceId });
        if (!device) return { error: "Device for this event was not found." };
        const access = await resolveMutableDevice(
            user,
            { deviceId: device.deviceId },
            "change"
        );
        if (access.error) return access;
        return { device: access.device, record, kind };
    }

    const resolved = await resolveMutableDevice(user, args, "change");
    if (resolved.error) return resolved;
    const { device } = resolved;
    if (device.category === "monitoring" && device.deviceType !== "AC") {
        return {
            error: `Monitoring devices do not have events. "${device.deviceName}" is monitoring.`,
        };
    }

    const kind = device.category === "trigger" ? "trigger" : "schedule";
    const Model = kind === "trigger" ? TriggerSchedule : Event;
    let events = await Model.find({ deviceId: device.deviceId });

    const localStart = normalizeEventTime(args.startTime);
    const localDays = normalizeEventDays(args.days);
    if (localStart) {
        const jsOffset = Number(
            user.clientTimezoneOffsetMinutes ?? args.timezoneOffsetMinutes
        );
        const hasClientOffset = Number.isFinite(jsOffset);
        const utcStart = hasClientOffset
            ? localHHmmToUtc(localStart, jsOffset).time
            : localStart;
        const candidates = [...new Set([localStart, utcStart].filter(Boolean))];
        events = events.filter((ev) => candidates.includes(ev.startTime));
        if (localDays.length) {
            const utcDays = hasClientOffset
                ? shiftEventDays(
                      localDays,
                      localHHmmToUtc(localStart, jsOffset).dayShift
                  )
                : localDays;
            events = events.filter((ev) => {
                const days = (ev.days || []).map((d) => String(d).toLowerCase());
                if (!days.length) return false;
                const hasUtc = utcDays.every((d) => days.includes(d));
                const hasLocal = localDays.every((d) => days.includes(d));
                return hasUtc || hasLocal;
            });
        }
    }

    if (!events.length) {
        return {
            error:
                "No matching event. Call getDeviceEvents with status ALL, then pass eventId.",
            needsFields: [{ field: "eventId", message: "From getDeviceEvents" }],
            deviceContext: {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                category: device.category,
            },
        };
    }
    if (events.length > 1) {
        return {
            error: "Multiple events match. Pass eventId from this list.",
            matches: events.map((ev) => slimEventForAgent(ev, { eventKind: kind })),
            needsFields: [{ field: "eventId", message: "Pick one eventId" }],
        };
    }
    return { device, record: events[0], kind };
}

/**
 * CREATE a schedule/event via Eco — scheduling (start+end) or trigger (start+days).
 * Mirrors Add Event / New Trigger Event: resolves + authorizes the device the
 * same way updateDevice does, then delegates to the SHARED create services.
 */
async function createEvent(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const resolved = await resolveMutableDevice(user, args, "create");
    if (resolved.error) return resolved;
    const { device } = resolved;

    if (device.category === "trigger") {
        return createTriggerEventForDevice(user, args, device);
    }

    if (device.category !== "scheduling") {
        return {
            error: `Events can only be created on scheduling or trigger devices. "${device.deviceName}" is a ${device.category} device.`,
        };
    }

    const isAc = device.deviceType === "AC";

    // Times + days are the USER's local clock (same as EventModal). Conversion
    // uses the browser timezone offset attached to the request — not a country map.
    const localStart = normalizeEventTime(args.startTime);
    const localEnd = normalizeEventTime(args.endTime);
    const localDays = normalizeEventDays(args.days);
    let command = args.command ? String(args.command).toUpperCase().trim() : "ON";

    const jsOffset = Number(
        user.clientTimezoneOffsetMinutes ?? args.timezoneOffsetMinutes
    );
    const timeZoneName = String(
        user.clientTimeZone || args.timeZone || ""
    ).trim();
    const hasClientOffset = Number.isFinite(jsOffset);
    const timesAreUtc = args.timesAreUtc === true || args.timesAreUtc === "true";

    const missing = [];
    if (!localStart) {
        missing.push({
            field: "startTime",
            message: "Local 24h HH:mm as the user said it, e.g. 03:00",
        });
    }
    if (!localEnd) {
        missing.push({
            field: "endTime",
            message: "Local 24h HH:mm as the user said it, e.g. 06:00",
        });
    }
    if (isAc) {
        if (!["ON", "OFF"].includes(command)) {
            missing.push({ field: "command", message: "AC event must be ON or OFF" });
        }
        if (command === "ON" && !Number.isFinite(Number(args.setTemperature))) {
            missing.push({
                field: "setTemperature",
                message: "Required °C when AC command is ON, e.g. 24",
            });
        }
    }
    if (missing.length) {
        return {
            error: "Missing/invalid fields to create an event (same as the scheduling card).",
            needsFields: missing,
            deviceContext: {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                isAc,
            },
            instructionForAssistant:
                "Pass startTime/endTime/days EXACTLY as the user said them (their local clock — same as Add Event). Do NOT convert to UTC and do NOT pass a timezone name. The server converts using the browser timezone (weekday can shift, e.g. Wed 3 AM local → previous-day evening UTC). AC: command ON/OFF and setTemperature when ON. Non-AC is always ON. Then retry createEvent.",
        };
    }

    const converted = timesAreUtc || !hasClientOffset
        ? {
              startTime: localStart,
              endTime: localEnd,
              days: localDays,
              timezoneLabel: "UTC",
              dayShift: 0,
              local: {
                  startTime: localStart,
                  endTime: localEnd,
                  days: localDays,
                  timezone: "UTC",
              },
          }
        : convertLocalScheduleToUtc({
              startTime: localStart,
              endTime: localEnd,
              days: localDays,
              jsTimezoneOffsetMinutes: jsOffset,
              timeZoneName,
          });

    const startTime = converted.startTime;
    const endTime = converted.endTime;
    const days = converted.days;

    // ── Delegate to the shared service (the exact manual-endpoint logic) ──
    // Lazy require avoids any load-order/circular concern (same pattern as
    // createDevice/manualToggle requiring their services inside the function).
    const { createScheduleForDevice } = require("../controllers/eventController");
    const result = await createScheduleForDevice({
        user,
        deviceId: device.deviceId,
        startTime,
        endTime,
        days,
        command,
        setTemperature: args.setTemperature,
        applyLock: args.applyLock === true,
    });

    if (!result.ok) {
        return {
            error: result.body?.message || "Could not create the event.",
            ...(result.body?.conflict ? { conflict: result.body.conflict } : {}),
        };
    }

    const ev = result.schedule;
    return {
        success: true,
        message: result.body?.message || "Event created successfully.",
        event: {
            id: String(ev._id),
            deviceId: ev.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            startTime: ev.startTime,
            endTime: ev.endTime,
            days: ev.days || [],
            command: ev.command,
            setTemperature: ev.setTemperature,
            isRecurring: ev.isRecurring,
            isOvernight: ev.isOvernight,
            status: ev.status,
            type: result.scheduleType,
            timezone: converted.timezoneLabel,
            dayShift: converted.dayShift,
            local: converted.local,
        },
        instructionForAssistant:
            "Confirm creation using event.local (what the user asked) AND stored UTC startTime/endTime/days. If dayShift is not 0, the UTC weekday differs (same as Add Event). If isOvernight, mention it spans past midnight. Do not invent fields.",
    };
}

/**
 * Enable / Disable on the event card (frontend) = ACTIVE / INACTIVE (backend).
 * Same PATCH used by EventsSection and TriggerEventsSection.
 */
async function updateEventStatus(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const found = await resolveEventForMutation(user, args);
    if (found.error) return found;
    const { device, record, kind } = found;

    const nextStatus = parseEventEnabled(args, record.status);
    if (!nextStatus) {
        return {
            error: "status must be Enable/Disable (or ACTIVE/INACTIVE).",
            needsFields: [
                {
                    field: "status",
                    message: "enable | disable (same as the event card)",
                },
            ],
        };
    }

    if (String(record.status).toUpperCase() === nextStatus) {
        const label = nextStatus === "ACTIVE" ? "Enabled" : "Disabled";
        return {
            success: true,
            message: `Event is already ${label}.`,
            event: slimEventForAgent(record, {
                deviceName: device.deviceName,
                eventKind: kind,
            }),
        };
    }

    const result =
        kind === "trigger"
            ? await require("../controllers/triggerEventController").toggleTriggerEventStatusForEvent(
                  { id: String(record._id), status: nextStatus }
              )
            : await require("../controllers/eventController").toggleScheduleStatusForEvent(
                  { id: String(record._id), status: nextStatus }
              );

    if (!result.ok) {
        return {
            error: result.body?.message || "Could not update event status.",
            event: slimEventForAgent(record, {
                deviceName: device.deviceName,
                eventKind: kind,
            }),
            instructionForAssistant:
                kind === "schedule" && !record.isRecurring
                    ? "One-time scheduling events cannot be Enabled/Disabled (same as the API). Offer to delete it instead."
                    : "Tell the user why it failed. Do not claim the status changed.",
        };
    }

    const ev = result.schedule;
    const label = nextStatus === "ACTIVE" ? "Enabled" : "Disabled";
    return {
        success: true,
        message: `Event ${label} (${nextStatus}).`,
        event: slimEventForAgent(ev, {
            deviceName: device.deviceName,
            eventKind: kind,
        }),
        instructionForAssistant:
            "Confirm using Enable/Disable (the card labels). Enabled = ACTIVE, Disabled = INACTIVE. Do not invent an endTime for trigger events.",
    };
}

/**
 * Delete a scheduling or trigger event (trash on the event card).
 */
async function deleteEvent(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const found = await resolveEventForMutation(user, args);
    if (found.error) return found;
    const { device, record, kind } = found;

    if (args.confirm !== true && args.confirm !== "true") {
        return needsConfirm({
            action: "deleteEvent",
            eventKind: kind,
            event: slimEventForAgent(record, {
                deviceName: device.deviceName,
                eventKind: kind,
            }),
            warning: "This permanently deletes the event and its queue jobs.",
        });
    }

    const result =
        kind === "trigger"
            ? await require("../controllers/triggerEventController").deleteTriggerEventForEvent(
                  { id: String(record._id) }
              )
            : await require("../controllers/eventController").deleteScheduleForEvent(
                  { id: String(record._id) }
              );

    if (!result.ok) {
        return {
            error: result.body?.message || "Could not delete the event.",
        };
    }

    return {
        success: true,
        message: result.body?.message || "Event deleted.",
        event: {
            id: String(record._id),
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            eventKind: kind,
        },
        deleted: slimEventForAgent(record, {
            deviceName: device.deviceName,
            eventKind: kind,
        }),
        instructionForAssistant:
            "Confirm the event was deleted. Do not claim it still exists.",
    };
}

const { publishCommand } = require("../mqtt/commandPublisher");
const { computeConnectivity } = require("../utils/deviceConnectivity");
const { getCurrentOrNextScheduleData } = require("../services/scheduleLookupService");
const VALID_AC_MODES = ["Cool", "Heat", "Dry", "FanOnly", "Auto"];
const VALID_FAN_SPEEDS = ["Low", "Medium", "High", "Ultra", "Turbo"];

function slimControlledDevice(device, extra = {}) {
    const conn = computeConnectivity(device);
    return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        category: device.category,
        state: device.state,
        venueId: toIdString(device.venue?._id || device.venue),
        isOnline: conn.isOnline,
        setTemperature: device.setTemperature ?? null,
        acMode: device.acMode ?? null,
        fanSpeed: device.fanSpeed ?? null,
        acLocked: device.acLocked ?? null,
        acHealthAlert: device.acHealthAlert ?? false,
        ...extra,
    };
}

function assertControllableCategory(device) {
    if (device.category !== "scheduling" && device.category !== "trigger") {
        return {
            error: `Only scheduling and trigger devices can be turned ON/OFF. "${device.deviceName}" is a ${device.category} device.`,
            instructionForAssistant:
                "Monitoring devices only report sensors/alerts — they cannot be switched ON/OFF. Use getDeviceSnapshot for live readings.",
        };
    }
    return null;
}

function assertDeviceOnlineForControl(device) {
    const conn = computeConnectivity(device);
    if (!conn.isOnline) {
        return {
            error: `Device "${device.deviceName}" is offline. Cannot send commands until it is online (same rule as the dashboard card LED).`,
            deviceId: device.deviceId,
            isOnline: false,
            connectivity: conn,
            instructionForAssistant:
                "Tell the user the device is offline — do NOT claim the command was sent. Call getDeviceSnapshot first if unsure, then retry when online.",
        };
    }
    return null;
}

/**
 * Manual ON/OFF — scheduling & trigger devices only (dashboard power button).
 */
async function setDevicePower(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const resolved = await resolveMutableDevice(user, args, "control");
    if (resolved.error) return resolved;
    const { device } = resolved;

    const categoryErr = assertControllableCategory(device);
    if (categoryErr) return categoryErr;

    const onlineErr = assertDeviceOnlineForControl(device);
    if (onlineErr) return onlineErr;

    let command = args.command ? String(args.command).toUpperCase().trim() : "";
    if (!command) {
        command = device.state === "ON" ? "OFF" : "ON";
    }
    if (!["ON", "OFF"].includes(command)) {
        return {
            error: "command must be ON or OFF",
            needsFields: [{ field: "command", message: "ON or OFF" }],
        };
    }

    const isAc = device.deviceType === "AC";

    if (isAc && device.category === "scheduling") {
        const scheduleInfo = await getCurrentOrNextScheduleData(device.deviceId);
        if (scheduleInfo?.type === "CURRENT" && scheduleInfo?.event) {
            return {
                error:
                    "An active schedule is currently running on this AC. Disable that event first, then retry manual ON/OFF.",
                currentEvent: scheduleInfo.event,
                instructionForAssistant:
                    "Offer updateEventStatus to disable the running event if the user wants manual control.",
            };
        }
    }

    if (device.category === "trigger") {
        device.state = command;
        device.manualButton = command === "ON";
        device.lastUpdateTime = new Date();
        await device.save();

        const published = publishCommand(device.deviceId, {
            type: "COMMAND",
            command,
            manualControl: true,
            timestamp: new Date().toISOString(),
        });
        if (!published) {
            return {
                error: "MQTT broker unavailable. Could not reach the device.",
            };
        }

        if (global.io) {
            global.io.emit(`device/${device.deviceId}`, {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                category: "trigger",
                state: device.state,
                manualButton: device.manualButton,
                timestamp: new Date(),
            });
        }

        return {
            success: true,
            message: `Trigger device set to ${command}.`,
            device: slimControlledDevice(device, { manualButton: device.manualButton }),
            instructionForAssistant:
                "Confirm ON/OFF state. Trigger devices use manual control like the dashboard button.",
        };
    }

    // scheduling
    if (isAc) {
        const {
            publishAcMqttCommand,
            emitAcDeviceLive,
        } = require("../services/acScheduleHelper");

        let temp = command === "ON" ? device.setTemperature : null;
        if (
            command === "ON" &&
            args.setTemperature != null &&
            Number.isFinite(Number(args.setTemperature))
        ) {
            const t = Number(args.setTemperature);
            if (t < 16 || t > 30) {
                return {
                    error: "setTemperature must be between 16 and 30 when turning AC ON",
                    needsFields: [
                        {
                            field: "setTemperature",
                            message: "°C between 16 and 30 when turning AC ON",
                        },
                    ],
                };
            }
            device.setTemperature = t;
            temp = t;
        }

        const mqttResult = await publishAcMqttCommand(device, command, temp);
        if (!mqttResult?.ok) {
            return {
                error: mqttResult?.message || "Failed to send AC power command.",
            };
        }

        device.state = command;
        device.lastUpdateTime = new Date();
        await device.save();
        emitAcDeviceLive(device);
    } else {
        const published = publishCommand(device.deviceId, {
            type: "COMMAND",
            command,
            isManual: true,
            timestamp: new Date().toISOString(),
        });
        if (!published) {
            return {
                error: "MQTT broker unavailable. Could not reach the device.",
            };
        }

        device.state = command;
        device.lastUpdateTime = new Date();
        await device.save();

        if (global.io) {
            global.io.emit(`device/${device.deviceId}`, {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                deviceType: device.deviceType,
                category: device.category,
                state: device.state,
                timestamp: new Date(),
            });
        }
    }

    return {
        success: true,
        message: `Device turned ${command}.`,
        device: slimControlledDevice(device),
        instructionForAssistant: isAc
            ? "For AC ON you may include setTemperature (16–30°C). Confirm state and temperature if set."
            : "Confirm the device state changed.",
    };
}

/**
 * AC settings — temperature, mode, fan speed (dashboard AC dial).
 */
async function updateAcSettings(user, args = {}) {
    const denied = denyMutate(user);
    if (denied) return denied;

    const resolved = await resolveMutableDevice(user, args, "control");
    if (resolved.error) return resolved;
    const { device } = resolved;

    if (device.deviceType !== "AC") {
        return {
            error: `updateAcSettings is only for AC devices. "${device.deviceName}" is type ${device.deviceType}.`,
        };
    }
    if (device.category !== "scheduling") {
        return {
            error: "AC settings can only be changed on scheduling AC devices.",
        };
    }

    const onlineErr = assertDeviceOnlineForControl(device);
    if (onlineErr) return onlineErr;

    const { publishAcSettingsChanges } = require("../mqtt/acKitCommandPublisher");
    const { emitAcDeviceLive } = require("../services/acScheduleHelper");

    const changes = {};
    let changed = false;

    if (args.setTemperature !== undefined) {
        const temp = Number(args.setTemperature);
        if (!Number.isFinite(temp) || temp < 16 || temp > 30) {
            return {
                error: "setTemperature must be a number between 16 and 30",
                needsFields: [
                    {
                        field: "setTemperature",
                        message: "°C between 16 and 30",
                    },
                ],
            };
        }
        device.setTemperature = temp;
        changes.setTemperature = temp;
        changed = true;
    }

    if (args.acMode !== undefined) {
        const mode = String(args.acMode).trim();
        if (!VALID_AC_MODES.includes(mode)) {
            return {
                error: `acMode must be one of: ${VALID_AC_MODES.join(", ")}`,
                needsFields: [
                    {
                        field: "acMode",
                        message: VALID_AC_MODES.join(" | "),
                    },
                ],
            };
        }
        device.acMode = mode;
        changes.acMode = mode;
        changed = true;
    }

    if (args.fanSpeed !== undefined) {
        const speed = String(args.fanSpeed).trim();
        if (!VALID_FAN_SPEEDS.includes(speed)) {
            return {
                error: `fanSpeed must be one of: ${VALID_FAN_SPEEDS.join(", ")}`,
                needsFields: [
                    {
                        field: "fanSpeed",
                        message: VALID_FAN_SPEEDS.join(" | "),
                    },
                ],
            };
        }
        device.fanSpeed = speed;
        changes.fanSpeed = speed;
        changed = true;
    }

    if (typeof args.acLocked === "boolean") {
        device.acLocked = args.acLocked;
        changes.acLocked = args.acLocked;
        changed = true;
    }

    if (!changed) {
        return {
            error: "Provide at least one of: setTemperature, acMode, fanSpeed, acLocked",
            needsFields: [
                { field: "setTemperature", message: "16–30 °C" },
                { field: "acMode", message: VALID_AC_MODES.join(" | ") },
                { field: "fanSpeed", message: VALID_FAN_SPEEDS.join(" | ") },
            ],
            instructionForAssistant:
                "Ask what to change: temperature (°C), mode (Cool/Heat/Dry/FanOnly/Auto), or fan speed (Low/Medium/High/Ultra/Turbo).",
        };
    }

    device.lastUpdateTime = new Date();
    await device.save();

    const mqttResult = await publishAcSettingsChanges(
        device.deviceId,
        changes,
        device
    );
    if (!mqttResult.ok) {
        return {
            error:
                mqttResult.message ||
                "Settings saved but failed to publish MQTT command.",
            device: slimControlledDevice(device),
        };
    }

    emitAcDeviceLive(device);

    return {
        success: true,
        message: "AC settings updated.",
        device: slimControlledDevice(device),
        changed: changes,
        instructionForAssistant:
            "Confirm the updated temperature, mode, and/or fan speed. Device must stay online for IR commands to apply.",
    };
}

/** Redux scopes the frontend should refetch after a successful agent write. */
const MUTATION_TOOL_REFRESH_SCOPES = {
    createOrganization: ["organizations"],
    updateOrganization: ["organizations"],
    deleteOrganization: ["organizations", "venues", "devices"],
    createVenue: ["organizations", "venues"],
    updateVenue: ["organizations", "venues"],
    deleteVenue: ["venues", "devices"],
    createDevice: ["devices", "venues"],
    updateDevice: ["devices", "venues"],
    deleteDevice: ["devices"],
    createTeamMember: ["users"],
    updateTeamMember: ["users"],
    deleteTeamMember: ["users"],
    createEvent: ["events"],
    updateEventStatus: ["events"],
    deleteEvent: ["events"],
    setDevicePower: ["devices"],
    updateAcSettings: ["devices"],
};

function mutationSucceeded(toolResult) {
    return (
        toolResult &&
        typeof toolResult === "object" &&
        toolResult.success === true &&
        !toolResult.error &&
        !toolResult.needsFields &&
        !toolResult.needsConfirmation
    );
}

function extractMutationRefreshHints(toolName, toolResult) {
    const hints = {};
    if (!mutationSucceeded(toolResult)) return hints;

    const organizationIds = [];
    const pushOrgId = (raw) => {
        const id = toIdString(raw);
        if (id && !organizationIds.includes(id)) organizationIds.push(id);
    };

    pushOrgId(toolResult.organization?.id);
    pushOrgId(toolResult.venue?.organizationId);
    pushOrgId(toolResult.venue?.previousOrganizationId);
    pushOrgId(toolResult.device?.organizationId);
    pushOrgId(toolResult.device?.previousOrganizationId);
    pushOrgId(toolResult.deleted?.organizationId);

    if (organizationIds.length) {
        hints.organizationId = organizationIds[0];
        hints.organizationIds = organizationIds;
    }

    const venueIds = [];
    const pushVenueId = (raw) => {
        const id = toIdString(raw);
        if (id && !venueIds.includes(id)) venueIds.push(id);
    };

    pushVenueId(toolResult.venue?.id);
    pushVenueId(toolResult.device?.venueId);
    pushVenueId(toolResult.device?.previousVenueId);
    pushVenueId(toolResult.deleted?.venueId);

    if (venueIds.length) {
        hints.venueId = venueIds[0];
        hints.venueIds = venueIds;
        if (toolResult.device?.previousVenueId) {
            hints.previousVenueId = toIdString(
                toolResult.device.previousVenueId
            );
        }
    }

    // Events ride on a device (business deviceId string, not a Mongo _id) — the
    // frontend "events" refresh scope uses this to re-fetch that device's list.
    if (toolResult.event?.deviceId) {
        hints.deviceId = String(toolResult.event.deviceId);
    }
    if (toolResult.deleted?.deviceId) {
        hints.deviceId = String(toolResult.deleted.deviceId);
    }
    if (toolResult.device?.deviceId) {
        hints.deviceId = String(toolResult.device.deviceId);
    }
    const deletedEventId =
        toolResult.deleted?.eventId || toolResult.deleted?.id;
    if (deletedEventId) {
        hints.deletedEventId = String(deletedEventId);
    }

    return hints;
}

function getMutationRefreshScopes(toolName, toolResult) {
    if (!mutationSucceeded(toolResult)) return [];
    return MUTATION_TOOL_REFRESH_SCOPES[toolName] || [];
}

function createMutationRefreshTracker() {
    return { scopes: new Set(), hints: {} };
}

function trackMutationRefresh(tracker, toolName, toolResult) {
    if (!tracker) return;
    for (const scope of getMutationRefreshScopes(toolName, toolResult)) {
        tracker.scopes.add(scope);
    }
    const next = extractMutationRefreshHints(toolName, toolResult);

    const prevOrgIds = Array.isArray(tracker.hints.organizationIds)
        ? tracker.hints.organizationIds
        : [];
    const nextOrgIds = Array.isArray(next.organizationIds)
        ? next.organizationIds
        : [];
    const mergedOrgIds = [
        ...new Set([...prevOrgIds, ...nextOrgIds].filter(Boolean)),
    ];

    const prevVenueIds = Array.isArray(tracker.hints.venueIds)
        ? tracker.hints.venueIds
        : [];
    const nextVenueIds = Array.isArray(next.venueIds) ? next.venueIds : [];
    const mergedVenueIds = [
        ...new Set([...prevVenueIds, ...nextVenueIds].filter(Boolean)),
    ];

    Object.assign(tracker.hints, next);
    if (mergedOrgIds.length) {
        tracker.hints.organizationIds = mergedOrgIds;
        if (!tracker.hints.organizationId) {
            tracker.hints.organizationId = mergedOrgIds[0];
        }
    }
    if (mergedVenueIds.length) {
        tracker.hints.venueIds = mergedVenueIds;
        if (!tracker.hints.venueId) {
            tracker.hints.venueId = mergedVenueIds[0];
        }
    }
    if (next.deviceId) tracker.hints.deviceId = next.deviceId;
}

function buildMutationRefreshEvent(tracker) {
    if (!tracker?.scopes?.size) return null;
    const event = {
        type: "refresh",
        scopes: [...tracker.scopes],
    };
    if (Object.keys(tracker.hints).length) {
        event.hints = { ...tracker.hints };
    }
    return event;
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
    createEvent,
    updateEventStatus,
    deleteEvent,
    setDevicePower,
    updateAcSettings,
};

const MUTATION_AGENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "createOrganization",
            description:
                "CREATE an organization. Pass organizationName EXACTLY once as the user said it (e.g. ORG003 → organizationName \"ORG003\"). Never concatenate or double the name.",
            parameters: {
                type: "object",
                properties: {
                    organizationName: {
                        type: "string",
                        description:
                            "Exact org name from the user, once only (min 3 chars)",
                    },
                    name: {
                        type: "string",
                        description: "Deprecated alias for organizationName",
                    },
                },
                required: ["organizationName"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateOrganization",
            description:
                "Edit Organization UI: RENAME only (newName). No other org fields exist in the UI.",
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
                "CREATE a venue. Need venueName (exactly once) + organizationId or organizationName. Optional description.",
            parameters: {
                type: "object",
                properties: {
                    venueName: {
                        type: "string",
                        description: "Exact venue name once only",
                    },
                    name: {
                        type: "string",
                        description: "Deprecated alias for venueName",
                    },
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
                "Add Device UI: create device. Required: deviceName, deviceType (OD|THD|AQID|GLD|ED|AC|SMD|WLD), category (monitoring|scheduling|trigger), venueName or venueId. AC needs brandName (no conditions). WLD = monitoring only, no conditions. Sensors need conditions[{type,operator,value}] — THD: temp+humidity; OD: +odour; AQID: +AQI; SMD: smoke; GLD: temp+humidity+gass; ED: current required (voltage defaults to 225). Trigger: optional *AlertAccess booleans (defaults false). Never invent unsupported limits.",
            parameters: {
                type: "object",
                properties: {
                    deviceName: { type: "string" },
                    deviceType: { type: "string" },
                    category: { type: "string" },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    organizationId: { type: "string" },
                    organizationName: { type: "string" },
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
                "Edit Device UI: rename (newDeviceName), move venue (newVenueName/newVenueId), deviceType, category, conditions, AC brandName, energyMonitoringIncluded, trigger *AlertAccess booleans. Prefer deviceId to identify. Venue move IS supported — never invent limits.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: {
                        type: "string",
                        description: "Identity lookup only — use newDeviceName to rename",
                    },
                    mongoId: { type: "string" },
                    newDeviceName: { type: "string" },
                    newVenueId: { type: "string" },
                    newVenueName: { type: "string" },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    organizationId: { type: "string" },
                    category: { type: "string" },
                    deviceType: { type: "string" },
                    brandName: { type: "string" },
                    energyMonitoringIncluded: { type: "boolean" },
                    interval: { type: "number" },
                    conditions: { type: "array", items: { type: "object" } },
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
            name: "createEvent",
            description:
                "CREATE an event on a SCHEDULING or TRIGGER device (same as Add Event / New Trigger Event). Pass times and days EXACTLY as the user said them in their local clock — do NOT convert to UTC. Server uses the browser timezone (weekday can shift). Identify device by deviceId (preferred) or unambiguous deviceName. TRIGGER devices: startTime + days ONLY — never endTime, command, or temperature. SCHEDULING devices: startTime + endTime + days; AC also needs command ON/OFF and setTemperature when ON. Non-AC scheduling is always ON. If needsFields, ask then retry.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: {
                        type: "string",
                        description:
                            "Business device id (preferred), e.g. shown on the device card.",
                    },
                    deviceName: {
                        type: "string",
                        description:
                            "Device name — used only if deviceId is not provided; must be unambiguous.",
                    },
                    startTime: {
                        type: "string",
                        description:
                            "Start as the user said it, 24h HH:mm in their local clock.",
                    },
                    endTime: {
                        type: "string",
                        description:
                            "SCHEDULING only: window end as the user said it, 24h HH:mm local. Omit for trigger devices.",
                    },
                    days: {
                        type: "array",
                        items: {
                            type: "string",
                            enum: [
                                "monday",
                                "tuesday",
                                "wednesday",
                                "thursday",
                                "friday",
                                "saturday",
                                "sunday",
                            ],
                        },
                        description:
                            "Weekdays as the user named them (local). Required for trigger events. For scheduling, omit/empty = one-time today.",
                    },
                    command: {
                        type: "string",
                        enum: ["ON", "OFF"],
                        description: "AC scheduling only. Ignored for trigger and non-AC.",
                    },
                    setTemperature: {
                        type: "number",
                        description: "AC scheduling only. Ignored for trigger devices.",
                    },
                    applyLock: {
                        type: "boolean",
                        description:
                            "AC ON scheduling only. Optional remote lock for the event window. OFF events always lock.",
                    },
                },
                required: ["startTime"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateEventStatus",
            description:
                "Enable or Disable a scheduling or trigger event (same as the event-card button). Frontend Enable/Disable = backend ACTIVE/INACTIVE. Prefer eventId from getDeviceEvents (status ALL). If eventId is missing, pass deviceId plus startTime/days. status: enable|disable (or ACTIVE|INACTIVE). Omit status to toggle. Scheduling one-time events cannot be toggled — only recurring. Trigger events can always be toggled.",
            parameters: {
                type: "object",
                properties: {
                    eventId: {
                        type: "string",
                        description: "Mongo id from getDeviceEvents.events[].eventId",
                    },
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    startTime: {
                        type: "string",
                        description: "Local HH:mm as the user said it, if eventId is unknown",
                    },
                    days: {
                        type: "array",
                        items: {
                            type: "string",
                            enum: [
                                "monday",
                                "tuesday",
                                "wednesday",
                                "thursday",
                                "friday",
                                "saturday",
                                "sunday",
                            ],
                        },
                    },
                    status: {
                        type: "string",
                        description:
                            "enable | disable | ACTIVE | INACTIVE. Omit to toggle like the card.",
                    },
                    enabled: {
                        type: "boolean",
                        description: "true = Enable/ACTIVE, false = Disable/INACTIVE",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "deleteEvent",
            description:
                "DELETE a scheduling or trigger event (trash on the event card). Prefer eventId from getDeviceEvents. If unknown, pass deviceId plus startTime/days. confirm=true after the user confirms. Removes the event and its queue jobs.",
            parameters: {
                type: "object",
                properties: {
                    eventId: {
                        type: "string",
                        description: "Mongo id from getDeviceEvents.events[].eventId",
                    },
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    startTime: { type: "string" },
                    days: {
                        type: "array",
                        items: {
                            type: "string",
                            enum: [
                                "monday",
                                "tuesday",
                                "wednesday",
                                "thursday",
                                "friday",
                                "saturday",
                                "sunday",
                            ],
                        },
                    },
                    confirm: { type: "boolean" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "setDevicePower",
            description:
                "Turn a SCHEDULING or TRIGGER device ON or OFF (dashboard power button). Monitoring devices CANNOT be controlled. Device MUST be online — call getDeviceSnapshot first if unsure; offline → do not claim success. Prefer deviceId. command ON|OFF (omit to toggle). AC scheduling: optional setTemperature (16–30°C) when turning ON. AC with a CURRENT active schedule blocks manual toggle — disable the event first (updateEventStatus). Trigger uses manual control.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    command: {
                        type: "string",
                        enum: ["ON", "OFF"],
                        description: "Target power state. Omit to toggle current state.",
                    },
                    setTemperature: {
                        type: "number",
                        description:
                            "AC only, when command is ON: setpoint °C (16–30). Uses stored setpoint if omitted.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "updateAcSettings",
            description:
                "Change AC settings on an online scheduling AC device: setTemperature (16–30°C), acMode (Cool|Heat|Dry|FanOnly|Auto), fanSpeed (Low|Medium|High|Ultra|Turbo), optional acLocked. Device MUST be online. Prefer deviceId. For ON/OFF use setDevicePower. For AC health alert status (not dashboard alert panel) use getDeviceSnapshot → alerts.acHealth.",
            parameters: {
                type: "object",
                properties: {
                    deviceId: { type: "string" },
                    deviceName: { type: "string" },
                    setTemperature: { type: "number" },
                    acMode: {
                        type: "string",
                        enum: ["Cool", "Heat", "Dry", "FanOnly", "Auto"],
                    },
                    fanSpeed: {
                        type: "string",
                        enum: ["Low", "Medium", "High", "Ultra", "Turbo"],
                    },
                    acLocked: { type: "boolean" },
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
                "Edit User UI (manager only): change permission (view|manage), organizations (organizationNames[] or organizations[]), and venues (venueNames[] or venues[]). Identify user by userId/email/name. Does NOT change the person's display name or email.",
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
                    organizationNames: { type: "array", items: { type: "string" } },
                    venueId: { type: "string" },
                    venueName: { type: "string" },
                    venues: { type: "array", items: { type: "string" } },
                    venueNames: { type: "array", items: { type: "string" } },
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
    createMutationRefreshTracker,
    trackMutationRefresh,
    buildMutationRefreshEvent,
    getMutationRefreshScopes,
    extractMutationRefreshHints,
};
