/**
 * src/controllers/tipsController.js
 * Handles tip-related API requests.
 */

"use strict";

const tipsService = require("../services/tipsService");

/**
 * Strictly parses a pagination query parameter.
 *
 * `parseInt` is not usable here: it accepts "1abc" as 1, turns "1.9" into 1,
 * and yields NaN for "abc". NaN then reaches `Array.prototype.slice`, so
 * `?limit=abc` returned an empty page and `?limit=-5` or `?offset=-1` silently
 * applied JavaScript's negative-index semantics instead of being rejected.
 * Every malformed value is a 400 rather than a silent coercion.
 *
 * @param {unknown} raw - Raw query value
 * @param {object} options
 * @param {string} options.name - Parameter name, used in the error message
 * @param {number} [options.min=1] - Smallest accepted value
 * @returns {number|undefined} undefined when the parameter is absent
 * @throws {Error} With `status = 400` when the value is not a valid integer
 */
function parsePaginationParam(raw, { name, min = 1 }) {
  if (raw === undefined) {
    return undefined;
  }

  // A repeated parameter arrives as an array; treat it as ambiguous.
  const candidate = typeof raw === "string" ? raw.trim() : "";

  if (!/^\d+$/.test(candidate) || Number(candidate) < min) {
    const expectation = min === 0 ? "a non-negative" : "a positive";
    const error = new Error(`${name} must be ${expectation} integer`);
    error.status = 400;
    throw error;
  }

  return Number(candidate);
}

/**
 * POST /api/tips
 * Record a new tip.
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
 */
async function getTipsReceived(req, res, next) {
  try {
    const { creatorPublicKey } = req.params;
    const { limit, offset } = req.query;

    const result = tipsService.getTipsReceived(creatorPublicKey, {
      limit: parsePaginationParam(limit, { name: "limit", min: 1 }),
      offset: parsePaginationParam(offset, { name: "offset", min: 0 }),
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
 */
async function getTipsSent(req, res, next) {
  try {
    const { senderPublicKey } = req.params;
    const { limit, offset } = req.query;

    const result = tipsService.getTipsSent(senderPublicKey, {
      limit: parsePaginationParam(limit, { name: "limit", min: 1 }),
      offset: parsePaginationParam(offset, { name: "offset", min: 0 }),
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
 * GET /api/tips/leaderboard
 * Get the top creators ranked by total amount tipped.
 */
async function getLeaderboard(req, res, next) {
  try {
    const { limit } = req.query;

    const result = tipsService.getLeaderboard({
      limit: parsePaginationParam(limit, { name: "limit", min: 1 }),
    });

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
  getLeaderboard,
  // Exported for direct unit testing; the HTTP routes are covered separately.
  parsePaginationParam,
};