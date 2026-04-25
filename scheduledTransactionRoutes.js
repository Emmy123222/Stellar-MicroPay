"use strict";

const express = require("express");
const router = express.Router();
const scheduledTransactionService = require("../services/scheduledTransactionService");

/**
 * POST /api/scheduled-txns
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601) }
 */
router.post("/", (req, res, next) => {
  try {
    const { signedXDR, submitAt } = req.body;

    if (!signedXDR || !submitAt) {
      return res.status(400).json({ error: "Missing signedXDR or submitAt" });
    }

    const scheduledTx = scheduledTransactionService.scheduleTransaction(
      signedXDR,
      submitAt
    );
    res.status(201).json({
      message: "Transaction scheduled successfully",
      id: scheduledTx.id,
      publicKey: scheduledTx.publicKey,
      submitAt: scheduledTx.submitAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-txns/:publicKey
 * Lists all pending scheduled transactions for a given public key.
 */
router.get("/:publicKey", (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const transactions = scheduledTransactionService.getScheduledTransactions(
      publicKey
    );
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/scheduled-txns/:id
 * Cancels a scheduled transaction.
 */
router.delete("/:id", (req, res, next) => {
  try {
    const { id } = req.params;
    const cancelled = scheduledTransactionService.cancelScheduledTransaction(id);
    if (cancelled) {
      res.json({ message: `Transaction ${id} cancelled successfully.` });
    } else {
      res.status(404).json({ error: `Transaction ${id} not found or not pending.` });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;