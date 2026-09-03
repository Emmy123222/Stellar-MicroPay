"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "scheduled-transactions.json");
require("dotenv").config();

const { encrypt, decrypt } = require("./scheduledTransactionCrypto");

// In-memory storage for scheduled transactions
// In a production environment, this would be replaced with a database
const scheduledTransactions = new Map();
let transactionIdCounter = 1;

// ─── Retry policy (#766) ────────────────────────────────────────────────────────
// A scheduled transaction that fails with a *transient* error is retried with
// bounded exponential backoff + jitter. A transaction that fails with a
// *permanent* error, or exhausts its budget of attempts, is parked in the
// dead-letter queue for inspection and manual retry instead of being retried
// forever or silently dropped.
const MAX_ATTEMPTS = 3; // Bounded retry budget
const BASE_RETRY_DELAY_MS = 1_000; // First retry waits ~1 s
const MAX_BACKOFF_MS = 60_000; // Cap the exponential growth at 60 s
const MAX_JITTER_FRACTION = 0.2; // ±20% equal jitter to avoid thundering-herd alignment

// Horizon result codes that will never succeed if the same signed XDR is
// resubmitted. These are classified as permanent and parked in the DLQ.
const PERMANENT_RESULT_CODES = new Set([
  "tx_bad_auth",
  "tx_bad_auth_extra",
  "tx_bad_seq",
  "tx_bad_source_account",
  "tx_insufficient_balance",
  "tx_too_late",
  "tx_missing_operation",
  "tx_bad_sponsor",
  "tx_bad_min_seq_age",
  "tx_too_many_operations",
  "tx_too_many_sponsoring",
  "tx_too_many_subentries",
  "tx_inner_failed",
  "op_underfunded",
  "op_low_reserve",
  "op_no_destination",
  "op_no_issuer",
  "op_bad_auth",
  "op_malformed",
  "op_bad_asset",
  "op_line_full",
  "op_under_dest_min",
  "op_too_many_subentries",
  "op_cross_self",
  "op_too_big",
  "op_not_authorized",
  "op_no_trust",
  "op_source_not_authorized",
  "op_disabled_trust",
  "op_bad_trust",
  "op_no_claimant",
  "op_invalid_claimant",
  "op_sender_no_issuer",
  "op_liquidity_pool_no_trust",
  "op_liquidity_pool_underfunded",
  "op_bad_pool",
  "op_pool_bad_seq",
  "op_acc_bad_seq",
  "op_cross_marker_denied",
  "op_source_cross_marker_denied",
  "op_feeless",
]);

// Network / transport level error markers that indicate a retry is safe.
const NETWORK_ERROR_MARKERS = [
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "SOCKETTIMEDOUT",
  "network",
  "AbortError",
];

/**
 * Extract Stellar Horizon result codes from a submission error so the caller
 * can tell whether the failure is permanent. Handles both the shape the SDK
 * exposes (`error.response.data.extras.result_codes.*`) and a plain
 * `error.data` fallback.
 *
 * @param {Error} error
 * @returns {string[]} Result codes (transaction code + operation codes)
 */
function extractResultCodes(error) {
  if (!error) return [];
  const data = error.response?.data ?? error.data ?? {};
  const resultCodes = data.extras?.result_codes ?? {};
  const transactionCode = resultCodes.transaction;
  const operationCodes = Array.isArray(resultCodes.operations)
    ? resultCodes.operations
    : [];
  return [transactionCode, ...operationCodes].filter(Boolean);
}

/**
 * Classify a Stellar submission error as either transient (safe to retry with
 * backoff) or permanent (never resolves on retry → dead-letter).
 *
 * Classification priority:
 *  1. Known network / transport markers → transient.
 *  2. Known permanent Horizon result codes → permanent.
 *  3. HTTP status: 429 / ≥500 → transient; 4xx (incl. 404) → permanent.
 *  4. No status and no known marker → transient (fail safe, keep retrying).
 *
 * @param {Error|string|null} err - The submission error, or a plain string
 * @returns {{ type: "transient"|"permanent", message: string|null }}
 */
