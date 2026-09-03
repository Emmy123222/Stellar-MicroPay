/**
 * src/services/tipsService.js
 * Business logic for tracking tips received by creators.
 * Storage is delegated to tipsStore.js: a durable, file-backed store with
 * sender/creator indexes so lookups don't need to scan every tip ever
 * recorded (see tipsStore.js for the persistence and indexing details).
 */

"use strict";

const tipsStore = require("./tipsStore");

// Idempotency index: Map<"${txHash}:${operationIndex}", TipRecord>
// Lets replayed client submissions of the same on-chain operation resolve to
// the record that was already created instead of inserting a duplicate.
const tipsByTxHash = new Map();

// Guards against the same verified on-chain transaction being recorded as
// more than one tip (e.g. a duplicate/replayed request for a hash that was
// already accepted).
const seenTxHashes = new Set();

// Tip record structure:
// { id, senderPublicKey, creatorPublicKey, amount, asset, memo, timestamp, txHash, operationIndex }

let tipIdCounter = 1;

/**
 * Record a tip sent to a creator. Persisted transactionally: the record is
 * written to durable storage and indexed by sender and creator before this
 * function returns (see tipsStore.insert).
 * @param {string} senderPublicKey - The Stellar public key of the sender
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @param {string} amount - The amount sent
 * @param {string} asset - The asset code (XLM, USDC, etc.)
 * @param {string} [memo] - Optional memo/message from sender
 * @param {string} [txHash] - The transaction hash
 * @param {number} [operationIndex] - Index of the payment operation within the transaction
 * @returns {object} The created tip record, or the existing record when this
 *   (txHash, operationIndex) pair was already recorded (`isDuplicate: true`)
 */
function recordTip({
  senderPublicKey,
  creatorPublicKey,
  amount,
  asset = "XLM",
  memo = "",
  txHash = "",
}) {
  if (!senderPublicKey || !creatorPublicKey || !amount) {
    const error = new Error("senderPublicKey, creatorPublicKey, and amount are required");
    error.status = 400;
    throw error;
  }

  const normalizedOperationIndex = Number(operationIndex);
  if (!Number.isInteger(normalizedOperationIndex) || normalizedOperationIndex < 0) {
    const error = new Error("operationIndex must be a non-negative integer");
    error.status = 400;
    throw error;
  }

  if (txHash) {
    const idempotencyKey = buildIdempotencyKey(txHash, normalizedOperationIndex);
    const existing = tipsByTxHash.get(idempotencyKey);
    if (existing) {
      // Replay of an already-recorded on-chain operation: return the
      // original record rather than creating a duplicate.
      return { ...existing, isDuplicate: true };
    }
  }

  const tip = {
    id: tipsStore.nextTipId(),
    senderPublicKey,
    creatorPublicKey,
    amount: String(amount),
    asset,
    memo,
    txHash,
    operationIndex: normalizedOperationIndex,
    timestamp: new Date().toISOString(),
    isDuplicate: false,
  };

  return tipsStore.insert(tip);
}

/**
 * Get all tips received by a creator.
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @param {object} [options] - Optional filters
 * @param {number} [options.limit] - Maximum number of tips to return
 * @param {number} [options.offset] - Number of tips to skip (offset pagination; ignored if `cursor` is given)
 * @param {string} [options.cursor] - Opaque cursor from a previous page's `nextCursor`
 * @returns {object} Object with tips array, total count, and pagination cursor
 */
function getTipsReceived(creatorPublicKey, options = {}) {
  if (!creatorPublicKey) {
    const error = new Error("creatorPublicKey is required");
    error.status = 400;
    throw error;
  }

  const { limit = 50, offset = 0, cursor } = options;
  const { tips, total, nextCursor } = tipsStore.listByCreator(creatorPublicKey, { limit, offset, cursor });

  return {
    tips,
    total,
    limit,
    offset,
    nextCursor,
  };
}

/**
 * Get statistics for tips received by a creator.
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @returns {object} Object with total tips, total amount by asset
 */
