/**
 * src/routes/payments.js
 * Payment history and logging endpoints.
 */

"use strict";

const express = require("express");

const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { paymentLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");

/**
 * GET /api/payments/:publicKey
 * Fetch payment history for an account via Horizon.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   cursor — pagination cursor
 */
router.get("/:publicKey", paymentLimiter, sanitizePublicKey, paymentController.getPayments);

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
 */
router.get("/:publicKey/stats", paymentLimiter, paymentController.getStats);

module.exports = router;
