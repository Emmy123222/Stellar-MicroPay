"use strict";

const { Horizon } = require("@stellar/stellar-sdk");

const logger = require("../utils/logger");

const cursorStore = require("./cursorStore");
const { deliverWebhook } = require("./webhookDelivery");
const { getWebhooksByPublicKey, getAllWebhooks } = require("./webhookStore");
const {
  STATES,
  getBreaker,
  HorizonCircuitOpenError,
  inferNetworkFromHorizonUrl,
} = require("./horizonCircuitBreaker");

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const horizonServer = new Horizon.Server(HORIZON_URL);

const activeStreams = new Map();

/**
 * Recently-handled paging tokens per public key, used to de-duplicate rows
 * replayed by an inclusive resume after a reconnect or restart.
 * @type {Map<string, Set<string>>}
 */
const seenTokens = new Map();

/**
 * @param {string} publicKey
 * @returns {HorizonCircuitOpenError|null}
 */
function getStreamBlockedError(publicKey) {
  const breaker = getBreaker(HORIZON_URL);
  breaker.refreshState();
  if (breaker.state === STATES.OPEN || breaker.state === STATES.HALF_OPEN) {
    try {
      breaker.assertCanExecute();
    } catch (err) {
      if (err instanceof HorizonCircuitOpenError) {
        logger.warn(
          { publicKey, origin: err.origin, state: err.state, retryAfterMs: err.retryAfterMs },
          "[monitor] Horizon circuit blocked stream start"
        );
        return err;
      }
      throw err;
    }
  }
  return null;
}

/**
 * Start monitoring a Stellar account for incoming payments.
 * If a stream is already active for this key, this is a no-op.
 *
 * @param {string} publicKey
 * @returns {{ started: boolean, retryAfterMs?: number, state?: string }}
 */
function startMonitoring(publicKey) {
  if (activeStreams.has(publicKey)) {
    return { started: true };
  }

  const blocked = getStreamBlockedError(publicKey);
  if (blocked) {
    return {
      started: false,
      state: blocked.state,
      retryAfterMs: blocked.retryAfterMs,
    };
  }

  logger.info({ publicKey }, "[monitor] starting SSE stream");

  // Resume from the last persisted paging token so payments processed during
  // downtime or a reconnect gap are not missed. Falls back to "now" only when
  // no cursor has been persisted yet.
  const resumeCursor = cursorStore.get(publicKey);
  const breaker = getBreaker(HORIZON_URL);

  const closeStream = horizonServer
    .payments()
    .forAccount(publicKey)
    .cursor(resumeCursor)
    .stream({
      onmessage: async (record) => {
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
          record.asset_type === "native" ? "native" : `${record.asset_code}:${record.asset_issuer}`;

        const network = inferNetworkFromHorizonUrl(HORIZON_URL);

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
        const hooks = getWebhooksByPublicKey(publicKey);
        if (hooks.length > 0) {
          // Parallel delivery — one failed hook must not block others
          await Promise.allSettled(hooks.map((hook) => deliverWebhook(hook, payload)));
        }

        // Advance the durable cursor even when no webhook is registered, so a
        // payment with no endpoint is not reprocessed on the next reconnect.
        cursorStore.set(publicKey, record.paging_token);
        breaker.recordSuccess();
      },
      onerror: (err) => {
        breaker.recordFailure();
        logger.error(
          {
            publicKey,
            err,
            circuitState: breaker.snapshot().state,
            retryAfterMs: breaker.getRetryAfterMs(),
          },
          `[monitor] stream error for ${publicKey}: ${err.message ?? err}`
        );
        // Remove the dead stream so ensureMonitored can restart it next time
        activeStreams.delete(publicKey);
        seenTokens.delete(publicKey);
      },
    });

  activeStreams.set(publicKey, closeStream);
  return { started: true };
}

function stopMonitoring(publicKey) {
  const close = activeStreams.get(publicKey);
  if (close) {
    try { close(); } catch (err) { logger.error({ publicKey, err }, "[monitor] error closing stream"); }
    activeStreams.delete(publicKey);
    logger.info({ publicKey }, "[monitor] SSE stream closed");
  }
}

/**
 * Ensure a Stellar account is being monitored.
 * Idempotent — safe to call multiple times for the same key.
 *
 * @param {string} publicKey
 * @returns {{ started: boolean, retryAfterMs?: number, state?: string }}
 */
function ensureMonitored(publicKey) {
  return startMonitoring(publicKey);
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

/**
 * Observable stream + circuit breaker status for health probes (#840).
 * @returns {object}
 */
function getMonitorStatus() {
  const breaker = getBreaker(HORIZON_URL);
  breaker.refreshState();
  return {
    horizonUrl: HORIZON_URL,
    network: inferNetworkFromHorizonUrl(HORIZON_URL),
    activeStreams: activeStreams.size,
    circuit: breaker.snapshot(),
  };
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  stopAllMonitoring,
  ensureMonitored,
  resumeAllMonitors,
  getMonitorStatus,
};
