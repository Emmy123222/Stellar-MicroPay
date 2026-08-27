/**
 * src/services/scheduledTransactionWorker.js
 *
 * Polls the in-memory scheduled-transaction queue every POLL_INTERVAL_MS,
 * atomically claims each due job, and submits the pre-signed XDR to the
 * configured Stellar Horizon network.
 *
 * Lifecycle:
 *   start()  – begin polling (idempotent; safe to call multiple times)
 *   stop()   – cancel the poll interval (useful for clean shutdown / tests)
 *
 * Network:
 *   The worker submits to the Horizon server configured by the `stellar`
 *   config module, which reads HORIZON_URL from the environment.
 *   Testnet:  HORIZON_URL=https://horizon-testnet.stellar.org  (default)
 *   Mainnet:  HORIZON_URL=https://horizon.stellar.org
 */

"use strict";

const { TransactionBuilder } = require("@stellar/stellar-sdk");
const { server, HORIZON_URL } = require("../config/stellar");
const logger = require("../utils/logger");
const {
  getDueTransactions,
  claimTransaction,
  markComplete,
  markFailed,
} = require("./scheduledTransactionService");

// Poll every 10 seconds by default; override with SCHEDULED_TX_POLL_MS env var
const POLL_INTERVAL_MS = parseInt(process.env.SCHEDULED_TX_POLL_MS || "10000", 10);

let _intervalId = null;

/**
 * Process a single due transaction:
 * 1. Atomically claim it so no other worker picks it up.
 * 2. Deserialise the signed XDR with TransactionBuilder.fromXDR.
 * 3. Submit to Horizon.
 * 4. Record the transaction hash (success) or error message (failure).
 *
 * @param {object} tx - A transaction record from scheduledTransactionService
 * @returns {Promise<void>}
 */
async function processTransaction(tx) {
  // Atomic claim — bail if another worker already took it
  const claimed = claimTransaction(tx.id);
  if (!claimed) {
    return;
  }

  logger.info(
    { id: tx.id, publicKey: tx.publicKey, horizonUrl: HORIZON_URL },
    "[worker] submitting scheduled transaction"
  );

  try {
    // Deserialise the pre-signed XDR. The network passphrase is embedded in
    // the envelope, so we pass "any" as the network to accept both test and
    // mainnet envelopes without hard-coding a passphrase here.
    const transaction = TransactionBuilder.fromXDR(tx.signedXDR, "any");

    // Submit to the configured Horizon server
    const response = await server.submitTransaction(transaction);

    const hash = response.hash || response.id;
    markComplete(tx.id, hash);
    logger.info(
      { id: tx.id, transactionHash: hash, publicKey: tx.publicKey },
      "[worker] scheduled transaction submitted successfully"
    );
  } catch (err) {
    // Horizon returns detailed result codes; surface them for debugging
    const detail =
      err?.response?.data?.extras?.result_codes
        ? JSON.stringify(err.response.data.extras.result_codes)
        : err?.message || String(err);

    logger.error(
      { id: tx.id, publicKey: tx.publicKey, error: detail, attempt: tx.attempts + 1 },
      "[worker] scheduled transaction submission failed"
    );

    markFailed(tx.id, detail);
  }
}

/**
 * Single poll tick: fetch all due transactions and process them concurrently.
 * Errors from individual transactions are handled inside processTransaction and
 * must not crash the poll loop.
 *
 * @returns {Promise<void>}
 */
async function tick() {
  let due;
  try {
    due = getDueTransactions();
  } catch (err) {
    logger.error({ err }, "[worker] failed to fetch due transactions");
    return;
  }

  if (due.length === 0) return;

  logger.info({ count: due.length }, "[worker] processing due scheduled transactions");

  // Process all due transactions concurrently; individual failures are isolated
  await Promise.allSettled(due.map((tx) => processTransaction(tx)));
}

/**
 * Start the scheduled-transaction worker.
 * Idempotent — calling start() when already running is a no-op.
 *
 * @returns {void}
 */
function start() {
  if (_intervalId !== null) {
    return; // already running
  }

  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, horizonUrl: HORIZON_URL },
    "[worker] scheduled transaction worker starting"
  );

  _intervalId = setInterval(() => {
    tick().catch((err) => {
      logger.error({ err }, "[worker] unhandled error in tick");
    });
  }, POLL_INTERVAL_MS);

  // Allow the process to exit cleanly even if the interval is still active
  if (_intervalId.unref) {
    _intervalId.unref();
  }
}

/**
 * Stop the scheduled-transaction worker.
 * Safe to call if the worker was never started.
 *
 * @returns {void}
 */
function stop() {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info("[worker] scheduled transaction worker stopped");
  }
}

module.exports = { start, stop, tick, processTransaction };
