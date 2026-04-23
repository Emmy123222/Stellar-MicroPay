"use strict";

const { Horizon } = require("@stellar/stellar-sdk");
require("dotenv").config();

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

const server = new Horizon.Server(HORIZON_URL);

// In-memory storage for scheduled transactions
// In a production environment, this would be replaced with a database
const scheduledTransactions = new Map();
let transactionIdCounter = 1;

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

  // Validate public key format
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const error = new Error("Invalid Stellar public key format");
    error.status = 400;
    throw error;
  }

  const id = transactionIdCounter++;
  const scheduledTx = {
    id,
    signedXDR,
    submitAt: submitAt.getTime(), // Store as timestamp for easier comparison
    publicKey,
    attempts: 0,
    lastError: null,
    createdAt: new Date().getTime(),
  };

  scheduledTransactions.set(id, scheduledTx);
  return scheduledTx;
}

/**
 * Get pending scheduled transactions for a public key
 * @param {string} publicKey - The account public key
 * @returns {Array} Array of scheduled transactions
 */
function getPendingTransactions(publicKey) {
  // Validate public key format
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const error = new Error("Invalid Stellar public key format");
    error.status = 400;
    throw error;
  }

  const now = Date.now();
  const pending = [];

  for (const [id, tx] of scheduledTransactions.entries()) {
    if (tx.publicKey === publicKey && tx.submitAt > now && tx.attempts < 3) {
      pending.push({
        id: tx.id,
        submitAt: new Date(tx.submitAt),
        publicKey: tx.publicKey,
        attempts: tx.attempts,
        createdAt: new Date(tx.createdAt),
      });
    }
  }

  // Sort by submitAt ascending (earliest first)
  return pending.sort((a, b) => a.submitAt - b.submitAt);
}

/**
 * Get a scheduled transaction by ID
 * @param {number} id - The transaction ID
 * @returns {Object|null} The transaction or null if not found
 */
function getTransactionById(id) {
  return scheduledTransactions.get(id) || null;
}

/**
 * Cancel a scheduled transaction
 * @param {number} id - The transaction ID
 * @returns {boolean} True if cancelled, false if not found
 */
function cancelTransaction(id) {
  return scheduledTransactions.delete(id);
}

/**
 * Get transactions that are due for submission (submitAt <= now)
 * @returns {Array} Array of transactions ready for submission
 */
function getDueTransactions() {
  const now = Date.now();
  const due = [];

  for (const [id, tx] of scheduledTransactions.entries()) {
    // Only include transactions that:
    // 1. Are due for submission (submitAt <= now)
    // 2. Haven't exceeded max attempts (attempts < 3)
    // 3. Haven't been successfully submitted yet (we don't track success separately,
    //    but we'll assume if it's still in the queue, it hasn't succeeded)
    if (tx.submitAt <= now && tx.attempts < 3) {
      due.push(tx);
    }
  }

  // Sort by submitAt ascending (oldest first)
  return due.sort((a, b) => a.submitAt - b.submitAt);
}

/**
 * Increment the attempt counter for a transaction
 * @param {number} id - The transaction ID
 * @param {string|null} error - Error message if submission failed, null if successful
 */
function incrementAttempt(id, error = null) {
  const tx = scheduledTransactions.get(id);
  if (tx) {
    tx.attempts += 1;
    tx.lastError = error || null;
    // If successful, we could remove it from the queue, but for now
    // we'll let the caller handle removal if needed
  }
}

/**
 * Remove a transaction from the queue (after successful submission or final failure)
 * @param {number} id - The transaction ID
 * @returns {boolean} True if removed, false if not found
 */
function removeTransaction(id) {
  return scheduledTransactions.delete(id);
}

module.exports = {
  scheduleTransaction,
  getPendingTransactions,
  getTransactionById,
  cancelTransaction,
  getDueTransactions,
  incrementAttempt,
  removeTransaction,
};