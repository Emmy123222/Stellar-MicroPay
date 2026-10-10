/**
 * src/routes/accounts.js
 * Account lookup and balance endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validatePublicKey, sanitizeUsername, sanitizePublicKey } = require("../middleware/sanitization");
const { verifyJWT } = require("../middleware/auth");
const accountController = require("../controllers/accountController");
const { horizonCircuitBreakerMiddleware } = require("../middleware/horizonCircuitBreaker");

/**
 * GET /api/accounts/resolve/:username
 * Resolve a username to a Stellar public key.
 * Must be registered before /:publicKey or Express matches it as a key.
 */
router.get("/resolve/:username", strictLimiter, sanitizeUsername, accountController.resolveUsername);

/**
 * GET /api/accounts/:publicKey/has-usdc-trustline
 * Check whether an account has a USDC trustline.
 * Must be registered before /:publicKey or Express matches it as a key.
 */
router.get(
  "/:publicKey/has-usdc-trustline",
  strictLimiter,
  validatePublicKey(),
  accountController.hasUSDCTrustline
);

/**
 * GET /api/accounts/:publicKey
 * Fetch account info and balances from Horizon.
 */
router.get("/:publicKey", strictLimiter, validatePublicKey(), horizonCircuitBreakerMiddleware, accountController.getAccount);

/**
 * GET /api/accounts/:publicKey/balance
 * Fetch just the XLM balance for an account.
 */
router.get("/:publicKey/balance", strictLimiter, validatePublicKey(), horizonCircuitBreakerMiddleware, accountController.getBalance);

/**
 * GET /api/accounts/:publicKey/streaks
 * Fetch user's transaction streak.
 */
router.get("/:publicKey/streaks", strictLimiter, validatePublicKey(), accountController.getStreaks);

/**
 * GET /api/accounts/:publicKey/assets
 * List all non-native asset trustlines (code, issuer, balance, limit) (#1065).
 * Requires a valid SEP-0010 JWT.
 */
router.get("/:publicKey/assets", strictLimiter, verifyJWT, validatePublicKey(), accountController.getAccountAssets);

/**
 * GET /api/accounts/:publicKey/memo-history
 * Fetch N most-recently used distinct memo texts for an account. JWT-protected.
 */
router.get("/:publicKey/memo-history", strictLimiter, verifyJWT, sanitizePublicKey, accountController.getMemoHistory);

/**
 * POST /api/accounts/register
 * Register a new username with a public key.
 */
router.post("/register", strictLimiter, accountController.registerUsername);

module.exports = router;