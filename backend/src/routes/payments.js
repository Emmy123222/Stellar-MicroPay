/**
 * src/routes/payments.js
 * Payment history and logging endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validatePublicKey } = require("../middleware/sanitization");
const paymentController = require("../controllers/paymentController");
const { horizonCircuitBreakerMiddleware } = require("../middleware/horizonCircuitBreaker");

/**
 * GET /api/payments/stream-status/:streamId
 * Return status of a Soroban streaming payment contract.
 * Must be defined before :publicKey to avoid route conflicts.
 */
router.get("/stream-status/:streamId", strictLimiter, paymentController.getStreamStatus);

/**
 * GET /api/payments/:publicKey
 * Fetch payment history for an account via Horizon.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   cursor — pagination cursor
 */
router.get("/:publicKey", strictLimiter, validatePublicKey(), horizonCircuitBreakerMiddleware, paymentController.getPayments);

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
 */
router.get("/:publicKey/stats", validatePublicKey(), horizonCircuitBreakerMiddleware, paymentController.getStats);

module.exports = router;
