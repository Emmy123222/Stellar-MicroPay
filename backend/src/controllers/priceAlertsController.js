/**
 * src/controllers/priceAlertsController.js
 * Handles price alert API requests.
 */

"use strict";

const priceAlertsService = require("../services/priceAlertsService");

/**
 * POST /api/price-alerts
 * Create a new price alert.
 */
async function createPriceAlert(req, res, next) {
  try {
    const { publicKey, asset, direction, targetPrice } = req.body;

    const alert = priceAlertsService.createPriceAlert({
      publicKey,
      asset,
      direction,
      targetPrice,
    });

    res.status(201).json({
      success: true,
      data: alert,
      message: "Price alert created successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/price-alerts
 * Get all price alerts for a user.
 */
async function getPriceAlerts(req, res, next) {
  try {
    const { publicKey } = req.query;

    if (!publicKey) {
      const error = new Error("publicKey is required");
      error.status = 400;
      throw error;
    }

    const alerts = priceAlertsService.getPriceAlerts(publicKey);

    res.json({
      success: true,
      data: alerts,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/price-alerts/:id
 * Delete a price alert.
 */
async function deletePriceAlert(req, res, next) {
  try {
    const { id } = req.params;

    priceAlertsService.deletePriceAlert(id);

    res.json({
      success: true,
      message: "Price alert deleted successfully",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPriceAlert,
  getPriceAlerts,
  deletePriceAlert,
};
