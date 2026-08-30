/**
 * src/services/webhookService.js
 * Facade that composes webhookStore + paymentMonitor.
 * Kept for backward compatibility — existing code and tests import from here.
 *
 * registerWebhook here wraps the store's version and also calls ensureMonitored,
 * so callers don't need to import paymentMonitor separately.
 */

"use strict";

const store = require("./webhookStore");
const { deliverWebhook } = require("./webhookDelivery");
const {
  startMonitoring,
  stopMonitoring,
  ensureMonitored,
  resumeAllMonitors,
} = require("./paymentMonitor");

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

/**
 * Delete a webhook by id.
 * When the deleted webhook was the last one for its account, the live
 * Horizon SSE stream is closed and removed from activeStreams.
 *
 * @param {string} id
 * @returns {boolean} true if deleted, false if not found
 */
function deleteWebhook(id) {
  const webhook = store.getWebhookById(id);
  if (!webhook) return false;

  const { publicKey } = webhook;
  const deleted = store.deleteWebhook(id);

  if (deleted) {
    const remaining = store.getWebhooksByPublicKey(publicKey);
    if (remaining.length === 0) {
      stopMonitoring(publicKey);
    }
  }

  return deleted;
}

module.exports = {
  // composed registration (store + monitor)
  registerWebhook,

  // composed deletion (store + monitor cleanup)
  deleteWebhook,

  // store pass-throughs
  getWebhooksByPublicKey: store.getWebhooksByPublicKey,
  getWebhookById:         store.getWebhookById,
  getAllWebhooks:          store.getAllWebhooks,

  // delivery
  deliverWebhook,

  // monitor
  startMonitoring,
  stopMonitoring,
  ensureMonitored,
  resumeAllMonitors,
};
