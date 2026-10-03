/**
 * src/routes/analytics.js
 * Analytics endpoints for transaction volume insights.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { verifyJWT } = require("../middleware/auth");
const { validatePublicKey, sanitizePublicKey } = require("../middleware/sanitization");
const analyticsController = require("../controllers/analyticsController");

function getAdminPublicKeys() {
  return (process.env.ADMIN_PUBLIC_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function requireAdmin(req, res, next) {
  const adminPublicKeys = getAdminPublicKeys();
  if (adminPublicKeys.length === 0) {
    return res.status(403).json({ error: "Forbidden: no admin accounts configured" });
  }
  if (!req.user || !adminPublicKeys.includes(req.user.publicKey)) {
    return res.status(403).json({ error: "Forbidden: admin access required" });
  }
  next();
}

/**
 * GET /api/analytics/:publicKey/summary
 * Returns: total sent, received, unique counterparties, avg transaction size.
 */
router.get(
  "/:publicKey/summary",
  strictLimiter,
  validatePublicKey(),
  analyticsController.getSummary
);

/**
 * GET /api/analytics/:publicKey/top-recipients
 * Returns: top 5 addresses by total XLM sent, sorted descending.
 */
router.get(
  "/:publicKey/top-recipients",
  strictLimiter,
  validatePublicKey(),
  analyticsController.getTopRecipients
);

/**
 * GET /api/analytics/:publicKey/activity
 * Returns: payment count by day of week (all 7 days).
 */
router.get(
  "/:publicKey/activity",
  strictLimiter,
  validatePublicKey(),
  analyticsController.getActivityByDay
);

/**
 * DELETE /api/analytics/cache/:publicKey
 * JWT-protected admin endpoint: force-invalidates cached analytics.
 */
router.delete(
  "/cache/:publicKey",
  verifyJWT,
  requireAdmin,
  sanitizePublicKey,
  analyticsController.invalidateCache
);

module.exports = router;

