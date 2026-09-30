/**
 * src/controllers/networkController.js
 * Handles network-related API requests (fee history, etc.).
 */

"use strict";

const networkService = require("../services/networkService");

/**
 * GET /api/network/fee-history
 * Get last 24 hours of p50 fee data for sparkline chart.
 */
async function getFeeHistory(req, res, next) {
  try {
    const result = networkService.getFeeHistory();
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFeeHistory,
};