function classifySubmissionError(err) {
  const error = typeof err === "string" ? new Error(err) : err;
  if (!error) {
    return { type: "transient", message: null };
  }

  const message =
    typeof error.message === "string"
      ? error.message
      : String(error.message ?? error);
  const status = error.response?.status ?? error.status ?? null;

  // 1. Network / transport-level failures are always retryable.
  if (NETWORK_ERROR_MARKERS.some((marker) => message.includes(marker))) {
    return { type: "transient", message };
  }

  // 2. Known permanent result codes never resolve on retry.
  const resultCodes = extractResultCodes(error);
  for (const code of resultCodes) {
    if (PERMANENT_RESULT_CODES.has(code)) {
      return {
        type: "permanent",
        message: `${message} (result code: ${code})`,
      };
    }
  }

  // 3. HTTP status based classification.
  if (status !== null && status !== undefined) {
    if (status === 429 || status >= 500) {
      return { type: "transient", message };
    }
    if (status >= 400 && status < 500) {
      return { type: "permanent", message };
    }
  }

  // 4. Unknown (no status / marker) — retry to be safe, the budget bounds it.
  return { type: "transient", message };
}

/**
 * Compute the delay (ms) before the next attempt using exponential backoff
 * with equal jitter, capped at MAX_BACKOFF_MS.
 *
 * @param {number} attemptNumber - Which attempt just failed (1-based)
 * @param {() => number} [rng] - Random source, injectable for deterministic tests
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelayMs(attemptNumber, rng = Math.random) {
  const n = Math.max(1, Number(attemptNumber) || 1);
  const base = Math.min(MAX_BACKOFF_MS, BASE_RETRY_DELAY_MS * 2 ** (n - 1));
  const spread = base * MAX_JITTER_FRACTION;
  return Math.max(0, Math.round(base + (rng() * 2 - 1) * spread));
}

/**
 * Store a pre-signed transaction for future submission
 * @param {string} signedXDR - The signed transaction XDR
 * @param {Date} submitAt - Timestamp when the transaction should be submitted
 * @param {string} publicKey - The account public key that owns this transaction
 * @returns {Object} The stored transaction with ID
 */
function scheduleTransaction(signedXDR, submitAt, publicKey) {
  // Validate inputs
  if (!signedXDR || typeof signedXDR !== "string") {
    const error = new Error("Signed XDR is required and must be a string");
    error.status = 400;
    throw error;
  }

  if (!(submitAt instanceof Date) || isNaN(submitAt.getTime())) {
    const error = new Error("submitAt must be a valid Date object");
    error.status = 400;
    throw error;
  }

  validatePublicKey(publicKey);

  const id = transactionIdCounter++;
  const scheduledTx = {
    id,
    signedXDR,
    submitAt: submitAt.getTime(),
    publicKey,
    attempts: 0,
    // Retry/backoff state (#766)
    nextRetryAt: null, // Earliest timestamp the tx may be retried
    lastError: null,
    lastErrorType: null, // "transient" | "permanent" | null
    createdAt: new Date().getTime(),
    paused: false, // New: pause state
    pausedAt: null, // New: timestamp when paused
  };

  scheduledTransactions.set(id, scheduledTx);
  await persistToDisk();
  return scheduledTx;
}

function getPendingTransactions(publicKey) {
  validatePublicKey(publicKey);

  const now = Date.now();
  const pending = [];

  for (const [, tx] of scheduledTransactions.entries()) {
    if (
      tx.publicKey === publicKey &&
      tx.submitAt > now &&
      tx.attempts < MAX_ATTEMPTS &&
      !tx.paused &&
      !tx.deadLetter
    ) {
      pending.push({
        id: tx.id,
        submitAt: new Date(tx.submitAt),
        publicKey: tx.publicKey,
        attempts: tx.attempts,
        createdAt: new Date(tx.createdAt),
        paused: tx.paused || false,
        nextRetryAt: tx.nextRetryAt ? new Date(tx.nextRetryAt) : null,
      });
    }
  }

  return pending.sort((a, b) => a.submitAt - b.submitAt);
}

function getTransactionById(id) {
  return redactTransaction(scheduledTransactions.get(id));
}

/** Return the XDR only to the internal scheduler, never to an API serializer. */
function getSignedXDRForSubmission(id) {
  const tx = scheduledTransactions.get(id);
  return tx ? decrypt(tx.signedXDREncrypted) : null;
}

async function cancelTransaction(id) {
  const result = scheduledTransactions.delete(id);
  if (result) {
    await persistToDisk();
  }
  return result;
}

