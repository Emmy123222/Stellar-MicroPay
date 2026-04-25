/**
 * src/routes/tips.js
 * Tip-related API endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");
const tipsController = require("../controllers/tipsController");

/**
 * POST /api/tips
 * Record a new tip.
 */
router.post("/", strictLimiter, tipsController.recordTip);

/**
 * GET /api/tips/received/:creatorPublicKey
 * Get all tips received by a creator.
 */
router.get("/received/:creatorPublicKey", strictLimiter, sanitizePublicKey, tipsController.getTipsReceived);

/**
 * GET /api/tips/stats/:creatorPublicKey
 * Get statistics for tips received by a creator.
 */
router.get("/stats/:creatorPublicKey", strictLimiter, sanitizePublicKey, tipsController.getTipsStats);

/**
 * GET /api/tips/sent/:senderPublicKey
 * Get all tips sent by a user.
 */
router.get("/sent/:senderPublicKey", strictLimiter, sanitizePublicKey, tipsController.getTipsSent);

module.exports = router;