function getTipsStats(creatorPublicKey) {
  if (!creatorPublicKey) {
    const error = new Error("creatorPublicKey is required");
    error.status = 400;
    throw error;
  }

  const tips = tipsStore.getAllByCreator(creatorPublicKey);

  const stats = {
    totalTips: tips.length,
    totalByAsset: {},
    averageTip: null,
    largestTip: null,
    smallestTip: null,
  };

  // Calculate totals by asset
  for (const tip of tips) {
    const asset = tip.asset || "XLM";
    if (!stats.totalByAsset[asset]) {
      stats.totalByAsset[asset] = { count: 0, amount: 0 };
    }
    stats.totalByAsset[asset].count++;
    stats.totalByAsset[asset].amount += parseFloat(tip.amount);
  }

  // Convert amounts to strings with proper precision
  for (const asset of Object.keys(stats.totalByAsset)) {
    stats.totalByAsset[asset].amount = String(stats.totalByAsset[asset].amount);
  }

  // Calculate average
  if (tips.length > 0) {
    const totalAmount = tips.reduce((sum, tip) => sum + parseFloat(tip.amount), 0);
    stats.averageTip = String(totalAmount / tips.length);

    const amounts = tips.map((t) => parseFloat(t.amount));
    stats.largestTip = String(Math.max(...amounts));
    stats.smallestTip = String(Math.min(...amounts));
  }

  return stats;
}

/**
 * Get all tips sent by a user (for sender's history). Backed by the sender
 * index in tipsStore, so this no longer scans every creator's tip list.
 * @param {string} senderPublicKey - The Stellar public key of the sender
 * @param {object} [options] - Optional filters
 * @param {number} [options.limit] - Maximum number of tips to return
 * @param {number} [options.offset] - Number of tips to skip (offset pagination; ignored if `cursor` is given)
 * @param {string} [options.cursor] - Opaque cursor from a previous page's `nextCursor`
 * @returns {object} Object with tips array, total count, and pagination cursor
 */
function getTipsSent(senderPublicKey, options = {}) {
  if (!senderPublicKey) {
    const error = new Error("senderPublicKey is required");
    error.status = 400;
    throw error;
  }

  const { limit = 50, offset = 0, cursor } = options;
  const { tips, total, nextCursor } = tipsStore.listBySender(senderPublicKey, { limit, offset, cursor });

  return {
    tips,
    total,
    limit,
    offset,
    nextCursor,
  };
}

/**
 * Validate tip record input shape (format only — does not check the claim
 * against the chain; that's stellarService.verifyTipTransaction's job).
 */
function validateTipInput(data) {
  const errors = [];

  if (!data.senderPublicKey) {
    errors.push("senderPublicKey is required");
  } else if (!/^G[A-Z0-9]{55}$/.test(data.senderPublicKey)) {
    errors.push("Invalid sender public key format");
  }

  if (!data.creatorPublicKey) {
    errors.push("creatorPublicKey is required");
  } else if (!/^G[A-Z0-9]{55}$/.test(data.creatorPublicKey)) {
    errors.push("Invalid creator public key format");
  }

  if (!data.amount) {
    errors.push("amount is required");
  } else if (isNaN(parseFloat(data.amount)) || parseFloat(data.amount) <= 0) {
    errors.push("amount must be a positive number");
  }

  if (!data.txHash) {
    errors.push("txHash is required");
  } else if (!/^[0-9a-fA-F]{64}$/.test(data.txHash)) {
    errors.push("Invalid transaction hash format");
  }

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.status = 400;
    throw error;
  }

  return true;
}

/**
 * Get top tippers for a creator.
 * @param {string} creatorPublicKey - The creator's public key
 * @param {number} limit - The number of tippers to return
 * @returns {Array} Sorted array of top tippers
 */
function getTopTippers(creatorPublicKey, limit = 5) {
  if (!creatorPublicKey) {
    const error = new Error("creatorPublicKey is required");
    error.status = 400;
    throw error;
  }

  const tips = tipsByCreator.get(creatorPublicKey) || [];

  // Aggregate total tipped per sender
  const totals = new Map();
  for (const tip of tips) {
    const sender = tip.senderPublicKey;
    const amount = parseFloat(tip.amount) || 0;
    totals.set(sender, (totals.get(sender) || 0) + amount);
  }

  // Convert to array
  const entries = Array.from(totals.entries()).map(([senderPublicKey, totalAmount]) => ({
    senderPublicKey,
    totalAmount: totalAmount.toFixed(7),
  }));

  // Sort descending by amount
  // If there are ties, JavaScript's stable sort (or standard array sorting) preserves order
  entries.sort((a, b) => parseFloat(b.totalAmount) - parseFloat(a.totalAmount));

  // Limit result count
  const result = entries.slice(0, limit);

  return result;
}

module.exports = {
  recordTip,
  getTipsReceived,
  getTipsStats,
  getTipsSent,
  validateTipInput,
  getTopTippers,
  tipsByCreator,
};
