/**
 * src/controllers/paymentController.js
 * Handles payment history and stats requests.
 */

"use strict";

const stellarService = require("../services/stellarService");
const streamService = require("../services/streamService");

/** Stellar account IDs are 'G' + 55 base32 characters, 56 in total. */
const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

/**
 * Validate the body of a payment submission.
 *
 * Every field is checked before anything is stored, so a malformed request
 * never reaches the record store.
 *
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
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
  // Reject sub-stroop dust: 7 decimal places is the Stellar precision limit, so
  // anything finer is a rounding artefact rather than a real amount.
  if (parsed < 0.0000001) {
    return { ok: false, error: "amount is below the minimum representable precision" };
  }

  if (asset !== undefined && typeof asset !== "string") {
    return { ok: false, error: "asset must be a string" };
  }

  if (txHash !== undefined && (typeof txHash !== "string" || !/^[0-9a-f]{64}$/i.test(txHash))) {
    return { ok: false, error: "txHash must be a 64-character hex transaction hash" };
  }

  return {
    ok: true,
    value: {
      senderPublicKey,
      recipientPublicKey,
      amount,
      asset: asset || "XLM",
      txHash: txHash || "",
    },
  };
}

/**
 * POST /api/payments/submit
 *
 * Records a payment the client has already signed and submitted to Horizon.
 * Reached only through `requireSignedRequest`, so by the time the body is read
 * the request has been proven fresh and unmodified.
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

    // Plain console to match the rest of the server, which uses morgan rather
    // than a structured logger.
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
 * Submit a signed payment transaction to Horizon.
 *
 * Safe to retry: when an `X-Idempotency-Key` header is supplied, the
 * idempotency middleware replays the cached response for repeats within 24h.
 */
async function submitPayment(req, res, next) {
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
    const status = await streamService.getStreamStatus(streamId);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPayments, getStats, getStreamStatus, submitPayment };
