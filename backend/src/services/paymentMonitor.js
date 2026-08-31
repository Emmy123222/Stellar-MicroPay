/**
 * src/services/paymentMonitor.js
 * Monitors Stellar accounts for incoming payments via Horizon SSE streaming.
 * Fires registered webhooks using Promise.allSettled for parallel, safe delivery.
 */

"use strict";

const { Horizon } = require("@stellar/stellar-sdk");

const logger = require("../utils/logger");

const { deliverWebhook } = require("./webhookDelivery");
const { getWebhooksByPublicKey, getAllWebhooks } = require("./webhookStore");

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const horizonServer = new Horizon.Server(HORIZON_URL);

/**
 * Map of publicKey → SSE close function.
 * Prevents duplicate streams for the same account.
 * @type {Map<string, () => void>}
 */
const activeStreams = new Map();

/**
 * Start monitoring a Stellar account for incoming payments.
 * If a stream is already active for this key, this is a no-op.
 *
 * @param {string} publicKey
 */
function startMonitoring(publicKey) {
  if (activeStreams.has(publicKey)) {
    return; // idempotent — already monitored
  }

  logger.info({ publicKey }, "[monitor] starting SSE stream");

  const closeStream = horizonServer
    .payments()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: async (record) => {
        // Only handle incoming simple payments to this account
        if (record.type !== "payment" || record.to !== publicKey) return;

        const asset =
          record.asset_type === "native"
            ? "native"
            : `${record.asset_code}:${record.asset_issuer}`;

        /** @type {import('./webhookDelivery').PaymentPayload} */
        const payload = {
          event: "payment_received",
          publicKey,
          amount: record.amount,
          asset,
          from: record.from,
          transactionHash: record.transaction_hash,
          ledger: record.ledger_attr ?? 0,
          timestamp: record.created_at,
        };

        const hooks = getWebhooksByPublicKey(publicKey);
        if (hooks.length === 0) return;

        // Parallel delivery — one failed hook must not block others
        await Promise.allSettled(hooks.map((hook) => deliverWebhook(hook, payload)));
      },

      onerror: (err) => {
        logger.error(
          { publicKey, err },
          `[monitor] stream error for ${publicKey}: ${err.message ?? err}`
        );
        // Remove the dead stream so ensureMonitored can restart it next time
        activeStreams.delete(publicKey);
      },
    });

  activeStreams.set(publicKey, closeStream);
}

/**
 * Stop monitoring a Stellar account and close its SSE stream.
 *
 * @param {string} publicKey
 */
function stopMonitoring(publicKey) {
  const close = activeStreams.get(publicKey);
  if (close) {
    try {
      close();
    } catch (err) {
      logger.error({ publicKey, err }, "[monitor] error closing stream");
    }
    activeStreams.delete(publicKey);
    logger.info({ publicKey }, "[monitor] SSE stream closed");
  }
}

/**
 * Ensure a Stellar account is being monitored.
 * Idempotent — safe to call multiple times for the same key.
 *
 * @param {string} publicKey
 */
function ensureMonitored(publicKey) {
  startMonitoring(publicKey);
}

/**
 * Resume monitoring for all webhooks that exist at startup.
 * Call this once during app initialisation so existing registrations
 * survive server restarts.
 */
function resumeAllMonitors() {
  const allWebhooks = getAllWebhooks();
  const seen = new Set();
  for (const webhook of allWebhooks) {
    if (!seen.has(webhook.publicKey)) {
      seen.add(webhook.publicKey);
      ensureMonitored(webhook.publicKey);
    }
  }
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  ensureMonitored,
  resumeAllMonitors,
};
