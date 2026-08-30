/**
 * src/services/tipsService.js
 * Business logic for tracking tips received by creators.
 * Storage is delegated to tipsStore.js: a durable, file-backed store with
 * sender/creator indexes so lookups don't need to scan every tip ever
 * recorded (see tipsStore.js for the persistence and indexing details).
 */

"use strict";

const tipsStore = require("./tipsStore");

// Tip record structure:
// { id, senderPublicKey, creatorPublicKey, amount, asset, memo, timestamp, txHash }

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
 * Record a tip sent to a creator. Persisted transactionally: the record is
 * written to durable storage and indexed by sender and creator before this
 * function returns (see tipsStore.insert).
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
    id: tipsStore.nextTipId(),
    senderPublicKey,
    creatorPublicKey,
    amount: String(amount),
    asset,
    memo,
    txHash,
    timestamp: new Date().toISOString(),
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

  const tips = tipsStore.getAllByCreator(creatorPublicKey);

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

/**
 * Records quarantined during the most recent store load — tip-shaped JSON
 * that failed validation (e.g. a malformed dev fixture) and so was kept out
 * of the live index instead of crashing startup or being silently dropped.
 * @returns {Array<{raw: unknown, reason: string, quarantinedAt: string}>}
 */
function getQuarantinedTips() {
  return tipsStore.getQuarantinedTips();
}

/**
 * Test-only helper: clears all tips from the durable store (and the file it
 * is persisted to). Not used outside of test setup.
 */
function resetStore() {
  tipsStore.resetStore();
}

module.exports = {
  recordTip,
  getTipsReceived,
  getTipsStats,
  getTipsSent,
  validateTipInput,
  getTopTippers,
  getQuarantinedTips,
  resetStore,
  toStroops,
  formatStroops,
};
