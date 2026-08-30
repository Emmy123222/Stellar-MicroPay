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

// ── Stroop-safe arithmetic helpers ──────────────────────────────────────────
// Stellar amounts have 7 decimal places (stroops). Using parseFloat introduces
// rounding errors (e.g. 0.1 + 0.2 !== 0.3). We aggregate in integer base units
// (stroops = amount * 10^7) using string math, then format back.
const STROOP_EXPONENT = 7;
const STROOP_DIVISOR = BigInt(10 ** STROOP_EXPONENT); // 10_000_000n

/**
 * Convert a decimal amount string to integer stroops (BigInt).
 * Handles up to 7 decimal places; more are truncated.
 * Returns null for unparseable / non-positive values.
 * @param {string} amount
 * @returns {bigint|null}
 */
function toStroops(amount) {
  const s = String(amount).trim();
  const m = s.match(/^(\d+)(?:\.(\d{1,7}))?$/);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = (m[2] || "").padEnd(STROOP_EXPONENT, "0");
  const result = whole * STROOP_DIVISOR + BigInt(frac);
  return result > 0n ? result : null;
}

/**
 * Format a stroops integer back to a decimal string, trimming trailing zeros
 * and the decimal point when the fractional part is empty.
 * @param {bigint} stroops
 * @returns {string}
 */
function formatStroops(stroops) {
  const sign = stroops < 0n ? "-" : "";
  const abs = stroops < 0n ? -stroops : stroops;
  const whole = abs / STROOP_DIVISOR;
  const frac = (abs % STROOP_DIVISOR).toString().padStart(STROOP_EXPONENT, "0").replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

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

  // Aggregate each asset in integer base units (stroops) to avoid
  // floating-point rounding errors.
  const perAsset = {}; // asset → { count, total, largest, smallest }

  for (const tip of tips) {
    const asset = tip.asset || "XLM";
    const s = toStroops(tip.amount);
    if (s === null) continue; // skip unparseable amounts

    if (!perAsset[asset]) {
      perAsset[asset] = { count: 0, total: 0n, largest: null, smallest: null };
    }
    const bucket = perAsset[asset];
    bucket.count++;
    bucket.total += s;
    if (bucket.largest === null || s > bucket.largest) bucket.largest = s;
    if (bucket.smallest === null || s < bucket.smallest) bucket.smallest = s;
  }

  // Build output, computing per-asset averages
  let globalLargest = null;
  let globalSmallest = null;
  let totalAllTips = 0n;
  let tipCountAll = 0;

  for (const [asset, bucket] of Object.entries(perAsset)) {
    const average = bucket.count > 0 ? bucket.total / BigInt(bucket.count) : 0n;
    stats.totalByAsset[asset] = {
      count: bucket.count,
      amount: formatStroops(bucket.total),
      average: formatStroops(average),
    };

    totalAllTips += bucket.total;
    tipCountAll += bucket.count;
    if (globalLargest === null || bucket.largest > globalLargest) globalLargest = bucket.largest;
    if (globalSmallest === null || bucket.smallest < globalSmallest) globalSmallest = bucket.smallest;
  }

  // Legacy top-level fields: computed across all assets for backward compat.
  if (tipCountAll > 0) {
    stats.averageTip = formatStroops(totalAllTips / BigInt(tipCountAll));
    stats.largestTip = formatStroops(globalLargest);
    stats.smallestTip = formatStroops(globalSmallest);
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
  
  // Aggregate total tipped per sender using stroop-safe integer math
  const totals = new Map(); // sender → BigInt
  for (const tip of tips) {
    const sender = tip.senderPublicKey;
    const s = toStroops(tip.amount);
    if (s === null) continue;
    totals.set(sender, (totals.get(sender) || 0n) + s);
  }

  // Convert to array
  const entries = Array.from(totals.entries()).map(([senderPublicKey, totalStroops]) => ({
    senderPublicKey,
    totalAmount: formatStroops(totalStroops),
  }));

  // Sort descending by amount
  entries.sort((a, b) => {
    const sa = toStroops(a.totalAmount) || 0n;
    const sb = toStroops(b.totalAmount) || 0n;
    return sb > sa ? 1 : sb < sa ? -1 : 0;
  });

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
  toStroops,
  formatStroops,
};