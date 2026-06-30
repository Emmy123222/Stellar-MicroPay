/**
 * src/controllers/paymentController.js
 * Handles payment history and stats requests.
 */

"use strict";

const stellarService = require("../services/stellarService");

/**
 * GET /api/payments/:publicKey
 */
async function getPayments(req, res, next) {
  try {
    const { publicKey } = req.params;

    // #197: explicit validation — || 20 silently swallows limit=0; NaN propagates to Horizon
    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = parseInt(rawLimit, 10);
      if (isNaN(parsed) || !Number.isSafeInteger(parsed) || parsed < 1) {
        return res.status(400).json({ error: "limit must be a positive integer" });
      }
      limit = Math.min(parsed, 100);
    }

    const cursor = req.query.cursor || undefined;

    const payments = await stellarService.getPayments(publicKey, { limit, cursor });
    res.json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payments/:publicKey/stats
 * Computes aggregate payment statistics for a wallet.
 */
async function getStats(req, res, next) {
  try {
    const { publicKey } = req.params;
    const payments = await stellarService.getPayments(publicKey, { limit: 100 });

    let totalSent = 0;
    let totalReceived = 0;
    let sentCount = 0;
    let receivedCount = 0;

    for (const p of payments) {
      if (p.type === "sent") {
        totalSent += parseFloat(p.amount);
        sentCount++;
      } else {
        totalReceived += parseFloat(p.amount);
        receivedCount++;
      }
    }

    res.json({
      success: true,
      data: {
        publicKey,
        totalSentXLM: totalSent.toFixed(7),
        totalReceivedXLM: totalReceived.toFixed(7),
        sentCount,
        receivedCount,
        totalTransactions: sentCount + receivedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPayments, getStats };
