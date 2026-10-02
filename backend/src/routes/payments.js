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
const paymentController = require("../controllers/paymentController");

/**
 * GET /api/payments/stream-status/:streamId
 * Return status of a Soroban streaming payment contract.
 * Must be defined before :publicKey to avoid route conflicts.
 */
router.get("/stream-status/:streamId", strictLimiter, paymentController.getStreamStatus);

/**
 * POST /api/payments/submit
 * Submit a signed payment. Accepts an optional `X-Idempotency-Key` header (UUID)
 * so retried submissions replay the original response instead of double-spending.
 */
router.post("/submit", strictLimiter, idempotency, paymentController.submitPayment);

/**
 * GET /api/payments/:publicKey
 * Fetch payment history for an account via Horizon.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   cursor — pagination cursor
 */
router.get("/:publicKey", strictLimiter, validatePublicKey(), paymentController.getPayments);

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
 */
router.get("/:publicKey/stats", validatePublicKey(), paymentController.getStats);

module.exports = router;
