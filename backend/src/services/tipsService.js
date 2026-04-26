/**
 * src/services/tipsService.js
 * Business logic for tracking tips received by creators.
 * Uses in-memory storage for v1 (can be migrated to database later).
 */

"use strict";

// In-memory storage for tips
// Structure: Map<creatorPublicKey, TipRecord[]>
const tipsByCreator = new Map();

// Tip record structure:
// { id, senderPublicKey, creatorPublicKey, amount, asset, memo, timestamp, txHash }

let tipIdCounter = 1;

/**
 * Record a tip sent to a creator.
 * @param {string} senderPublicKey - The Stellar public key of the sender
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @param {string} amount - The amount sent
 * @param {string} asset - The asset code (XLM, USDC, etc.)
 * @param {string} [memo] - Optional memo/message from sender
 * @param {string} [txHash] - The transaction hash
 * @returns {object} The created tip record
 */
function recordTip({ senderPublicKey, creatorPublicKey, amount, asset = "XLM", memo = "", txHash = "" }) {
  if (!senderPublicKey || !creatorPublicKey || !amount) {
    const error = new Error("senderPublicKey, creatorPublicKey, and amount are required");
    error.status = 400;
    throw error;
  }

  const tip = {
    id: tipIdCounter++,
    senderPublicKey,
    creatorPublicKey,
    amount: String(amount),
    asset,
    memo,
    txHash,
    timestamp: new Date().toISOString(),
  };

  if (!tipsByCreator.has(creatorPublicKey)) {
    tipsByCreator.set(creatorPublicKey, []);
  }

  tipsByCreator.get(creatorPublicKey).unshift(tip); // Add to beginning (most recent first)

  return tip;
}

/**
 * Get all tips received by a creator.
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @param {object} [options] - Optional filters
 * @param {number} [options.limit] - Maximum number of tips to return
 * @param {number} [options.offset] - Number of tips to skip (for pagination)
 * @returns {object} Object with tips array and total count
 */
function getTipsReceived(creatorPublicKey, options = {}) {
  if (!creatorPublicKey) {
    const error = new Error("creatorPublicKey is required");
    error.status = 400;
    throw error;
  }

  const { limit = 50, offset = 0 } = options;

  const tips = tipsByCreator.get(creatorPublicKey) || [];
  const total = tips.length;
  const paginatedTips = tips.slice(offset, offset + limit);

  return {
    tips: paginatedTips,
    total,
    limit,
    offset,
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

  const tips = tipsByCreator.get(creatorPublicKey) || [];

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
    
    const amounts = tips.map(t => parseFloat(t.amount));
    stats.largestTip = String(Math.max(...amounts));
    stats.smallestTip = String(Math.min(...amounts));
  }

  return stats;
}

/**
 * Get all tips sent by a user (for sender's history).
 * @param {string} senderPublicKey - The Stellar public key of the sender
 * @param {object} [options] - Optional filters
 * @returns {object} Object with tips array and total count
 */
function getTipsSent(senderPublicKey, options = {}) {
  if (!senderPublicKey) {
    const error = new Error("senderPublicKey is required");
    error.status = 400;
    throw error;
  }

  const { limit = 50, offset = 0 } = options;

  // Search all tips to find ones sent by this user
  const allTips = [];
  for (const tips of tipsByCreator.values()) {
    for (const tip of tips) {
      if (tip.senderPublicKey === senderPublicKey) {
        allTips.push(tip);
      }
    }
  }

  // Sort by timestamp descending
  allTips.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = allTips.length;
  const paginatedTips = allTips.slice(offset, offset + limit);

  return {
    tips: paginatedTips,
    total,
    limit,
    offset,
  };
}

/**
 * Validate tip record input.
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

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.status = 400;
    throw error;
  }

  return true;
}

module.exports = {
  recordTip,
  getTipsReceived,
  getTipsStats,
  getTipsSent,
  validateTipInput,
};