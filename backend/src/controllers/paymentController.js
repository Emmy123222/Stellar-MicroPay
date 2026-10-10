/**
 * src/controllers/paymentController.js
 * Controller for payment-related endpoints.
 */

"use strict";

const stellarService = require("../services/stellarService");
const streamService = require("../services/streamService");

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

/**
 * Validate the body of a payment submission.
 */
function validateSubmission({ senderPublicKey, recipientPublicKey, amount, asset, txHash }) {
  if (!STELLAR_PUBLIC_KEY_RE.test(String(senderPublicKey || ""))) {
    return { ok: false, error: "senderPublicKey must be a valid Stellar public key" };
  }
  if (!STELLAR_PUBLIC_KEY_RE.test(String(recipientPublicKey || ""))) {
    return { ok: false, error: "recipientPublicKey must be a valid Stellar public key" };
  }
  if (senderPublicKey === recipientPublicKey) {
    return { ok: false, error: "recipientPublicKey must differ from senderPublicKey" };
  }

  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "amount must be a positive number" };
  }
  if (parsed < 0.0000001) {
    return { ok: false, error: "amount is below the minimum representable precision" };
  }

  if (asset && !["XLM", "USDC"].includes(asset)) {
    return { ok: false, error: "asset must be XLM or USDC" };
  }

  if (
    txHash !== undefined &&
    (typeof txHash !== "string" || !/^[0-9a-f]{64}$/i.test(txHash))
  ) {
    return {
      ok: false,
      error: "txHash must be a 64-character hex transaction hash",
    };
  }

  return { ok: true, value: { senderPublicKey, recipientPublicKey, amount: parsed, asset, txHash } };
}

/**
 * POST /api/payments/submit
 * Record a payment the client has already signed and broadcast.
 * Protected by X-Timestamp / X-Signature replay protection.
 */
async function submitPayment(req, res, next) {
  try {
    const { senderPublicKey, recipientPublicKey, amount, asset, txHash } = req.body || {};

    const validation = validateSubmission({ senderPublicKey, recipientPublicKey, amount, asset, txHash });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...validation.value,
      // Taken from the signed request, not trusted from the body.
      submittedAt: new Date(req.requestTimestamp).toISOString(),
    };

    console.log(
      `[payment] submission recorded ${validation.value.senderPublicKey} -> ${validation.value.recipientPublicKey} (${validation.value.asset})`
    );

    res.status(201).json({
      success: true,
      data: submission,
      message: "Payment submitted successfully",
    });
  } catch (err) {
    next(err);
  }
}

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
 * POST /api/payments/submit
 * Submit a signed payment. Accepts an optional `X-Idempotency-Key` header (UUID)
 * so retried submissions replay the original response instead of double-spending.
 */
async function submitSignedTransaction(req, res, next) {
  try {
    const { signedXDR } = req.body || {};

    if (!signedXDR) {
      const error = new Error("signedXDR is required");
      error.status = 400;
      throw error;
    }

    const result = await stellarService.submitTransaction(signedXDR);

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
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
      const amt = parseFloat(p.amount) || 0;
      if (p.type === "sent") {
        totalSent += amt;
        sentCount++;
      } else if (p.type === "received") {
        totalReceived += amt;
        receivedCount++;
      }
    }

    res.json({
      success: true,
      data: {
        totalSent: totalSent.toFixed(7),
        totalReceived: totalReceived.toFixed(7),
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
 * Return the status of a Soroban streaming payment contract.
 */
async function getStreamStatus(req, res, next) {
  try {
    const { streamId } = req.params;
    const status = await streamService.getStreamStatus(streamId);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitPayment, getPayments, submitSignedTransaction, getStats, getStreamStatus };