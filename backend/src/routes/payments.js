/**
 * src/routes/payments.js
 * Payment history and logging endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validatePublicKey } = require("../middleware/sanitization");
const { idempotency } = require("../middleware/idempotency");
const { requireSignedRequest } = require("../middleware/requestSignature");
const paymentController = require("../controllers/paymentController");
const { horizonCircuitBreakerMiddleware } = require("../middleware/horizonCircuitBreaker");
const { requireSignedRequest } = require("../middleware/requestSignature");

/**
 * POST /api/payments/submit
 * Record a payment the client has already signed and broadcast.
 *
 * Protected by the X-Timestamp / X-Signature pair: a captured request is
 * rejected once it is more than 30s old, and its signature covers the method,
 * path and body hash, so it cannot be edited in transit to change the amount.
 * Requests with a missing, malformed, expired or mismatched signature get 401.
 */
router.post(
  "/submit",
  strictLimiter,
  requireSignedRequest,
  paymentController.submitPayment,
);

/**
 * GET /api/payments/stream-status/:streamId
 * Return status of a Soroban streaming payment contract.
 * Must be defined before :publicKey to avoid route conflicts.
 */
router.get(
  "/stream-status/:streamId",
  strictLimiter,
  paymentController.getStreamStatus,
);

/**
 * POST /api/payments/broadcast
 * Submit a signed payment. Accepts an optional `X-Idempotency-Key` header (UUID)
 * so retried submissions replay the original response instead of double-spending.
 */
router.post("/broadcast", strictLimiter, idempotency, paymentController.submitSignedTransaction);

/**
 * GET /api/payments/:publicKey
 * Fetch payment history for an account via Horizon.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   cursor — pagination cursor
 */
router.get(
  "/:publicKey",
  strictLimiter,
  validatePublicKey(),
  horizonCircuitBreakerMiddleware,
  paymentController.getPayments,
);

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
 */
router.get(
  "/:publicKey/stats",
  validatePublicKey(),
  horizonCircuitBreakerMiddleware,
  paymentController.getStats,
);

module.exports = router;
