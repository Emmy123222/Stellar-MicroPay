/**
 * src/services/networkService.js
 * Business logic for network-related operations (fee history, etc.).
 */

"use strict";

const logger = require("../utils/logger");

// Cache for fee history (10 minutes TTL)
const FEE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let feeCache = {
  data: null,
  expiresAt: 0,
};

/**
 * Get last 24 hours of p50 fee data for sparkline chart.
 * Data is cached for 10 minutes per ledger range.
 * @returns {Array} Array of { timestamp, fee } objects
 */
function getFeeHistory() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (feeCache.data && now < feeCache.expiresAt) {
    return feeCache.data;
  }

  try {
    // Generate mock fee history data for 24 hours
    // In production, this would fetch from Stellar Horizon or a fee stats API
    const history = [];
    const hours = 24;
    const nowDate = new Date();
    
    for (let i = hours; i >= 0; i--) {
      const timestamp = new Date(nowDate.getTime() - i * 60 * 60 * 1000);
      // Simulate realistic fee fluctuations (100-500 stroops)
      const baseFee = 100;
      const variation = Math.random() * 400;
      const fee = Math.round(baseFee + variation);
      
      history.push({
        timestamp: timestamp.toISOString(),
        fee: fee, // in stroops
      });
    }

    // Cache the result
    feeCache = {
      data: history,
      expiresAt: now + FEE_CACHE_TTL_MS,
    };

    logger.info("Fee history cache refreshed");
    return history;
  } catch (err) {
    logger.error({ err }, "Error fetching fee history");
    // Return empty array on error
    return [];
  }
}

/**
 * Clear the fee cache (useful for testing or manual refresh).
 */
function clearFeeCache() {
  feeCache = {
    data: null,
    expiresAt: 0,
  };
}

module.exports = {
  getFeeHistory,
  clearFeeCache,
};
