/**
 * src/routes/analytics.js
 * Analytics endpoints for transaction volume insights.
 */

"use strict";

const express = require("express");

const router = express.Router();
const analyticsController = require("../controllers/analyticsController");
const { strictLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");

/**
 * GET /api/analytics/:publicKey/summary
 * Returns: total sent, received, unique counterparties, avg transaction size.
 */
router.get(
  "/:publicKey/summary",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.getSummary
);

/**
 * GET /api/analytics/:publicKey/top-recipients
 * Returns: top 5 addresses by total XLM sent, sorted descending.
 */
router.get(
  "/:publicKey/top-recipients",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.getTopRecipients
);

/**
 * GET /api/analytics/:publicKey/activity
 * Returns: payment count by day of week (all 7 days).
 */
router.get(
  "/:publicKey/activity",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.getActivityByDay
);

/**
 * GET /api/analytics/:publicKey/cohorts
 * Returns repeat vs one-time counterparties grouped by period.
 */
router.get(
  "/:publicKey/cohorts",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.getCohortBreakdown
);

/**
 * GET /api/analytics/:publicKey/stream
 * Server-sent events stream for new payment operations.
 */
router.get(
  "/:publicKey/stream",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.streamPayments
);

/**
 * POST /api/analytics/:publicKey/export-schedule
 * Set up recurring email export.
 */
router.post(
  "/:publicKey/export-schedule",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.scheduleExport
);

/**
 * GET /api/analytics/:publicKey/export-schedule
 * Get scheduled export configuration.
 */
router.get(
  "/:publicKey/export-schedule",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.getExportSchedule
);

/**
 * POST /api/analytics/:publicKey/export-trigger
 * Manually trigger sending export email.
 */
router.post(
  "/:publicKey/export-trigger",
  strictLimiter,
  sanitizePublicKey,
  analyticsController.triggerExport
);

module.exports = router;
