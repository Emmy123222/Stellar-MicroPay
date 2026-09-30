/**
 * src/services/priceAlertsService.js
 * Business logic for price alerts.
 */

"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

// In-memory storage for price alerts
// Structure: Map<publicKey, Alert[]>
const alertsByUser = new Map();

let alertIdCounter = 1;

// Alert record structure:
// { id, publicKey, asset, direction, targetPrice, triggered, createdAt }

/**
 * Create a new price alert.
 * @param {object} data - Alert data
 * @returns {object} The created alert
 */
function createPriceAlert({ publicKey, asset, direction, targetPrice }) {
  if (!publicKey || !asset || !direction || targetPrice === undefined) {
    const error = new Error("publicKey, asset, direction, and targetPrice are required");
    error.status = 400;
    throw error;
  }

  if (!["above", "below"].includes(direction)) {
    const error = new Error("direction must be 'above' or 'below'");
    error.status = 400;
    throw error;
  }

  const alert = {
    id: alertIdCounter++,
    publicKey,
    asset: asset.toUpperCase(),
    direction,
    targetPrice: parseFloat(targetPrice),
    triggered: false,
    createdAt: new Date().toISOString(),
  };

  if (!alertsByUser.has(publicKey)) {
    alertsByUser.set(publicKey, []);
  }

  alertsByUser.get(publicKey).push(alert);

  logger.info({ alertId: alert.id, publicKey, asset, direction, targetPrice }, "Price alert created");

  return alert;
}

/**
 * Get all price alerts for a user.
 * @param {string} publicKey - The user's public key
 * @returns {Array} Array of alerts
 */
function getPriceAlerts(publicKey) {
  if (!publicKey) {
    const error = new Error("publicKey is required");
    error.status = 400;
    throw error;
  }

  return alertsByUser.get(publicKey) || [];
}

/**
 * Delete a price alert.
 * @param {number} id - The alert ID
 */
function deletePriceAlert(id) {
  const alertId = parseInt(id, 10);
  if (isNaN(alertId)) {
    const error = new Error("Invalid alert ID");
    error.status = 400;
    throw error;
  }

  for (const [publicKey, alerts] of alertsByUser.entries()) {
    const index = alerts.findIndex((a) => a.id === alertId);
    if (index !== -1) {
      alerts.splice(index, 1);
      logger.info({ alertId }, "Price alert deleted");
      return;
    }
  }

  const error = new Error("Alert not found");
  error.status = 404;
  throw error;
}

/**
 * Get current XLM price from CoinGecko.
 * @returns {Promise<number>} Current XLM price in USD
 */
async function getCurrentXLMPrice() {
  try {
    const response = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: {
        ids: "stellar",
        vs_currencies: "usd",
      },
      timeout: 5000,
    });

    return response.data?.stellar?.usd || null;
  } catch (err) {
    logger.error({ err }, "Failed to fetch XLM price from CoinGecko");
    return null;
  }
}

/**
 * Check all active alerts and trigger notifications if conditions are met.
 * This should be called periodically (e.g., every 5 minutes).
 * @returns {Promise<Array>} Array of triggered alerts
 */
async function checkAlerts() {
  const currentPrice = await getCurrentXLMPrice();
  if (currentPrice === null) {
    logger.warn("Could not fetch current price, skipping alert check");
    return [];
  }

  const triggeredAlerts = [];

  for (const alerts of alertsByUser.values()) {
    for (const alert of alerts) {
      if (alert.triggered) continue; // Skip already triggered alerts
      if (alert.asset !== "XLM") continue; // Only XLM supported for now

      let shouldTrigger = false;

      if (alert.direction === "above" && currentPrice > alert.targetPrice) {
        shouldTrigger = true;
      } else if (alert.direction === "below" && currentPrice < alert.targetPrice) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        alert.triggered = true;
        triggeredAlerts.push({
          ...alert,
          currentPrice,
        });
        logger.info(
          { alertId: alert.id, publicKey: alert.publicKey, targetPrice: alert.targetPrice, currentPrice },
          "Price alert triggered"
        );
      }
    }
  }

  return triggeredAlerts;
}

/**
 * Get all alerts (for testing/internal use).
 */
function getAllAlerts() {
  const all = [];
  for (const alerts of alertsByUser.values()) {
    all.push(...alerts);
  }
  return all;
}

module.exports = {
  createPriceAlert,
  getPriceAlerts,
  deletePriceAlert,
  getCurrentXLMPrice,
  checkAlerts,
  getAllAlerts,
};
