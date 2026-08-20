const crypto = require("crypto");

/**
 * Permanent QR login helpers for manager-created sub-users.
 * QR encodes a URL; token itself is random and not guessable from userId.
 */

function generateQrLoginToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Public URL embedded in the QR code.
 * Uses FRONTEND_URL (primary production site).
 */
function buildQrLoginUrl(token) {
  const base = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
  if (!base || !token) return null;
  return `${base}/q/${token}`;
}

module.exports = {
  generateQrLoginToken,
  buildQrLoginUrl,
};
