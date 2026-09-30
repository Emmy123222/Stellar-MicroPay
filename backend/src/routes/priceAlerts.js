/**
 * src/routes/priceAlerts.js
 * Price alert API endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const priceAlertsController = require("../controllers/priceAlertsController");

/**
 * POST /api/price-alerts
 * Create a new price alert.
 */
router.post("/", strictLimiter, priceAlertsController.createPriceAlert);

/**
 * GET /api/price-alerts
 * Get all price alerts for a user.
 */
router.get("/", strictLimiter, priceAlertsController.getPriceAlerts);

/**
 * DELETE /api/price-alerts/:id
 * Delete a price alert.
 */
router.delete("/:id", strictLimiter, priceAlertsController.deletePriceAlert);

module.exports = router;
