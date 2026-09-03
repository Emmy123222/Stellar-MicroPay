/**
 * src/services/tipsService.js
 * Business logic for tracking tips received by creators.
 * Uses in-memory storage for v1 (can be migrated to database later).
 *
 * NOTE: This module only *records* tips. It trusts that the caller (the
 * controller) has already verified the txHash against Horizon via
 * stellarService.verifyTipTransaction — this module's own job is just to
 * store the result once and refuse to store the same on-chain transaction
 * twice.
 */

"use strict";

// In-memory storage for tips
// Structure: Map<creatorPublicKey, TipRecord[]>
const tipsByCreator = new Map();

// Guards against the same verified on-chain transaction being recorded as
// more than one tip (e.g. a duplicate/replayed request for a hash that was
// already accepted).
const seenTxHashes = new Set();

// Tip record structure:
// { id, senderPublicKey, creatorPublicKey, amount, asset, memo, timestamp, txHash }

let tipIdCounter = 1;

/**
 * @typedef {object} TipRecord
 * @property {number} id
 * @property {string} senderPublicKey
 * @property {string} creatorPublicKey
 * @property {string} amount
 * @property {string} asset
 * @property {string} memo
 * @property {string} txHash
 * @property {number} operationIndex
 * @property {string} timestamp
 * @property {boolean} isDuplicate
 */

/**
 * @typedef {object} TipsStats
 * @property {number} totalTips
 * @property {Object<string, {count: number, amount: string}>} totalByAsset
 * @property {string|null} averageTip
 * @property {string|null} largestTip
 * @property {string|null} smallestTip
 */

/**
 * POST /api/tips
 * Record a new tip.
 *
 * @param {object} req - Express request
 * @param {object} req.body
 * @param {string} req.body.senderPublicKey - Sender's Stellar public key (G...)
 * @param {string} req.body.creatorPublicKey - Creator's Stellar public key (G...)
 * @param {string|number} req.body.amount - Positive tip amount
 * @param {string} [req.body.asset] - Asset code, defaults to "XLM"
 * @param {string} [req.body.memo] - Optional message from sender
 * @param {string} [req.body.txHash] - On-chain transaction hash
 * @param {number} [req.body.operationIndex] - Index of the payment operation within the transaction (default 0)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} 201 JSON `{ success: true, data: TipRecord, message: string }` for a new
 *   tip, or 200 with the pre-existing record when (txHash, operationIndex) was already recorded.
 */
async function recordTip(req, res, next) {
  try {
    const { senderPublicKey, creatorPublicKey, amount, asset, memo, txHash, operationIndex } = req.body;

    // Validate input
    tipsService.validateTipInput({ senderPublicKey, creatorPublicKey, amount });

    const tip = tipsService.recordTip({
      senderPublicKey,
      creatorPublicKey,
      amount,
      asset: asset || "XLM",
      memo: memo || "",
      txHash: txHash || "",
      operationIndex: operationIndex === undefined || operationIndex === null || operationIndex === "" ? 0 : operationIndex,
    });

    if (tip.isDuplicate) {
      res.status(200).json({
        success: true,
        data: tip,
        message: "Tip already recorded",
      });
      return;
    }

    res.status(201).json({
      success: true,
      data: tip,
      message: "Tip recorded successfully",
    });
  } catch (err) {
    next(err);
  }

  if (seenTxHashes.has(txHash)) {
    const error = new Error("This transaction has already been recorded as a tip");
    error.status = 409;
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
  seenTxHashes.add(txHash);

  return tip;
}

/**
 * Get all tips received by a creator.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.creatorPublicKey - Creator's Stellar public key (G...)
 * @param {object} req.query
 * @param {string} [req.query.limit] - Max tips to return
 * @param {string} [req.query.offset] - Number of tips to skip (ignored if `cursor` is given)
 * @param {string} [req.query.cursor] - Opaque cursor from a previous page's `nextCursor`
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { tips: TipRecord[], total: number,
 *   limit: number, offset: number, nextCursor: string|null, stats: TipsStats } }`
 */
async function getTipsReceived(req, res, next) {
  try {
    const { creatorPublicKey } = req.params;
    const { limit, offset, cursor } = req.query;

    const result = tipsService.getTipsReceived(creatorPublicKey, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      cursor: cursor || undefined,
    });

    // Also get stats
    const stats = tipsService.getTipsStats(creatorPublicKey);

    res.json({
      success: true,
      data: {
        ...result,
        stats,
      },
    });
  } catch (err) {
    next(err);
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
 * GET /api/tips/sent/:senderPublicKey
 * Get all tips sent by a user.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.senderPublicKey - Sender's Stellar public key (G...)
 * @param {object} req.query
 * @param {string} [req.query.limit] - Max tips to return
 * @param {string} [req.query.offset] - Number of tips to skip (ignored if `cursor` is given)
 * @param {string} [req.query.cursor] - Opaque cursor from a previous page's `nextCursor`
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: { tips: TipRecord[], total: number,
 *   limit: number, offset: number, nextCursor: string|null } }`
 */
async function getTipsSent(req, res, next) {
  try {
    const { senderPublicKey } = req.params;
    const { limit, offset, cursor } = req.query;

    const result = tipsService.getTipsSent(senderPublicKey, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      cursor: cursor || undefined,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
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
async function getTopTippers(req, res, next) {
  try {
    const { creatorPublicKey } = req.params;
    const { limit } = req.query;

    const parsedLimit = limit ? parseInt(limit, 10) : 5;

    const result = tipsService.getTopTippers(creatorPublicKey, parsedLimit);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
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
};
