/**
 * src/routes/network.js
 * Network-related API endpoints (fee history, etc.).
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const networkController = require("../controllers/networkController");

/**
 * GET /api/network/fee-history
 * Get last 24 hours of p50 fee data for sparkline chart.
 */
router.get("/fee-history", strictLimiter, networkController.getFeeHistory);

module.exports = router;
