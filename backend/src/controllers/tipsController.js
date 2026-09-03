/**
 * src/controllers/tipsController.js
 * Handles tip-related API requests.
 */

"use strict";

const tipsService = require("../services/tipsService");

/**
 * @typedef {object} TipRecord
 * @property {number} id
 * @property {string} senderPublicKey
 * @property {string} creatorPublicKey
 * @property {string} amount
 * @property {string} asset
 * @property {string} memo
 * @property {string} txHash
 * @property {string} timestamp
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
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} 201 JSON: `{ success: true, data: TipRecord, message: string }`
 */
async function recordTip(req, res, next) {
  try {
    const { senderPublicKey, creatorPublicKey, amount, asset, memo, txHash } = req.body;

    // Validate input
    tipsService.validateTipInput({ senderPublicKey, creatorPublicKey, amount });

    const tip = tipsService.recordTip({
      senderPublicKey,
      creatorPublicKey,
      amount,
      asset: asset || "XLM",
      memo: memo || "",
      txHash: txHash || "",
    });

    res.status(201).json({
      success: true,
      data: tip,
      message: "Tip recorded successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tips/received/:creatorPublicKey
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
}

/**
 * GET /api/tips/stats/:creatorPublicKey
 * Get statistics for tips received by a creator.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.creatorPublicKey - Creator's Stellar public key (G...)
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: TipsStats }`
 */
async function getTipsStats(req, res, next) {
  try {
    const { creatorPublicKey } = req.params;
    const stats = tipsService.getTipsStats(creatorPublicKey);
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    next(err);
  }
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
}

/**
 * GET /api/tips/leaderboard/:creatorPublicKey
 * Get top tippers for a creator.
 *
 * @param {object} req - Express request
 * @param {object} req.params
 * @param {string} req.params.creatorPublicKey - Creator's Stellar public key (G...)
 * @param {object} req.query
 * @param {string} [req.query.limit] - Max tippers to return, defaults to 5
 * @param {object} res - Express response
 * @param {function} next - Express error-handling callback
 * @returns {Promise<void>} JSON: `{ success: true, data: Array<{ senderPublicKey: string, totalAmount: string }> }`
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
}

module.exports = {
  recordTip,
  getTipsReceived,
  getTipsStats,
  getTipsSent,
  getTopTippers,
};
