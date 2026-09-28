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
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
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

/**
 * GET /api/payments/stream-status/:streamId
 * Returns status of a Soroban streaming payment contract.
 */
async function getStreamStatus(req, res, next) {
  try {
    const { streamId } = req.params;
    
    // Placeholder implementation - in production this would query the Soroban contract
    // For now, return a mock response structure
    res.json({
      success: true,
      data: {
        streamId,
        payer: "GEXAMPLEPAYERADDRESS",
        recipient: "GEXAMPLERECIPIENTADDRESS",
        ratePerHour: "10.0000000", // XLM per hour
        deposit: "100.0000000", // Total XLM deposited
        claimable: "25.5000000", // XLM available to claim
        startTime: new Date(Date.now() - 86400000).toISOString(),
        isActive: true,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPayments, getStats, getStreamStatus };
