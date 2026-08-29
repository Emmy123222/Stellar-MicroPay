"use strict";

const { Horizon } = require("@stellar/stellar-sdk");
const logger = require("../utils/logger");
const { getWebhooksByPublicKey, getAllWebhooks } = require("./webhookStore");
const { deliverWebhook } = require("./webhookDelivery");

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const horizonServer = new Horizon.Server(HORIZON_URL);

const activeStreams = new Map();

function startMonitoring(publicKey) {
  if (activeStreams.has(publicKey)) {
    return;
  }

  logger.info({ publicKey }, "[monitor] starting SSE stream");

  const closeStream = horizonServer
    .payments()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: async (record) => {
        if (record.type !== "payment" || record.to !== publicKey) return;
        const asset = record.asset_type === "native" ? "native" : `${record.asset_code}:${record.asset_issuer}`;
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
        await Promise.allSettled(hooks.map((hook) => deliverWebhook(hook, payload)));
      },
      onerror: (err) => {
        logger.error({ publicKey, err }, `[monitor] stream error for ${publicKey}: ${err.message ?? err}`);
        activeStreams.delete(publicKey);
      },
    });

  activeStreams.set(publicKey, closeStream);
}

function stopMonitoring(publicKey) {
  const close = activeStreams.get(publicKey);
  if (close) {
    try { close(); } catch (err) { logger.error({ publicKey, err }, "[monitor] error closing stream"); }
    activeStreams.delete(publicKey);
    logger.info({ publicKey }, "[monitor] SSE stream closed");
  }
}

function stopAllMonitoring() {
  for (const publicKey of activeStreams.keys()) {
    stopMonitoring(publicKey);
  }
}

function ensureMonitored(publicKey) {
  startMonitoring(publicKey);
}

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
  stopAllMonitoring,
  ensureMonitored,
  resumeAllMonitors,
};