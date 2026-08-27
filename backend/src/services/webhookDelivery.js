/**
 * src/services/webhookDelivery.js
 * Delivers a signed POST notification to a registered webhook URL.
 * Failures are logged but never thrown — the monitor must not crash.
 */

"use strict";

const logger = require("../utils/logger");
const { correlationHeaders } = require("../utils/logger");
const { generateWebhookSignature } = require("../utils/webhookSignature");

/**
 * @typedef {Object} Webhook
 * @property {string} id
 * @property {string} publicKey
 * @property {string} url
 * @property {string} secret
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PaymentPayload
 * @property {'payment_received'} event
 * @property {string} publicKey
 * @property {string} amount
 * @property {string} asset          - 'native' or 'CODE:ISSUER'
 * @property {string} from           - sender's public key
 * @property {string} transactionHash
 * @property {number} ledger
 * @property {string} timestamp
 */

/**
 * Deliver a webhook notification.
 * Signs the body with HMAC-SHA256 and POSTs to webhook.url.
 * Non-2xx responses and network errors are logged, never re-thrown.
 *
 * @param {Webhook} webhook
 * @param {PaymentPayload} payload
 * @returns {Promise<void>}
 */
async function deliverWebhook(webhook, payload) {
  const body = JSON.stringify(payload);
  const sig = generateWebhookSignature(body, webhook.secret);

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stellar-Signature": `sha256=${sig}`,
        "X-Webhook-ID": webhook.id,
        // #837: forward the request's correlation ID so the webhook consumer
        // can trace this delivery back to the originating request.
        ...correlationHeaders(),
      },
      body,
    });

    if (!res.ok) {
      logger.error(
        { webhookId: webhook.id, url: webhook.url, status: res.status },
        `[webhook] delivery failed for ${webhook.id}: HTTP ${res.status}`
      );
    }
  } catch (err) {
    logger.error(
      { webhookId: webhook.id, url: webhook.url, err },
      `[webhook] delivery failed for ${webhook.id}: ${err.message}`
    );
    // Do NOT rethrow — callers use Promise.allSettled and the monitor must not crash
  }
}

module.exports = { deliverWebhook };