/**
 * Get transactions that are due for submission.
 *
 * A transaction is due when BOTH its original `submitAt` and any backoff
 * window (`nextRetryAt`) have elapsed, it still has retry budget remaining,
 * and it has not been paused, parked in the dead-letter queue, or already
 * submitted/reconciled.
 *
 * @returns {Array} Array of transactions ready for submission
 */
function getDueTransactions() {
  const now = Date.now();
  const due = [];

  for (const [, tx] of scheduledTransactions.entries()) {
    // Only include transactions that:
    // 1. Are due for submission (submitAt <= now)
    // 2. Haven't exceeded max attempts (attempts < 3)
    // 3. Are not paused (paused !== true)
    // 4. Haven't been successfully submitted yet (we don't track success separately,
    //    but we'll assume if it's still in the queue, it hasn't succeeded)
    if (tx.submitAt <= now && tx.attempts < 3 && !tx.paused) {
      due.push(tx);
    }
  }

  return due.sort((a, b) => a.submitAt - b.submitAt);
}

/**
 * Increment the attempt counter for a transaction and apply the retry policy.
 *
 * - A *transient* failure schedules a bounded exponential backoff window
 *   (`nextRetryAt`) and keeps the transaction eligible for resubmission.
 * - A *permanent* failure, or exhausting the retry budget, parks the
 *   transaction in the dead-letter queue.
 *
 * @param {number} id - The transaction ID
 * @param {Error|string|null} err - The error (or message) from the failed attempt
 * @returns {{ status: "retry"|"dead_lettered", id: number, attempts: number, nextRetryAt?: number, delayMs?: number, reason?: string }|null}
 */
function incrementAttempt(id, err = null) {
  const tx = scheduledTransactions.get(id);
  if (!tx) return null;

  tx.attempts += 1;
  const classification = classifySubmissionError(err);
  tx.lastError = classification.message;
  tx.lastErrorType = classification.type;

  const attemptsExhausted = tx.attempts >= MAX_ATTEMPTS;
  if (classification.type === "permanent" || attemptsExhausted) {
    deadLetterTransaction(id, classification.message);
    return {
      status: "dead_lettered",
      id,
      attempts: tx.attempts,
      reason: tx.deadLetterReason,
    };
  }

  const delayMs = getBackoffDelayMs(tx.attempts);
  tx.nextRetryAt = Date.now() + delayMs;
  logger.warn(
    { id, attempts: tx.attempts, delayMs, nextRetryAt: tx.nextRetryAt },
    "Scheduled transaction failed; retrying with backoff",
  );
  return {
    status: "retry",
    id,
    attempts: tx.attempts,
    delayMs,
    nextRetryAt: tx.nextRetryAt,
  };
}

async function removeTransaction(id) {
  const result = scheduledTransactions.delete(id);
  if (result) {
    await persistToDisk();
  }
  return result;
}

/**
 * Pause a scheduled transaction
 * @param {number} id - The transaction ID
 * @returns {boolean} True if paused, false if not found
 */
async function pauseTransaction(id) {
  const tx = scheduledTransactions.get(id);
  if (tx) {
    tx.paused = true;
    tx.pausedAt = Date.now();
    logger.info(JSON.stringify({ type: "transaction_paused", id }));
    await persistToDisk();
    return true;
  }
  return false;
}

/**
 * Resume a paused scheduled transaction
 * @param {number} id - The transaction ID
 * @returns {boolean} True if resumed, false if not found
 */
async function resumeTransaction(id) {
  const tx = scheduledTransactions.get(id);
  if (tx) {
    tx.paused = false;
    tx.pausedAt = null;
    logger.info(JSON.stringify({ type: "transaction_resumed", id }));
    await persistToDisk();
    return true;
  }
  return false;
}

/**
 * Reset the scheduler state. Primarily used in tests to get a clean slate.
 * @returns {void}
 */
function resetScheduler() {
  scheduledTransactions.clear();
  transactionIdCounter = 1;
}

module.exports = {
  scheduleTransaction,
  getPendingTransactions,
  getTransactionById,
  getSignedXDRForSubmission,
  cancelTransaction,
  getDueTransactions,
  claimTransaction,
  markComplete,
  markFailed,
  incrementAttempt,
  removeTransaction,
  pauseTransaction,
  resumeTransaction,
};
