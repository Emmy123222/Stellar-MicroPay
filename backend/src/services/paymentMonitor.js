/**
 * src/services/paymentMonitor.js
 * Monitors Stellar accounts for incoming payments via Horizon SSE streaming.
 * Payment events are translated into webhook payloads and handed to the
 * bounded delivery queue (#770) — no network I/O happens inside the stream
 * callback, so slow receivers can never stall the Horizon stream.
 */

"use strict";

const { Horizon } = require("@stellar/stellar-sdk");


const logger = require("../utils/logger");

const { enqueueDelivery } = require("./webhookQueue");

const cursorStore = require("./cursorStore");
const { deliverWebhook } = require("./webhookDelivery");
const { getWebhooksByPublicKey, getAllWebhooks } = require("./webhookStore");

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

/**
 * Explicit network state (#770): the monitor streams from whichever Horizon
 * instance HORIZON_URL points at. STELLAR_NETWORK must match it — this is
 * validated at startup by config/validateEnv.js — and is logged so operators
 * can tell testnet and mainnet traffic apart.
 */
const STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";

const horizonServer = new Horizon.Server(HORIZON_URL);

logger.info(
  { network: STELLAR_NETWORK, horizonUrl: HORIZON_URL },
  `[monitor] streaming ${STELLAR_NETWORK} payments from ${HORIZON_URL}`
);

/**
 * Map of publicKey → SSE close function.
 * Prevents duplicate streams for the same account.
 * @type {Map<string, () => void>}
 */
const activeStreams = new Map();

/**
 * Hand a payment record off to the delivery queue for every registered
 * webhook. Synchronous and non-blocking — safe to call from the SSE
 * onmessage handler.
 *
 * @param {string} publicKey
 * @param {import('./webhookDelivery').PaymentPayload} payload
 */
function dispatchPaymentEvent(publicKey, payload) {
  const hooks = getWebhooksByPublicKey(publicKey);
  if (hooks.length === 0) return;

  for (const hook of hooks) {
    enqueueDelivery(hook, payload);
  }
}

/**
 * Recently-handled paging tokens per public key, used to de-duplicate rows
 * replayed by an inclusive resume after a reconnect or restart.
 * @type {Map<string, Set<string>>}
 */
const seenTokens = new Map();

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

  logger.info({ publicKey, network: STELLAR_NETWORK }, "[monitor] starting SSE stream");

  const closeStream = horizonServer
    .payments()
    .forAccount(publicKey)
    .cursor(resumeCursor)
    .stream({
      onmessage: (record) => {
        // Only handle incoming simple payments to this account
        if (record.type !== "payment" || record.to !== publicKey) return;

        // Deduplicate rows replayed by an inclusive resume.
        let seen = seenTokens.get(publicKey) || new Set();
        if (
          seen.has(record.paging_token) ||
          record.paging_token === cursorStore.get(publicKey)
        ) {
          return;
        }
        if (seen.size > 500) seen = new Set([record.paging_token]);
        seen.add(record.paging_token);
        seenTokens.set(publicKey, seen);

        const asset =
          record.asset_type === "native"
            ? "native"
            : `${record.asset_code}:${record.asset_issuer}`;

        const network = HORIZON_URL.includes("testnet") ? "testnet" : "mainnet";
        
        /** @type {import('./webhookDelivery').PaymentPayload} */
        const payload = {
          eventId: record.id,
          attempt: 1,
          createdAt: new Date().toISOString(),
          network,
          event: "payment_received",
          publicKey,
          amount: record.amount,
          asset,
          from: record.from,
          transactionHash: record.transaction_hash,
          ledger: record.ledger_attr ?? 0,
          timestamp: record.created_at,
        };

        // Enqueue outside the stream callback — the HTTP POST happens in
        // the queue's worker pool with retries, never inline (#770).
        dispatchPaymentEvent(publicKey, payload);
      },

      onerror: (err) => {
        logger.error(
          { publicKey, err },
          `[monitor] stream error for ${publicKey}: ${err.message ?? err}`
        );
        // Remove the dead stream so ensureMonitored can restart it next time
        activeStreams.delete(publicKey);
        seenTokens.delete(publicKey);
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
  logger.info(
    { network: STELLAR_NETWORK, horizonUrl: HORIZON_URL },
    `[monitor] resuming monitors on ${STELLAR_NETWORK}`
  );
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
  dispatchPaymentEvent,
};
