/**
 * src/controllers/tipsController.js
 * Handles tip-related API requests.
 */

"use strict";

const tipsService = require("../services/tipsService");

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
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
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
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
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
};