/**
 * Fetch AC brands from Ackit HTTP API only (no Mongo URL).
 *
 * Env:
 *   ACKIT_API_URL=https://api.ackit.iotfiysolutions.com   (default)
 *   ACKIT_API_TOKEN=<optional JWT if Ackit still requires auth>
 */
const {
    brandHasCommand,
    brandDocumentToCommandsMap,
    getBrandCommandValue,
} = require("../utils/brandCommandMap");

const DEFAULT_ACKIT_API_URL = "https://api.ackit.iotfiysolutions.com";

function getAckitBaseUrl() {
    return String(process.env.ACKIT_API_URL || DEFAULT_ACKIT_API_URL).replace(/\/+$/, "");
}

async function ackitGet(path) {
    const headers = { Accept: "application/json" };
    const token = process.env.ACKIT_API_TOKEN;
    if (token && String(token).trim()) {
        headers.Authorization = token.startsWith("Bearer ")
            ? token
            : `Bearer ${token}`;
    }

    const res = await fetch(`${getAckitBaseUrl()}${path}`, { headers });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ackit API ${path} failed (${res.status}): ${text || res.statusText}`);
    }

    return res.json();
}

/** Full brand docs (includes IR command pulses) — GET /api/brand/all */
async function fetchAllBrands() {
    const data = await ackitGet("/api/brand/all");
    return data.brands || [];
}

/** Dropdown: unique brand names only */
async function listBrandOptions() {
    const brands = await fetchAllBrands();
    const seen = new Set();
    const options = [];

    for (const b of brands) {
        const name = String(b.brandName || "")
            .trim()
            .toLowerCase();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        options.push({ brandName: name });
    }

    options.sort((a, b) => a.brandName.localeCompare(b.brandName));
    return options;
}

async function getBrandByName(brandName) {
    if (!brandName) return null;
    const name = String(brandName).trim().toLowerCase();
    const brands = await fetchAllBrands();
    return brands.find((b) => String(b.brandName || "").toLowerCase() === name) || null;
}

async function resolveDeviceBrand(device) {
    if (!device?.brandName) return null;
    return getBrandByName(device.brandName);
}

/**
 * Resolve brand + IR pulse value for a command key (power.on, temp.24, …).
 * @returns {{ ok:true, brand, value } | { ok:false, status, message }}
 */
async function assertDeviceBrandCommand(device, commandKey) {
    if (!device?.brandName) {
        return {
            ok: false,
            status: 400,
            message: "This AC has no brand. Select a brand when creating the device.",
        };
    }

    let brand;
    try {
        brand = await resolveDeviceBrand(device);
    } catch (err) {
        return {
            ok: false,
            status: 503,
            message: err.message || "Failed to load brand from Ackit API",
        };
    }

    if (!brand) {
        return {
            ok: false,
            status: 404,
            message: `Brand "${device.brandName}" not found on Ackit`,
        };
    }

    if (!brandHasCommand(brand, commandKey)) {
        return {
            ok: false,
            status: 400,
            message: `No IR command for ${commandKey} on brand "${brand.brandName}"`,
        };
    }

    const value = getBrandCommandValue(brand, commandKey);
    if (!value) {
        return {
            ok: false,
            status: 400,
            message: `Empty IR pulse for ${commandKey} on brand "${brand.brandName}"`,
        };
    }

    return { ok: true, brand, value };
}

module.exports = {
    listBrandOptions,
    getBrandByName,
    resolveDeviceBrand,
    assertDeviceBrandCommand,
    brandDocumentToCommandsMap,
    getBrandCommandValue,
};
