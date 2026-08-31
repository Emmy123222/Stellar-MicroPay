/**
 * src/services/webhookService.js
 * Facade that composes webhookStore + paymentMonitor.
 * Kept for backward compatibility — existing code and tests import from here.
 *
 * registerWebhook here wraps the store's version and also calls ensureMonitored,
 * so callers don't need to import paymentMonitor separately.
 */

"use strict";

const {
  startMonitoring,
  stopMonitoring,
  ensureMonitored,
  resumeAllMonitors,
} = require("./paymentMonitor");
const { deliverWebhook } = require("./webhookDelivery");
const store = require("./webhookStore");

/**
 * Register a webhook and immediately start (or confirm) monitoring.
 * Accepts positional args (publicKey, url, secret) to match existing call sites.
 *
 * @param {string} publicKey
 * @param {string} url
 * @param {string} secret
 * @returns {import('./webhookStore').Webhook}
 */
function registerWebhook(publicKey, url, secret) {
  const webhook = store.registerWebhook(publicKey, url, secret);
  ensureMonitored(publicKey);
  return webhook;
}

module.exports = {
  // composed registration (store + monitor)
  registerWebhook,

  // store pass-throughs
  getWebhooksByPublicKey: store.getWebhooksByPublicKey,
  getWebhookById:         store.getWebhookById,
  deleteWebhook:          store.deleteWebhook,
  getAllWebhooks:          store.getAllWebhooks,

  // delivery
  deliverWebhook,

  // monitor
  startMonitoring,
  stopMonitoring,
  ensureMonitored,
  resumeAllMonitors,
};
