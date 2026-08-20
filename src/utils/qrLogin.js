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
 * Prefer QR_FRONTEND_URL (e.g. Inara); fall back to FRONTEND_URL.
 */
function getQrFrontendBase() {
  return (
    process.env.QR_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    ""
  ).replace(/\/$/, "");
}

function buildQrLoginUrl(token) {
  const base = getQrFrontendBase();
  if (!base || !token) return null;
  return `${base}/q/${token}`;
}

module.exports = {
  generateQrLoginToken,
  buildQrLoginUrl,
  getQrFrontendBase,
};
